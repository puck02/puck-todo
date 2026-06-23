#!/usr/bin/env python3
from __future__ import annotations

import argparse
import base64
import hashlib
import hmac
import json
import mimetypes
import os
import sqlite3
import time as time_module
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
VALID_COUNTDOWN_TYPES = {"once", "monthly", "anniversary"}
DATE_FORMAT = "%Y-%m-%d"
SESSION_COOKIE = "puck_session"
SESSION_TTL_SECONDS = 60 * 60 * 24 * 30
LOGIN_ASSET_PATHS = {"/login", "/login.html"}
PUBLIC_ASSET_PATHS = LOGIN_ASSET_PATHS | {"/style.css", "/app.js", "/markdown.js", "/favicon.svg"}


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


def parse_date(value: str) -> str:
    return datetime.strptime(value, DATE_FORMAT).strftime(DATE_FORMAT)


def days_in_month(year: int, month: int) -> int:
    if month == 12:
        next_month = datetime(year + 1, 1, 1)
    else:
        next_month = datetime(year, month + 1, 1)
    return (next_month - timedelta(days=1)).day


def date_string(year: int, month: int, day: int) -> str:
    return f"{year:04d}-{month:02d}-{day:02d}"


def normalize(row: sqlite3.Row) -> dict[str, Any]:
    d = dict(row)
    d["priority_label"] = {"urgent": "紧急", "high": "高", "medium": "中", "low": "低"}.get(d["priority"], d["priority"])
    return d


def b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def b64url_decode(value: str) -> bytes:
    padding = "=" * ((4 - len(value) % 4) % 4)
    return base64.urlsafe_b64decode((value + padding).encode("ascii"))


def env_value(name: str) -> str:
    value = os.environ.get(name, "").strip()
    prefix = f"{name}="
    return value[len(prefix):].strip() if value.startswith(prefix) else value


def auth_email() -> str:
    return env_value("ADMIN_EMAIL")


def auth_password_hash() -> str:
    return env_value("ADMIN_PASSWORD_HASH")


def auth_secret() -> str:
    return env_value("AUTH_SECRET")


def has_auth_config() -> bool:
    return bool(auth_email() and auth_password_hash() and auth_secret())


def require_auth_config() -> None:
    if not has_auth_config():
        raise ValueError("登录配置未完成")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        if password_hash.startswith("ADMIN_PASSWORD_HASH="):
            password_hash = password_hash.split("=", 1)[1].strip()
        scheme, iterations_value, salt_value, expected_value = password_hash.split("$", 3)
        iterations = int(iterations_value)
        if scheme != "pbkdf2_sha256" or iterations < 10000:
            return False
        actual = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), b64url_decode(salt_value), iterations, dklen=32)
        return hmac.compare_digest(actual, b64url_decode(expected_value))
    except Exception:
        return False


def sign_session_payload(payload: str, secret: str) -> str:
    signature = hmac.new(secret.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256).digest()
    return b64url_encode(signature)


def create_session_cookie(email: str, secret: str, secure: bool = False) -> str:
    expires_at = int(time_module.time()) + SESSION_TTL_SECONDS
    payload = b64url_encode(json.dumps({"email": email, "exp": expires_at}, separators=(",", ":")).encode("utf-8"))
    token = f"{payload}.{sign_session_payload(payload, secret)}"
    secure_flag = "; Secure" if secure else ""
    return f"{SESSION_COOKIE}={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age={SESSION_TTL_SECONDS}{secure_flag}"


def clear_session_cookie() -> str:
    return f"{SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0"


def parse_cookie_header(header: str) -> dict[str, str]:
    cookies: dict[str, str] = {}
    for part in header.split(";"):
        if "=" not in part:
            continue
        key, value = part.split("=", 1)
        cookies[key.strip()] = value.strip()
    return cookies


def verify_session_token(token: str | None, secret: str) -> dict[str, Any] | None:
    if not token or "." not in token:
        return None
    payload, signature = token.split(".", 1)
    if not hmac.compare_digest(sign_session_payload(payload, secret), signature):
        return None
    try:
        data = json.loads(b64url_decode(payload).decode("utf-8"))
    except Exception:
        return None
    if not data.get("exp") or data["exp"] < int(time_module.time()):
        return None
    return data


def session_user(cookie_header: str) -> dict[str, str] | None:
    if not has_auth_config():
        return None
    cookies = parse_cookie_header(cookie_header)
    email = auth_email()
    data = verify_session_token(cookies.get(SESSION_COOKIE), auth_secret())
    if not data or str(data.get("email", "")).lower() != email.lower():
        return None
    return {"email": email}


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
            conn.execute("""
                CREATE TABLE IF NOT EXISTS countdowns (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    title TEXT NOT NULL,
                    target_date TEXT NOT NULL,
                    event_type TEXT NOT NULL DEFAULT 'once',
                    repeat_month INTEGER,
                    repeat_day INTEGER,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
            """)
            countdown_columns = {row[1] for row in conn.execute("PRAGMA table_info(countdowns)").fetchall()}
            if "event_type" not in countdown_columns:
                conn.execute("ALTER TABLE countdowns ADD COLUMN event_type TEXT NOT NULL DEFAULT 'once'")
            if "repeat_month" not in countdown_columns:
                conn.execute("ALTER TABLE countdowns ADD COLUMN repeat_month INTEGER")
            if "repeat_day" not in countdown_columns:
                conn.execute("ALTER TABLE countdowns ADD COLUMN repeat_day INTEGER")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_countdowns_target_date ON countdowns(target_date)")
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

    def create_countdown(
        self,
        title: str,
        target_date: str,
        event_type: str = "once",
        repeat_month: int | None = None,
        repeat_day: int | None = None,
    ) -> dict[str, Any]:
        title = (title or "").strip()
        if not title:
            raise ValueError("事件名称不能为空")
        event_type = event_type or "once"
        if event_type not in VALID_COUNTDOWN_TYPES:
            raise ValueError("事件类型不合法")
        if event_type == "once":
            target_date = parse_date(str(target_date or ""))
            repeat_month = None
            repeat_day = None
        elif event_type == "monthly":
            repeat_day = int(repeat_day or 0)
            if repeat_day < 1 or repeat_day > 31:
                raise ValueError("每月日期必须是 1-31")
            now = now_local()
            target_date = date_string(now.year, now.month, min(repeat_day, days_in_month(now.year, now.month)))
            repeat_month = None
        else:
            target_date = parse_date(str(target_date or ""))
            parsed = datetime.strptime(target_date, DATE_FORMAT)
            repeat_month = parsed.month
            repeat_day = parsed.day
        now = now_local().isoformat()
        with self.connect() as conn:
            cur = conn.execute(
                "INSERT INTO countdowns (title, target_date, event_type, repeat_month, repeat_day, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (title, target_date, event_type, repeat_month, repeat_day, now, now),
            )
            conn.commit()
            return self.get_countdown(cur.lastrowid)

    def get_countdown(self, countdown_id: int) -> dict[str, Any]:
        with self.connect() as conn:
            row = conn.execute("SELECT * FROM countdowns WHERE id=?", (countdown_id,)).fetchone()
        if row is None:
            raise KeyError("倒数日不存在")
        return dict(row)

    def list_countdowns(self) -> dict[str, Any]:
        with self.connect() as conn:
            rows = conn.execute("SELECT * FROM countdowns ORDER BY target_date ASC, created_at ASC").fetchall()
        return {"countdowns": [dict(row) for row in rows]}

    def delete_countdown(self, countdown_id: int) -> dict[str, bool]:
        with self.connect() as conn:
            cur = conn.execute("DELETE FROM countdowns WHERE id=?", (countdown_id,))
            conn.commit()
        return {"ok": cur.rowcount > 0}


def make_handler(db_path: str):
    store = TodoStore(db_path)

    class Handler(BaseHTTPRequestHandler):
        server_version = "PuckTodo/1.1"

        def log_message(self, fmt: str, *args: Any) -> None:
            print(f"[{self.log_date_time_string()}] {fmt % args}")

        def send_json(self, data: Any, status: int = 200, headers: dict[str, str] | None = None) -> None:
            body = json.dumps(data, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            for key, value in (headers or {}).items():
                self.send_header(key, value)
            self.end_headers()
            self.wfile.write(body)

        def send_error_json(self, message: str, status: int = 400) -> None:
            self.send_json({"error": message}, status)

        def redirect(self, location: str) -> None:
            self.send_response(302)
            self.send_header("Location", location)
            self.send_header("Cache-Control", "no-store")
            self.end_headers()

        def read_json(self) -> dict[str, Any]:
            length = int(self.headers.get("Content-Length", "0") or "0")
            return json.loads(self.rfile.read(length).decode("utf-8")) if length else {}

        def current_user(self) -> dict[str, str] | None:
            return session_user(self.headers.get("Cookie", ""))

        def require_user(self) -> bool:
            if self.current_user():
                return True
            self.send_error_json("请先登录", 401)
            return False

        def handle_auth_api(self, path: str) -> bool:
            if self.command == "GET" and path == "/api/auth/status":
                user = self.current_user()
                self.send_json({"authenticated": bool(user), "email": user["email"] if user else None, "configured": has_auth_config()})
                return True
            if self.command == "POST" and path == "/api/auth/login":
                require_auth_config()
                payload = self.read_json()
                email = str(payload.get("email", "")).strip().lower()
                password = str(payload.get("password", ""))
                admin_email = auth_email()
                valid_email = email == admin_email.lower()
                valid_password = verify_password(password, auth_password_hash())
                if not valid_email or not valid_password:
                    self.send_error_json("账号或密码错误", 401)
                    return True
                cookie = create_session_cookie(admin_email, auth_secret())
                self.send_json({"ok": True}, headers={"Set-Cookie": cookie})
                return True
            if self.command == "POST" and path == "/api/auth/logout":
                self.send_json({"ok": True}, headers={"Set-Cookie": clear_session_cookie()})
                return True
            return False

        def do_GET(self) -> None:
            parsed = urlparse(self.path)
            qs = parse_qs(parsed.query)
            try:
                if parsed.path == "/api/health":
                    return self.send_json({"ok": True})
                if parsed.path.startswith("/api/auth/") and self.handle_auth_api(parsed.path):
                    return
                if parsed.path.startswith("/api/") and not self.require_user():
                    return
                if parsed.path == "/api/todos":
                    month = qs.get("month", [datetime.now().strftime("%Y-%m")])[0]
                    return self.send_json(store.list_month(month))
                if parsed.path == "/api/countdowns":
                    return self.send_json(store.list_countdowns())
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
                if path.startswith("/api/auth/") and self.handle_auth_api(path):
                    return
                if not self.require_user():
                    return
                if path == "/api/todos":
                    p = self.read_json()
                    return self.send_json(store.create_todo(p.get("title", ""), p.get("priority", "medium"), p.get("due_at", ""), p.get("note", "")))
                if path == "/api/countdowns":
                    p = self.read_json()
                    return self.send_json(store.create_countdown(
                        p.get("title", ""),
                        p.get("target_date", ""),
                        p.get("event_type", "once"),
                        p.get("repeat_month"),
                        p.get("repeat_day"),
                    ), 201)
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
                if not self.require_user():
                    return
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
                if not self.require_user():
                    return
                if path.startswith("/api/countdowns/"):
                    return self.send_json(store.delete_countdown(int(path.split("/")[3])))
                if path.startswith("/api/todos/"):
                    return self.send_json(store.delete_todo(int(path.split("/")[3])))
                return self.send_error_json("Not found", 404)
            except Exception as exc:
                return self.send_error_json(str(exc), 400)

        def serve_static(self, path: str) -> None:
            if path == "/":
                path = "/index.html"
            if path in LOGIN_ASSET_PATHS:
                if self.current_user():
                    return self.redirect("/")
                path = "/login.html"
            if path not in PUBLIC_ASSET_PATHS and not self.current_user():
                login_path = f"/login?next={path}"
                return self.redirect(login_path)
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
