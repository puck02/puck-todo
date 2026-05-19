# Puck Todo

轻量个人月度待办服务：Python 标准库 + SQLite + 原生 HTML/CSS/JS。

## 启动

```bash
cd /home/admin/workspace/puck-todo
./start.sh
```

访问：

```text
http://服务器IP:8787/
```

## 字段

- 事件名称
- 优先级：low / medium / high / urgent
- 截止时间
- 状态：pending / completed

## API

```text
GET    /api/health
GET    /api/todos?month=YYYY-MM
POST   /api/todos
PATCH  /api/todos/{id}
DELETE /api/todos/{id}
POST   /api/todos/{id}/complete
POST   /api/todos/{id}/uncomplete
GET    /api/reminders/daily
GET    /api/reminders/due-soon?window_minutes=30
```

## Hermes cron

- 每日提醒：`30 8 * * *` 执行 `/home/admin/.hermes/hermes-agent/venv/bin/python3 /home/admin/workspace/puck-todo/remind.py daily`
- 截止前提醒：`*/5 * * * *` 执行 `/home/admin/.hermes/hermes-agent/venv/bin/python3 /home/admin/workspace/puck-todo/remind.py due-soon`
