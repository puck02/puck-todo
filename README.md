# Puck Office

轻量个人办公站：Cloudflare Workers + D1 + 原生 HTML/CSS/JS。当前功能包括月度待办、独立笔记、Markdown 实时预览。

## 本地开发

```bash
npm install
npx wrangler d1 create puck_todo_db
D1_DATABASE_ID=<上一步输出的 database_id> node scripts/prepare-wrangler-config.mjs
npm run db:migrate:local
npm run dev
```

访问：

```text
http://127.0.0.1:8787/
```

## API

```text
GET    /api/health
GET    /api/todos?month=YYYY-MM
POST   /api/todos
PATCH  /api/todos/{id}
DELETE /api/todos/{id}
POST   /api/todos/{id}/complete
POST   /api/todos/{id}/uncomplete
GET    /api/notes
POST   /api/notes
GET    /api/notes/{id}
PATCH  /api/notes/{id}
DELETE /api/notes/{id}
```

## GitHub Actions 自动部署

在 GitHub 仓库 Settings -> Secrets and variables -> Actions 中配置：

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_D1_DATABASE_ID`

push 到 `main` 或 `cloudflare-office-notes` 后会自动运行测试、应用 D1 migrations，并部署 Worker。不要把 Cloudflare API Token 写进仓库文件。
