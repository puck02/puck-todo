import assert from 'node:assert/strict';
import test from 'node:test';

import worker from '../src/worker.js';

const TEST_AUTH_ENV = {
  ADMIN_EMAIL: 'admin@example.com',
  ADMIN_PASSWORD_HASH: 'pbkdf2_sha256$10000$dGVzdC1zYWx0$e792rbohsFefpyebymxZDyAc9fot5buAozShETJIG1c',
  AUTH_SECRET: 'test-auth-secret'
};

class FakeD1 {
  constructor() {
    this.nextTodoId = 1;
    this.nextNoteId = 1;
    this.nextCountdownId = 1;
    this.nextStudyPlanId = 1;
    this.nextStudyPlanItemId = 1;
    this.todos = [];
    this.notes = [];
    this.countdowns = [];
    this.studyPlans = [];
    this.studyPlanItems = [];
    this.sqlLog = [];
  }

  prepare(sql) {
    this.sqlLog.push(sql.replace(/\s+/g, ' ').trim());
    return new FakeStatement(this, sql);
  }
}

class FakeAssets {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/login.html') return Response.redirect(new URL(`/login${url.search}`, url), 307);
    if (url.pathname === '/login') return new Response('<form id="loginForm"></form>', {
      headers: { 'Content-Type': 'text/html' }
    });
    return new Response(`asset:${url.pathname}`);
  }
}

class FakeStatement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql.replace(/\s+/g, ' ').trim();
    this.params = [];
  }

  bind(...params) {
    this.params = params;
    return this;
  }

  async all() {
    const sql = this.sql;
    if (sql.startsWith("SELECT * FROM todos WHERE status='pending'")) {
      const [start, end] = this.params;
      const results = this.db.todos
        .filter((todo) => todo.status === 'pending' && todo.due_at >= start && todo.due_at < end)
        .sort((a, b) =>
          priorityWeight(b.priority) - priorityWeight(a.priority) ||
          a.due_at.localeCompare(b.due_at) ||
          a.created_at.localeCompare(b.created_at)
        );
      return { results };
    }
    if (sql.startsWith("SELECT * FROM todos WHERE status='completed'")) {
      const [start, end] = this.params;
      const results = this.db.todos
        .filter((todo) => todo.status === 'completed' && todo.due_at >= start && todo.due_at < end)
        .sort((a, b) =>
          String(b.completed_at || '').localeCompare(String(a.completed_at || '')) ||
          a.due_at.localeCompare(b.due_at) ||
          a.created_at.localeCompare(b.created_at)
        );
      return { results };
    }
    if (sql.startsWith('SELECT * FROM todos WHERE due_at')) {
      const [start, end] = this.params;
      const results = this.db.todos
        .filter((todo) => todo.due_at >= start && todo.due_at < end)
        .sort((a, b) => priorityWeight(b.priority) - priorityWeight(a.priority) || a.due_at.localeCompare(b.due_at));
      return { results };
    }
    if (sql.startsWith('SELECT * FROM notes ORDER BY')) {
      return { results: [...this.db.notes].sort((a, b) => b.updated_at.localeCompare(a.updated_at)) };
    }
    if (sql.startsWith('SELECT * FROM notes WHERE parent_id=?')) {
      const [parentId] = this.params;
      return {
        results: this.db.notes
          .filter((note) => note.parent_id === parentId)
          .sort((a, b) => sortNotes(a, b, sql))
      };
    }
    if (sql.startsWith('SELECT * FROM notes WHERE parent_id IS NULL')) {
      return {
        results: this.db.notes
          .filter((note) => note.parent_id === null)
          .sort((a, b) => sortNotes(a, b, sql))
      };
    }
    if (sql.startsWith('SELECT * FROM countdowns ORDER BY')) {
      return {
        results: [...this.db.countdowns].sort((a, b) =>
          String(a.target_date).localeCompare(String(b.target_date)) ||
          String(a.created_at).localeCompare(String(b.created_at))
        )
      };
    }
    if (sql.startsWith('SELECT * FROM study_plans ORDER BY')) {
      return {
        results: [...this.db.studyPlans].sort((a, b) =>
          String(b.created_at).localeCompare(String(a.created_at)) ||
          b.id - a.id
        )
      };
    }
    if (sql.startsWith('SELECT * FROM study_plan_items WHERE plan_id=')) {
      const [planId] = this.params;
      return {
        results: this.db.studyPlanItems
          .filter((item) => item.plan_id === planId)
          .sort(sortStudyPlanItems)
      };
    }
    if (sql.startsWith('SELECT * FROM study_plan_items ORDER BY')) {
      return { results: [...this.db.studyPlanItems].sort(sortStudyPlanItemsForList) };
    }
    if (sql.startsWith('SELECT id FROM study_plan_items WHERE plan_id=')) {
      const [planId] = this.params;
      return {
        results: this.db.studyPlanItems
          .filter((item) => item.plan_id === planId)
          .map((item) => ({ id: item.id }))
      };
    }
    throw new Error(`Unexpected all SQL: ${sql}`);
  }

  async first() {
    const sql = this.sql;
    if (sql.startsWith('SELECT * FROM todos WHERE id=')) {
      return this.db.todos.find((todo) => todo.id === this.params[0]) || null;
    }
    if (sql.startsWith('SELECT * FROM notes WHERE id=')) {
      return this.db.notes.find((note) => note.id === this.params[0]) || null;
    }
    if (sql.startsWith('SELECT * FROM countdowns WHERE id=')) {
      return this.db.countdowns.find((item) => item.id === this.params[0]) || null;
    }
    if (sql.startsWith('SELECT * FROM study_plans WHERE id=')) {
      return this.db.studyPlans.find((plan) => plan.id === this.params[0]) || null;
    }
    if (sql.startsWith('SELECT id FROM study_plans WHERE id=')) {
      const plan = this.db.studyPlans.find((item) => item.id === this.params[0]);
      return plan ? { id: plan.id } : null;
    }
    if (sql.startsWith('SELECT * FROM study_plan_items WHERE id=')) {
      return this.db.studyPlanItems.find((item) => item.id === this.params[0]) || null;
    }
    if (sql.startsWith('SELECT COALESCE(MAX(position), 0) + 1')) {
      const [planId] = this.params;
      const position = this.db.studyPlanItems
        .filter((item) => item.plan_id === planId)
        .reduce((max, item) => Math.max(max, item.position), 0) + 1;
      return { position };
    }
    throw new Error(`Unexpected first SQL: ${sql}`);
  }

  async run() {
    const sql = this.sql;
    if (sql.startsWith('INSERT INTO todos')) {
      const [title, priority, note, due_at, now] = this.params;
      const id = this.db.nextTodoId++;
      this.db.todos.push({
        id,
        title,
        priority,
        note,
        due_at,
        status: 'pending',
        created_at: now,
        updated_at: now,
        completed_at: null,
        last_daily_reminded_at: null,
        last_due_reminded_at: null,
        last_future_reminded_at: null
      });
      return { meta: { last_row_id: id, changes: 1 } };
    }
    if (sql.startsWith('INSERT INTO notes')) {
      const [title, body, type = 'file', parent_id = null, now] = this.params;
      const id = this.db.nextNoteId++;
      this.db.notes.push({ id, title, body, type, parent_id, created_at: now, updated_at: now });
      return { meta: { last_row_id: id, changes: 1 } };
    }
    if (sql.startsWith('INSERT INTO countdowns')) {
      const [title, target_date, event_type = 'once', repeat_month = null, repeat_day = null, now] = this.params;
      const id = this.db.nextCountdownId++;
      this.db.countdowns.push({ id, title, target_date, event_type, repeat_month, repeat_day, created_at: now, updated_at: now });
      return { meta: { last_row_id: id, changes: 1 } };
    }
    if (sql.startsWith('INSERT INTO study_plans')) {
      const [title, now] = this.params;
      const id = this.db.nextStudyPlanId++;
      this.db.studyPlans.push({ id, title, created_at: now, updated_at: now });
      return { meta: { last_row_id: id, changes: 1 } };
    }
    if (sql.startsWith('INSERT INTO study_plan_items')) {
      const [plan_id, title, position, now] = this.params;
      const id = this.db.nextStudyPlanItemId++;
      this.db.studyPlanItems.push({
        id,
        plan_id,
        title,
        status: 'pending',
        position,
        created_at: now,
        updated_at: now,
        completed_at: null
      });
      return { meta: { last_row_id: id, changes: 1 } };
    }
    if (sql.startsWith('DELETE FROM notes WHERE id IN')) {
      const [id] = this.params;
      const ids = new Set([id]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const note of this.db.notes) {
          if (ids.has(note.parent_id) && !ids.has(note.id)) {
            ids.add(note.id);
            changed = true;
          }
        }
      }
      const before = this.db.notes.length;
      this.db.notes = this.db.notes.filter((note) => !ids.has(note.id));
      return { meta: { changes: before - this.db.notes.length } };
    }
    if (sql.startsWith('DELETE FROM notes WHERE id=')) {
      const [id] = this.params;
      const before = this.db.notes.length;
      this.db.notes = this.db.notes.filter((note) => note.id !== id);
      return { meta: { changes: before - this.db.notes.length } };
    }
    if (sql.startsWith('DELETE FROM countdowns WHERE id=')) {
      const [id] = this.params;
      const before = this.db.countdowns.length;
      this.db.countdowns = this.db.countdowns.filter((item) => item.id !== id);
      return { meta: { changes: before - this.db.countdowns.length } };
    }
    if (sql.startsWith('DELETE FROM study_plan_items WHERE plan_id=')) {
      const [planId] = this.params;
      const before = this.db.studyPlanItems.length;
      this.db.studyPlanItems = this.db.studyPlanItems.filter((item) => item.plan_id !== planId);
      return { meta: { changes: before - this.db.studyPlanItems.length } };
    }
    if (sql.startsWith('DELETE FROM study_plan_items WHERE id=')) {
      const [id] = this.params;
      const before = this.db.studyPlanItems.length;
      this.db.studyPlanItems = this.db.studyPlanItems.filter((item) => item.id !== id);
      return { meta: { changes: before - this.db.studyPlanItems.length } };
    }
    if (sql.startsWith('DELETE FROM study_plans WHERE id=')) {
      const [id] = this.params;
      const before = this.db.studyPlans.length;
      this.db.studyPlans = this.db.studyPlans.filter((plan) => plan.id !== id);
      return { meta: { changes: before - this.db.studyPlans.length } };
    }
    if (sql.startsWith("UPDATE todos SET status='completed'")) {
      const [now, , id] = this.params;
      const todo = this.db.todos.find((item) => item.id === id);
      if (!todo) return { meta: { changes: 0 } };
      todo.status = 'completed';
      todo.completed_at = now;
      todo.updated_at = now;
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith('UPDATE study_plans SET')) {
      const id = this.params[this.params.length - 1];
      const plan = this.db.studyPlans.find((item) => item.id === id);
      if (!plan) return { meta: { changes: 0 } };
      applyUpdate(sql, this.params, plan);
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith('UPDATE study_plan_items SET')) {
      const id = this.params[this.params.length - 1];
      const item = this.db.studyPlanItems.find((entry) => entry.id === id);
      if (!item) return { meta: { changes: 0 } };
      applyUpdate(sql, this.params, item);
      return { meta: { changes: 1 } };
    }
    throw new Error(`Unexpected run SQL: ${sql}`);
  }
}

function priorityWeight(priority) {
  return { urgent: 4, high: 3, medium: 2, low: 1 }[priority] || 0;
}

function sortNotes(a, b, sql = '') {
  const typeOrder = sql.includes('CASE type')
    ? typeWeight(a.type) - typeWeight(b.type)
    : String(a.type).localeCompare(String(b.type));
  return typeOrder || b.updated_at.localeCompare(a.updated_at) || b.created_at.localeCompare(a.created_at);
}

function typeWeight(type) {
  return type === 'folder' ? 0 : 1;
}

function sortStudyPlanItems(a, b) {
  return a.position - b.position || String(a.created_at).localeCompare(String(b.created_at));
}

function sortStudyPlanItemsForList(a, b) {
  return a.plan_id - b.plan_id || sortStudyPlanItems(a, b);
}

function applyUpdate(sql, params, target) {
  const [, setClause = ''] = sql.match(/SET (.+) WHERE id=\?/) || [];
  let paramIndex = 0;
  for (const assignment of setClause.split(',').map((item) => item.trim())) {
    const [column, rawValue] = assignment.split('=').map((item) => item.trim());
    if (rawValue === '?') {
      target[column] = params[paramIndex];
      paramIndex += 1;
    } else if (rawValue.toUpperCase() === 'NULL') {
      target[column] = null;
    }
  }
}

async function request(db, path, options = {}, env = TEST_AUTH_ENV) {
  const res = await worker.fetch(new Request(`https://office.test${path}`, options), { DB: db, ...env });
  const body = await res.json();
  return { res, body };
}

async function assetRequest(db, path, options = {}, env = TEST_AUTH_ENV) {
  return worker.fetch(new Request(`https://office.test${path}`, options), { DB: db, ASSETS: new FakeAssets(), ...env });
}

async function loginCookie(db) {
  const login = await request(db, '/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: TEST_AUTH_ENV.ADMIN_EMAIL, password: 'correct-password' })
  });
  assert.equal(login.res.status, 200);
  const setCookie = login.res.headers.get('set-cookie');
  assert.match(setCookie, /puck_session=/);
  return setCookie.split(';')[0];
}

async function authenticatedRequest(db, path, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set('Cookie', await loginCookie(db));
  return request(db, path, { ...options, headers });
}

test('Worker auth protects APIs and issues a 30 day session cookie', async () => {
  const db = new FakeD1();

  const denied = await request(db, '/api/todos?month=2026-06');
  assert.equal(denied.res.status, 401);
  assert.equal(denied.body.error, '请先登录');

  const badLogin = await request(db, '/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: TEST_AUTH_ENV.ADMIN_EMAIL, password: 'wrong-password' })
  });
  assert.equal(badLogin.res.status, 401);

  const cookie = await loginCookie(db);
  const loginCookieHeader = (await request(db, '/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: TEST_AUTH_ENV.ADMIN_EMAIL, password: 'correct-password' })
  })).res.headers.get('set-cookie');
  assert.match(loginCookieHeader, /HttpOnly/);
  assert.match(loginCookieHeader, /SameSite=Lax/);
  assert.match(loginCookieHeader, /Secure/);
  assert.match(loginCookieHeader, /Max-Age=2592000/);

  const allowed = await request(db, '/api/todos?month=2026-06', { headers: { Cookie: cookie } });
  assert.equal(allowed.res.status, 200);
  assert.deepEqual(allowed.body.pending, []);

  const logout = await request(db, '/api/auth/logout', { method: 'POST', headers: { Cookie: cookie } });
  assert.equal(logout.res.status, 200);
  assert.match(logout.res.headers.get('set-cookie'), /Max-Age=0/);
});

test('Worker auth accepts secrets pasted with variable names', async () => {
  const db = new FakeD1();
  const env = {
    ADMIN_EMAIL: `ADMIN_EMAIL=${TEST_AUTH_ENV.ADMIN_EMAIL}`,
    ADMIN_PASSWORD_HASH: `ADMIN_PASSWORD_HASH=${TEST_AUTH_ENV.ADMIN_PASSWORD_HASH}`,
    AUTH_SECRET: 'AUTH_SECRET=test-auth-secret'
  };

  const login = await request(db, '/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: TEST_AUTH_ENV.ADMIN_EMAIL, password: 'correct-password' })
  }, env);

  assert.equal(login.res.status, 200);
  assert.match(login.res.headers.get('set-cookie'), /puck_session=/);
});

test('Worker serves login assets without extension redirect loops', async () => {
  const db = new FakeD1();

  const root = await assetRequest(db, '/');
  assert.equal(root.status, 302);
  assert.equal(root.headers.get('location'), 'https://office.test/login?next=%2F');

  const login = await assetRequest(db, '/login?next=%2F');
  assert.equal(login.status, 200);
  assert.match(await login.text(), /loginForm/);

  const cookie = await loginCookie(db);
  const authenticatedLogin = await assetRequest(db, '/login', { headers: { Cookie: cookie } });
  assert.equal(authenticatedLogin.status, 302);
  assert.equal(authenticatedLogin.headers.get('location'), 'https://office.test/');
});

test('Worker todo API creates todos and groups monthly lists by status', async () => {
  const db = new FakeD1();

  const created = await authenticatedRequest(db, '/api/todos', {
    method: 'POST',
    body: JSON.stringify({ title: '写周报', priority: 'high', due_at: '2026-06-19T18:00:00', note: '同步进展' })
  });
  assert.equal(created.res.status, 201);
  assert.equal(created.body.title, '写周报');

  await authenticatedRequest(db, `/api/todos/${created.body.id}/complete`, { method: 'POST' });

  const listed = await authenticatedRequest(db, '/api/todos?month=2026-06');
  assert.deepEqual(listed.body.pending, []);
  assert.equal(listed.body.completed[0].title, '写周报');
});

test('Worker todo monthly list uses status-scoped queries', async () => {
  const db = new FakeD1();

  db.todos.push(
    {
      id: 1,
      title: '未完成',
      priority: 'high',
      note: '',
      due_at: '2026-06-11T09:00:00',
      status: 'pending',
      created_at: '2026-06-01T09:00:00',
      updated_at: '2026-06-01T09:00:00',
      completed_at: null
    },
    {
      id: 2,
      title: '已完成',
      priority: 'low',
      note: '',
      due_at: '2026-06-10T09:00:00',
      status: 'completed',
      created_at: '2026-06-01T09:00:00',
      updated_at: '2026-06-02T09:00:00',
      completed_at: '2026-06-02T09:00:00'
    }
  );

  const listed = await authenticatedRequest(db, '/api/todos?month=2026-06');

  assert.deepEqual(listed.body.pending.map((item) => item.title), ['未完成']);
  assert.deepEqual(listed.body.completed.map((item) => item.title), ['已完成']);
  assert.ok(db.sqlLog.some((sql) => sql.includes("WHERE status='pending' AND due_at >= ? AND due_at < ?")));
  assert.ok(db.sqlLog.some((sql) => sql.includes("WHERE status='completed' AND due_at >= ? AND due_at < ?")));
});

test('Worker notes API creates notes and lists newest first', async () => {
  const db = new FakeD1();

  const created = await authenticatedRequest(db, '/api/notes', {
    method: 'POST',
    body: JSON.stringify({ title: '灵感', body: '# 今天\n\n- 记录一个想法' })
  });
  assert.equal(created.res.status, 201);
  assert.equal(created.body.title, '灵感');
  assert.equal(created.body.body, '# 今天\n\n- 记录一个想法');

  const listed = await authenticatedRequest(db, '/api/notes');
  assert.equal(listed.body.notes.length, 1);
  assert.equal(listed.body.notes[0].title, '灵感');
});

test('Worker countdown API creates lists validates and deletes events', async () => {
  const db = new FakeD1();

  const denied = await request(db, '/api/countdowns');
  assert.equal(denied.res.status, 401);

  const empty = await authenticatedRequest(db, '/api/countdowns');
  assert.equal(empty.res.status, 200);
  assert.deepEqual(empty.body.countdowns, []);

  const invalid = await authenticatedRequest(db, '/api/countdowns', {
    method: 'POST',
    body: JSON.stringify({ title: '旅行', target_date: '2026-02-31' })
  });
  assert.equal(invalid.res.status, 400);

  const created = await authenticatedRequest(db, '/api/countdowns', {
    method: 'POST',
    body: JSON.stringify({ title: '旅行', target_date: '2026-07-01' })
  });
  assert.equal(created.res.status, 201);
  assert.equal(created.body.title, '旅行');
  assert.equal(created.body.target_date, '2026-07-01');
  assert.equal(created.body.event_type, 'once');
  assert.equal(created.body.repeat_month, null);
  assert.equal(created.body.repeat_day, null);

  const monthly = await authenticatedRequest(db, '/api/countdowns', {
    method: 'POST',
    body: JSON.stringify({ title: '发工资', event_type: 'monthly', repeat_day: 15 })
  });
  assert.equal(monthly.res.status, 201);
  assert.equal(monthly.body.event_type, 'monthly');
  assert.equal(monthly.body.repeat_day, 15);
  assert.equal(monthly.body.repeat_month, null);

  const anniversary = await authenticatedRequest(db, '/api/countdowns', {
    method: 'POST',
    body: JSON.stringify({ title: '第一次接吻', event_type: 'anniversary', target_date: '2024-05-20' })
  });
  assert.equal(anniversary.res.status, 201);
  assert.equal(anniversary.body.event_type, 'anniversary');
  assert.equal(anniversary.body.repeat_month, 5);
  assert.equal(anniversary.body.repeat_day, 20);

  const invalidMonthly = await authenticatedRequest(db, '/api/countdowns', {
    method: 'POST',
    body: JSON.stringify({ title: '错误频次', event_type: 'monthly', repeat_day: 32 })
  });
  assert.equal(invalidMonthly.res.status, 400);

  const listed = await authenticatedRequest(db, '/api/countdowns');
  assert.deepEqual(listed.body.countdowns.map((item) => item.title).sort(), ['发工资', '旅行', '第一次接吻'].sort());

  const deleted = await authenticatedRequest(db, `/api/countdowns/${created.body.id}`, { method: 'DELETE' });
  assert.equal(deleted.res.status, 200);
  assert.equal(deleted.body.ok, true);

  const afterDelete = await authenticatedRequest(db, '/api/countdowns');
  assert.deepEqual(afterDelete.body.countdowns.map((item) => item.title).sort(), ['发工资', '第一次接吻'].sort());
});

test('Worker notes API supports nested folders and files', async () => {
  const db = new FakeD1();

  const rootFile = await authenticatedRequest(db, '/api/notes', {
    method: 'POST',
    body: JSON.stringify({ title: '根文件', type: 'file', body: '根目录内容' })
  });
  assert.equal(rootFile.res.status, 201);

  const folder = await authenticatedRequest(db, '/api/notes', {
    method: 'POST',
    body: JSON.stringify({ title: '项目', type: 'folder' })
  });
  assert.equal(folder.res.status, 201);
  assert.equal(folder.body.type, 'folder');
  assert.equal(folder.body.parent_id, null);

  const file = await authenticatedRequest(db, '/api/notes', {
    method: 'POST',
    body: JSON.stringify({ title: '方案', type: 'file', parent_id: folder.body.id, body: '# 方案\n\n内容' })
  });
  assert.equal(file.res.status, 201);
  assert.equal(file.body.type, 'file');
  assert.equal(file.body.parent_id, folder.body.id);

  const root = await authenticatedRequest(db, '/api/notes');
  assert.deepEqual(root.body.path, []);
  assert.deepEqual(root.body.notes.map((item) => item.title), ['项目', '根文件']);

  const nested = await authenticatedRequest(db, `/api/notes?parent_id=${folder.body.id}`);
  assert.deepEqual(nested.body.path.map((item) => item.title), ['项目']);
  assert.deepEqual(nested.body.notes.map((item) => item.title), ['方案']);

  const deleted = await authenticatedRequest(db, `/api/notes/${folder.body.id}`, { method: 'DELETE' });
  assert.equal(deleted.body.ok, true);

  const afterDelete = await authenticatedRequest(db, '/api/notes');
  assert.deepEqual(afterDelete.body.notes.map((item) => item.title), ['根文件']);
  assert.equal(db.notes.length, 1);
});

test('Worker study plan API manages plans items progress and reorder', async () => {
  const db = new FakeD1();

  const denied = await request(db, '/api/study-plans');
  assert.equal(denied.res.status, 401);

  const created = await authenticatedRequest(db, '/api/study-plans', {
    method: 'POST',
    body: JSON.stringify({ title: '李林高数辅导讲义' })
  });
  assert.equal(created.res.status, 201);
  assert.equal(created.body.title, '李林高数辅导讲义');
  assert.equal(created.body.progress_percent, 0);
  assert.equal(created.body.total_items, 0);
  assert.deepEqual(created.body.items, []);

  const first = await authenticatedRequest(db, `/api/study-plans/${created.body.id}/items`, {
    method: 'POST',
    body: JSON.stringify({ title: '函数、极限与连续' })
  });
  assert.equal(first.res.status, 201);
  assert.equal(first.body.status, 'pending');
  assert.equal(first.body.completed_at, null);

  const second = await authenticatedRequest(db, `/api/study-plans/${created.body.id}/items`, {
    method: 'POST',
    body: JSON.stringify({ title: '导数与微分' })
  });
  assert.equal(second.res.status, 201);

  const completed = await authenticatedRequest(db, `/api/study-plan-items/${first.body.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'completed' })
  });
  assert.equal(completed.res.status, 200);
  assert.equal(completed.body.status, 'completed');
  assert.ok(completed.body.completed_at);

  const reordered = await authenticatedRequest(db, `/api/study-plans/${created.body.id}/items/reorder`, {
    method: 'POST',
    body: JSON.stringify({ item_ids: [second.body.id, first.body.id] })
  });
  assert.equal(reordered.res.status, 200);
  assert.deepEqual(reordered.body.items.map((item) => item.title), ['导数与微分', '函数、极限与连续']);

  const listed = await authenticatedRequest(db, '/api/study-plans');
  assert.equal(listed.res.status, 200);
  assert.equal(listed.body.plans[0].total_items, 2);
  assert.equal(listed.body.plans[0].completed_items, 1);
  assert.equal(listed.body.plans[0].progress_percent, 50);
  assert.deepEqual(listed.body.plans[0].items.map((item) => item.title), ['导数与微分', '函数、极限与连续']);

  const renamed = await authenticatedRequest(db, `/api/study-plans/${created.body.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ title: '880高数' })
  });
  assert.equal(renamed.res.status, 200);
  assert.equal(renamed.body.title, '880高数');

  const itemDeleted = await authenticatedRequest(db, `/api/study-plan-items/${second.body.id}`, { method: 'DELETE' });
  assert.equal(itemDeleted.res.status, 200);
  assert.deepEqual(itemDeleted.body, { ok: true });

  const planDeleted = await authenticatedRequest(db, `/api/study-plans/${created.body.id}`, { method: 'DELETE' });
  assert.equal(planDeleted.res.status, 200);
  assert.deepEqual(planDeleted.body, { ok: true });

  const afterDelete = await authenticatedRequest(db, '/api/study-plans');
  assert.deepEqual(afterDelete.body.plans, []);

  const validationDb = new FakeD1();
  const plan = await authenticatedRequest(validationDb, '/api/study-plans', {
    method: 'POST',
    body: JSON.stringify({ title: '880' })
  });
  const base = await authenticatedRequest(validationDb, `/api/study-plans/${plan.body.id}/items`, {
    method: 'POST',
    body: JSON.stringify({ title: '基础篇' })
  });
  const advanced = await authenticatedRequest(validationDb, `/api/study-plans/${plan.body.id}/items`, {
    method: 'POST',
    body: JSON.stringify({ title: '强化篇' })
  });
  const otherPlan = await authenticatedRequest(validationDb, '/api/study-plans', {
    method: 'POST',
    body: JSON.stringify({ title: '660' })
  });
  const otherItem = await authenticatedRequest(validationDb, `/api/study-plans/${otherPlan.body.id}/items`, {
    method: 'POST',
    body: JSON.stringify({ title: '选择题' })
  });

  const invalidOrders = [
    [],
    [base.body.id],
    [base.body.id, base.body.id],
    [base.body.id, otherItem.body.id]
  ];
  for (const item_ids of invalidOrders) {
    const invalid = await authenticatedRequest(validationDb, `/api/study-plans/${plan.body.id}/items/reorder`, {
      method: 'POST',
      body: JSON.stringify({ item_ids })
    });
    assert.equal(invalid.res.status, 400);
    assert.equal(invalid.body.error, '章节排序数据不完整');
  }

  const unchanged = await authenticatedRequest(validationDb, '/api/study-plans');
  const validatedPlan = unchanged.body.plans.find((item) => item.id === plan.body.id);
  assert.deepEqual(validatedPlan.items.map((item) => item.id), [base.body.id, advanced.body.id]);

  const emptyPlan = await authenticatedRequest(validationDb, '/api/study-plans', {
    method: 'POST',
    body: JSON.stringify({ title: '空计划' })
  });
  const emptyReorder = await authenticatedRequest(validationDb, `/api/study-plans/${emptyPlan.body.id}/items/reorder`, {
    method: 'POST',
    body: JSON.stringify({ item_ids: [] })
  });
  assert.equal(emptyReorder.res.status, 200);
  assert.deepEqual(emptyReorder.body.items, []);
});
