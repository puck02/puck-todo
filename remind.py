#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import sys
import urllib.request
from datetime import datetime

BASE_URL = os.getenv("PUCK_TODO_URL", "http://127.0.0.1:8787")


def fetch(path: str) -> dict:
    req = urllib.request.Request(BASE_URL + path)
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read().decode("utf-8"))


def time_label(iso: str) -> str:
    return datetime.fromisoformat(iso).strftime("%m/%d %H:%M")


def p_label(priority: str) -> str:
    return {"urgent": "🔥紧急", "high": "⭐高", "medium": "蓝·中", "low": "灰·低"}.get(priority, priority)


def daily() -> str:
    data = fetch("/api/reminders/daily")
    today = data.get("today", [])
    future = data.get("future_important", [])
    if not today and not future:
        return "早上好喵 (◕‿◕)✨ 今天暂无未完成待办，轻轻松松也很好~"
    lines = ["早上好喵 (◕‿◕)✨", ""]
    if today:
        lines.append(f"今天有 {len(today)} 个待办事项：")
        for i, item in enumerate(today, 1):
            lines.append(f"{i}. {p_label(item['priority'])} {time_label(item['due_at'])}  {item['title']}")
    else:
        lines.append("今天没有截止事项~")
    if future:
        lines.extend(["", "未来重要事项低频提醒："])
        for item in future:
            lines.append(f"- {p_label(item['priority'])} {item['days_left']}天后：{time_label(item['due_at'])}  {item['title']}")
    lines.extend(["", "今天也稳稳推进喵 ♪"])
    return "\n".join(lines)


def due_soon() -> str:
    data = fetch("/api/reminders/due-soon?window_minutes=30")
    items = data.get("items", [])
    if not items:
        return ""
    lines = ["截止前提醒喵！(ง •̀_•́)ง✨", ""]
    for item in items:
        lines.append(f"- {p_label(item['priority'])} {time_label(item['due_at'])}  {item['title']}")
    lines.extend(["", "还有约 30 分钟，记得处理一下~"])
    return "\n".join(lines)


def main() -> None:
    mode = sys.argv[1] if len(sys.argv) > 1 else "daily"
    if mode == "daily":
        print(daily())
    elif mode == "due-soon":
        msg = due_soon()
        if msg:
            print(msg)
    else:
        raise SystemExit("mode must be daily or due-soon")


if __name__ == "__main__":
    main()
