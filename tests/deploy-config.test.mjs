import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Cloudflare deployment files are wired for Workers, D1, assets, and GitHub Actions', async () => {
  const [wrangler, workflow, migration] = await Promise.all([
    readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'),
    readFile(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8'),
    readFile(new URL('../migrations/0001_init.sql', import.meta.url), 'utf8')
  ]);

  assert.match(wrangler, /"main":\s*"src\/worker\.js"/);
  assert.match(wrangler, /"binding":\s*"DB"/);
  assert.match(wrangler, /"binding":\s*"ASSETS"/);
  assert.match(wrangler, /"compatibility_date":\s*"2026-06-19"/);
  assert.match(workflow, /cloudflare\/wrangler-action@v4/);
  assert.match(workflow, /Validate required secrets/);
  assert.match(workflow, /CLOUDFLARE_API_TOKEN/);
  assert.match(workflow, /CLOUDFLARE_ACCOUNT_ID/);
  assert.match(workflow, /CLOUDFLARE_D1_DATABASE_ID/);
  assert.match(workflow, /d1 migrations apply puck_todo_db --remote/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS notes/);
});
