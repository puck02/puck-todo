import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Cloudflare deployment files are wired for Workers, D1, assets, and GitHub Actions', async () => {
  const [wrangler, workflow, migration, countdownMigration, countdownFrequencyMigration, performanceMigration, studyMigration, ciPrepare] = await Promise.all([
    readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'),
    readFile(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8'),
    readFile(new URL('../migrations/0001_init.sql', import.meta.url), 'utf8'),
    readFile(new URL('../migrations/0003_countdowns.sql', import.meta.url), 'utf8'),
    readFile(new URL('../migrations/0004_countdown_frequency.sql', import.meta.url), 'utf8'),
    readFile(new URL('../migrations/0005_performance_indexes.sql', import.meta.url), 'utf8'),
    readFile(new URL('../migrations/0006_study_plans.sql', import.meta.url), 'utf8'),
    readFile(new URL('../scripts/prepare-ci-wrangler-config.mjs', import.meta.url), 'utf8')
  ]);

  assert.match(wrangler, /"main":\s*"src\/worker\.js"/);
  assert.match(wrangler, /"binding":\s*"DB"/);
  assert.match(wrangler, /"binding":\s*"ASSETS"/);
  assert.match(wrangler, /"run_worker_first":\s*true/);
  assert.match(wrangler, /"pattern":\s*"notes\.nektos\.cn"/);
  assert.match(wrangler, /"custom_domain":\s*true/);
  assert.match(wrangler, /"compatibility_date":\s*"2026-06-19"/);
  assert.match(wrangler, /"ADMIN_EMAIL"/);
  assert.match(wrangler, /"ADMIN_PASSWORD_HASH"/);
  assert.match(wrangler, /"AUTH_SECRET"/);
  assert.match(workflow, /cloudflare\/wrangler-action@v3/);
  assert.match(workflow, /wranglerVersion:\s*"4"/);
  assert.match(workflow, /Validate required secrets/);
  assert.match(workflow, /CLOUDFLARE_API_TOKEN/);
  assert.match(workflow, /CLOUDFLARE_ACCOUNT_ID/);
  assert.match(workflow, /CLOUDFLARE_D1_DATABASE_ID/);
  assert.match(workflow, /Validate Cloudflare D1 database/);
  assert.match(workflow, /d1 migrations apply DB --remote/);
  assert.match(workflow, /Validate D1 database binding/);
  assert.match(workflow, /Prepare CI deploy config/);
  assert.match(workflow, /prepare-ci-wrangler-config\.mjs/);
  assert.match(workflow, /deploy --config wrangler\.ci\.jsonc --keep-vars/);
  assert.match(workflow, /rm -f wrangler\.ci\.jsonc/);
  assert.match(workflow, /Deploy Worker/);
  assert.match(workflow, /wrangler\.ci\.jsonc/);
  assert.match(workflow, /--keep-vars/);
  assert.match(workflow, /command: deploy --config wrangler\.ci\.jsonc --keep-vars/);
  assert.match(workflow, /CLOUDFLARE_API_TOKEN/);
  assert.match(workflow, /CLOUDFLARE_ACCOUNT_ID/);
  assert.match(workflow, /wranglerVersion:\s*"4"/);
  assert.match(workflow, /cloudflare\/wrangler-action@v3/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS notes/);
  assert.match(countdownMigration, /CREATE TABLE IF NOT EXISTS countdowns/);
  assert.match(countdownMigration, /idx_countdowns_target_date/);
  assert.match(countdownFrequencyMigration, /ALTER TABLE countdowns ADD COLUMN event_type/);
  assert.match(countdownFrequencyMigration, /ALTER TABLE countdowns ADD COLUMN repeat_day/);
  assert.match(performanceMigration, /idx_todos_status_due_at/);
  assert.match(performanceMigration, /idx_notes_parent_type_updated_created/);
  assert.match(performanceMigration, /idx_countdowns_target_date_created/);
  assert.match(studyMigration, /CREATE TABLE IF NOT EXISTS study_plans/);
  assert.match(studyMigration, /CREATE TABLE IF NOT EXISTS study_plan_items/);
  assert.match(studyMigration, /idx_study_plan_items_plan_position/);
  assert.match(studyMigration, /idx_study_plan_items_plan_status/);
  assert.match(ciPrepare, /delete config\.routes/);
});
