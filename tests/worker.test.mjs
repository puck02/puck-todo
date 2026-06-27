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
    this.todos = [];
    this.notes = [];
    this.countdowns = [];
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
    if (sql.startsWith("UPDATE todos SET status='completed'")) {
      const [now, , id] = this.params;
      const todo = this.db.todos.find((item) => item.id === id);
      if (!todo) return { meta: { changes: 0 } };
      todo.status = 'completed';
      todo.completed_at = now;
      todo.updated_at = now;
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
