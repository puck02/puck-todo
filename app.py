#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import mimetypes
import os
import sqlite3
from datetime import datetime, timedelta, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parent
STATIC_DIR = ROOT / "static"
DEFAULT_DB_PATH = ROOT / "todos.db"
PRIORITY_WEIGHT = {"urgent": 4, "high": 3, "medium": 2, "low": 1}
VALID_PRIORITIES = set(PRIORITY_WEIGHT)
VALID_STATUS = {"pending", "completed"}


def now_local() -> datetime:
    return datetime.now().replace(microsecond=0)


def parse_dt(value: str) -> datetime:
    if value.endswith("Z"):
        value = value[:-1]
    return datetime.fromisoformat(value)


def month_range(month: str) -> tuple[str, str]:
    start = datetime.strptime(month, "%Y-%m")
    end = start.replace(year=start.year + 1, month=1) if start.month == 12 else start.replace(month=start.month + 1)
    return start.isoformat(), end.isoformat()


def normalize(row: sqlite3.Row) -> dict[str, Any]:
    d = dict(row)
    d["priority_label"] = {"urgent": "紧急", "high": "高", "medium": "中", "low": "低"}.get(d["priority"], d["priority"])
    return d


class TodoStore:
    def __init__(self, db_path: str | os.PathLike[str] = DEFAULT_DB_PATH):
        self.db_path = str(db_path)
        Path(self.db_path).parent.mkdir(parents=True, exist_ok=True)
        self.init_db()

    def connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def init_db(self) -> None:
        with self.connect() as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS todos (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    title TEXT NOT NULL,
                    priority TEXT NOT NULL DEFAULT 'medium',
                    note TEXT NOT NULL DEFAULT '',
                    due_at TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'pending',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    completed_at TEXT,
                    last_daily_reminded_at TEXT,
                    last_due_reminded_at TEXT,
                    last_future_reminded_at TEXT
                )
            """)
            columns = {row[1] for row in conn.execute("PRAGMA table_info(todos)").fetchall()}
            if "note" not in columns:
                conn.execute("ALTER TABLE todos ADD COLUMN note TEXT NOT NULL DEFAULT ''")
            conn.commit()

    def create_todo(self, title: str, priority: str, due_at: str, note: str = "") -> dict[str, Any]:
        title = (title or "").strip()
        note = (note or "").strip()
        priority = priority or "medium"
        if not title:
            raise ValueError("事件名称不能为空")
        if priority not in VALID_PRIORITIES:
            raise ValueError("优先级必须是 low/medium/high/urgent")
        parse_dt(due_at)
        now = now_local().isoformat()
        with self.connect() as conn:
            cur = conn.execute(
                "INSERT INTO todos (title, priority, note, due_at, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'pending', ?, ?)",
                (title, priority, note, due_at, now, now),
            )
            conn.commit()
            return self.get_todo(cur.lastrowid)

    def get_todo(self, todo_id: int) -> dict[str, Any]:
        with self.connect() as conn:
            row = conn.execute("SELECT * FROM todos WHERE id=?", (todo_id,)).fetchone()
        if row is None:
            raise KeyError("待办不存在")
        return normalize(row)

    def list_month(self, month: str) -> dict[str, Any]:
        start, end = month_range(month)
        with self.connect() as conn:
            rows = conn.execute(
                """
                SELECT * FROM todos WHERE due_at >= ? AND due_at < ?
                ORDER BY CASE priority WHEN 'urgent' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END DESC,
                         due_at ASC, created_at ASC
                """,
                (start, end),
            ).fetchall()
        pending = [normalize(r) for r in rows if r["status"] == "pending"]
        completed = [normalize(r) for r in rows if r["status"] == "completed"]
        completed.sort(key=lambda x: x.get("completed_at") or "", reverse=True)
        return {"month": month, "pending": pending, "completed": completed}

    def update_todo(self, todo_id: int, payload: dict[str, Any]) -> dict[str, Any]:
        allowed = {"title", "priority", "note", "due_at", "status"}
        updates = {k: v for k, v in payload.items() if k in allowed}
        if "title" in updates:
            updates["title"] = str(updates["title"]).strip()
            if not updates["title"]:
                raise ValueError("事件名称不能为空")
        if "note" in updates:
            updates["note"] = str(updates["note"] or "").strip()
        if "priority" in updates and updates["priority"] not in VALID_PRIORITIES:
            raise ValueError("优先级必须是 low/medium/high/urgent")
        if "due_at" in updates:
            parse_dt(str(updates["due_at"]))
        if "status" in updates and updates["status"] not in VALID_STATUS:
            raise ValueError("状态必须是 pending/completed")
        if not updates:
            return self.get_todo(todo_id)
        updates["updated_at"] = now_local().isoformat()
        if updates.get("status") == "completed":
            updates["completed_at"] = updates["updated_at"]
        elif updates.get("status") == "pending":
            updates["completed_at"] = None
        assignments = ", ".join(f"{k}=?" for k in updates)
        with self.connect() as conn:
            cur = conn.execute(f"UPDATE todos SET {assignments} WHERE id=?", (*updates.values(), todo_id))
            conn.commit()
            if cur.rowcount == 0:
                raise KeyError("待办不存在")
        return self.get_todo(todo_id)

    def complete_todo(self, todo_id: int) -> dict[str, Any]:
        now = now_local().isoformat()
        with self.connect() as conn:
            cur = conn.execute("UPDATE todos SET status='completed', completed_at=?, updated_at=? WHERE id=?", (now, now, todo_id))
            conn.commit()
            if cur.rowcount == 0:
                raise KeyError("待办不存在")
        return self.get_todo(todo_id)

    def uncomplete_todo(self, todo_id: int) -> dict[str, Any]:
        now = now_local().isoformat()
        with self.connect() as conn:
            cur = conn.execute("UPDATE todos SET status='pending', completed_at=NULL, updated_at=? WHERE id=?", (now, todo_id))
            conn.commit()
            if cur.rowcount == 0:
                raise KeyError("待办不存在")
        return self.get_todo(todo_id)

    def delete_todo(self, todo_id: int) -> dict[str, bool]:
        with self.connect() as conn:
            cur = conn.execute("DELETE FROM todos WHERE id=?", (todo_id,))
            conn.commit()
        return {"ok": cur.rowcount > 0}

    def daily_reminders(self, now: datetime | None = None) -> dict[str, Any]:
        now = (now or now_local()).replace(microsecond=0)
        today_start = datetime.combine(now.date(), time.min)
        tomorrow = today_start + timedelta(days=1)
        future_end = today_start + timedelta(days=8)
        today_key = now.date().isoformat()
        with self.connect() as conn:
            today_rows = conn.execute(
                """
                SELECT * FROM todos WHERE status='pending' AND due_at >= ? AND due_at < ?
                ORDER BY CASE priority WHEN 'urgent' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END DESC, due_at ASC
                """,
                (today_start.isoformat(), tomorrow.isoformat()),
            ).fetchall()
            future_rows = conn.execute(
                """
                SELECT * FROM todos WHERE status='pending' AND priority IN ('urgent','high') AND due_at >= ? AND due_at < ?
                ORDER BY CASE priority WHEN 'urgent' THEN 4 ELSE 3 END DESC, due_at ASC
                """,
                (tomorrow.isoformat(), future_end.isoformat()),
            ).fetchall()
            future = []
            for row in future_rows:
                item = normalize(row)
                due = parse_dt(item["due_at"])
                days_left = max(1, (due.date() - now.date()).days)
                last = item.get("last_future_reminded_at")
                should = False
                if item["priority"] == "urgent":
                    should = not last or not last.startswith(today_key)
                elif item["priority"] == "high":
                    should = days_left <= 3 and (not last or (now - parse_dt(last)) >= timedelta(days=2))
                if should:
                    item["days_left"] = days_left
                    future.append(item)
                    conn.execute("UPDATE todos SET last_future_reminded_at=?, updated_at=? WHERE id=?", (now.isoformat(), now.isoformat(), item["id"]))
            conn.commit()
        return {"generated_at": now.isoformat(), "today": [normalize(r) for r in today_rows], "future_important": future}

    def due_soon_reminders(self, now: datetime | None = None, window_minutes: int = 30) -> dict[str, Any]:
        now = (now or now_local()).replace(microsecond=0)
        end = now + timedelta(minutes=window_minutes)
        with self.connect() as conn:
            rows = conn.execute(
                """
                SELECT * FROM todos WHERE status='pending' AND due_at >= ? AND due_at <= ? AND last_due_reminded_at IS NULL
                ORDER BY CASE priority WHEN 'urgent' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END DESC, due_at ASC
                """,
                (now.isoformat(), end.isoformat()),
            ).fetchall()
            items = [normalize(r) for r in rows]
            for item in items:
                conn.execute("UPDATE todos SET last_due_reminded_at=?, updated_at=? WHERE id=?", (now.isoformat(), now.isoformat(), item["id"]))
            conn.commit()
        return {"generated_at": now.isoformat(), "window_minutes": window_minutes, "items": items}


def make_handler(db_path: str):
    store = TodoStore(db_path)

    class Handler(BaseHTTPRequestHandler):
        server_version = "PuckTodo/1.1"

        def log_message(self, fmt: str, *args: Any) -> None:
            print(f"[{self.log_date_time_string()}] {fmt % args}")

        def send_json(self, data: Any, status: int = 200) -> None:
            body = json.dumps(data, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def send_error_json(self, message: str, status: int = 400) -> None:
            self.send_json({"error": message}, status)

        def read_json(self) -> dict[str, Any]:
            length = int(self.headers.get("Content-Length", "0") or "0")
            return json.loads(self.rfile.read(length).decode("utf-8")) if length else {}

        def do_GET(self) -> None:
            parsed = urlparse(self.path)
            qs = parse_qs(parsed.query)
            try:
                if parsed.path == "/api/health":
                    return self.send_json({"ok": True})
                if parsed.path == "/api/todos":
                    month = qs.get("month", [datetime.now().strftime("%Y-%m")])[0]
                    return self.send_json(store.list_month(month))
                if parsed.path == "/api/reminders/daily":
                    now = parse_dt(qs["now"][0]) if "now" in qs else None
                    return self.send_json(store.daily_reminders(now))
                if parsed.path == "/api/reminders/due-soon":
                    now = parse_dt(qs["now"][0]) if "now" in qs else None
                    window = int(qs.get("window_minutes", ["30"])[0])
                    return self.send_json(store.due_soon_reminders(now, window))
                return self.serve_static(parsed.path)
            except Exception as exc:
                return self.send_error_json(str(exc), 400)

        def do_POST(self) -> None:
            path = urlparse(self.path).path
            try:
                if path == "/api/todos":
                    p = self.read_json()
                    return self.send_json(store.create_todo(p.get("title", ""), p.get("priority", "medium"), p.get("due_at", ""), p.get("note", "")))
                if path.startswith("/api/todos/") and path.endswith("/complete"):
                    return self.send_json(store.complete_todo(int(path.split("/")[3])))
                if path.startswith("/api/todos/") and path.endswith("/uncomplete"):
                    return self.send_json(store.uncomplete_todo(int(path.split("/")[3])))
                return self.send_error_json("Not found", 404)
            except KeyError as exc:
                return self.send_error_json(str(exc), 404)
            except Exception as exc:
                return self.send_error_json(str(exc), 400)

        def do_PATCH(self) -> None:
            path = urlparse(self.path).path
            try:
                if path.startswith("/api/todos/"):
                    return self.send_json(store.update_todo(int(path.split("/")[3]), self.read_json()))
                return self.send_error_json("Not found", 404)
            except KeyError as exc:
                return self.send_error_json(str(exc), 404)
            except Exception as exc:
                return self.send_error_json(str(exc), 400)

        def do_DELETE(self) -> None:
            path = urlparse(self.path).path
            try:
                if path.startswith("/api/todos/"):
                    return self.send_json(store.delete_todo(int(path.split("/")[3])))
                return self.send_error_json("Not found", 404)
            except Exception as exc:
                return self.send_error_json(str(exc), 400)

        def serve_static(self, path: str) -> None:
            if path == "/":
                path = "/index.html"
            safe = Path(path.lstrip("/")).as_posix()
            if ".." in safe:
                return self.send_error_json("Invalid path", 400)
            fp = STATIC_DIR / safe
            if not fp.exists() or not fp.is_file():
                return self.send_error_json("Not found", 404)
            body = fp.read_bytes()
            ctype = mimetypes.guess_type(str(fp))[0] or "application/octet-stream"
            if ctype.startswith("text/") or ctype in {"application/javascript", "application/json"}:
                ctype += "; charset=utf-8"
            self.send_response(200)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    return Handler


def run_server(host: str, port: int, db_path: str) -> None:
    httpd = ThreadingHTTPServer((host, port), make_handler(db_path))
    print(f"Puck Todo running at http://{host}:{port} db={db_path}", flush=True)
    httpd.serve_forever()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8787)
    parser.add_argument("--db", default=str(DEFAULT_DB_PATH))
    args = parser.parse_args()
    run_server(args.host, args.port, args.db)


if __name__ == "__main__":
    main()
