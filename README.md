# Puck Office

轻量个人办公站：Cloudflare Workers + D1 + 原生 HTML/CSS/JS。当前功能包括月度待办、独立笔记、Markdown 实时预览。

## 本地开发

```bash
npm install
npx wrangler d1 create puck_todo_db
D1_DATABASE_ID=<上一步输出的 database_id> node scripts/prepare-wrangler-config.mjs
node scripts/hash-password.mjs
npm run db:migrate:local
npm run dev
```

登录需要配置三个环境变量。`.dev.vars` 已在 `.gitignore` 中，适合本地开发：

```text
ADMIN_EMAIL=<管理员邮箱>
ADMIN_PASSWORD_HASH=<node scripts/hash-password.mjs 输出的内容>
AUTH_SECRET=<随机长字符串>
```

访问：

```text
http://127.0.0.1:8787/
```

Cloudflare 线上环境用 Secret 保存同样三个值：

```bash
npx wrangler secret put ADMIN_EMAIL
npx wrangler secret put ADMIN_PASSWORD_HASH
npx wrangler secret put AUTH_SECRET
```

登录会话通过 HttpOnly Cookie 保持 30 天，到期后需要重新登录。

## API

```text
GET    /api/health
GET    /api/auth/status
POST   /api/auth/login
POST   /api/auth/logout
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

如果 Actions 在 `Apply D1 migrations` 失败，优先检查：

- `CLOUDFLARE_API_TOKEN` 是否存在且没有过期。
- API Token 是否限定到正确 Cloudflare account，并拥有 Workers 编辑和 D1 编辑权限。
- `CLOUDFLARE_ACCOUNT_ID` 是否属于同一个 Cloudflare account。
- `CLOUDFLARE_D1_DATABASE_ID` 是否来自名为 `puck_todo_db` 的 D1 数据库。
