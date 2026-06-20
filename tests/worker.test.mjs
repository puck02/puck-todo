import assert from 'node:assert/strict';
import test from 'node:test';

import worker from '../src/worker.js';

class FakeD1 {
  constructor() {
    this.nextTodoId = 1;
    this.nextNoteId = 1;
    this.todos = [];
    this.notes = [];
  }

  prepare(sql) {
    return new FakeStatement(this, sql);
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

async function request(db, path, options = {}) {
  const res = await worker.fetch(new Request(`https://office.test${path}`, options), { DB: db });
  const body = await res.json();
  return { res, body };
}

test('Worker todo API creates todos and groups monthly lists by status', async () => {
  const db = new FakeD1();

  const created = await request(db, '/api/todos', {
    method: 'POST',
    body: JSON.stringify({ title: '写周报', priority: 'high', due_at: '2026-06-19T18:00:00', note: '同步进展' })
  });
  assert.equal(created.res.status, 201);
  assert.equal(created.body.title, '写周报');

  await request(db, `/api/todos/${created.body.id}/complete`, { method: 'POST' });

  const listed = await request(db, '/api/todos?month=2026-06');
  assert.deepEqual(listed.body.pending, []);
  assert.equal(listed.body.completed[0].title, '写周报');
});

test('Worker notes API creates notes and lists newest first', async () => {
  const db = new FakeD1();

  const created = await request(db, '/api/notes', {
    method: 'POST',
    body: JSON.stringify({ title: '灵感', body: '# 今天\n\n- 记录一个想法' })
  });
  assert.equal(created.res.status, 201);
  assert.equal(created.body.title, '灵感');
  assert.equal(created.body.body, '# 今天\n\n- 记录一个想法');

  const listed = await request(db, '/api/notes');
  assert.equal(listed.body.notes.length, 1);
  assert.equal(listed.body.notes[0].title, '灵感');
});

test('Worker notes API supports nested folders and files', async () => {
  const db = new FakeD1();

  const rootFile = await request(db, '/api/notes', {
    method: 'POST',
    body: JSON.stringify({ title: '根文件', type: 'file', body: '根目录内容' })
  });
  assert.equal(rootFile.res.status, 201);

  const folder = await request(db, '/api/notes', {
    method: 'POST',
    body: JSON.stringify({ title: '项目', type: 'folder' })
  });
  assert.equal(folder.res.status, 201);
  assert.equal(folder.body.type, 'folder');
  assert.equal(folder.body.parent_id, null);

  const file = await request(db, '/api/notes', {
    method: 'POST',
    body: JSON.stringify({ title: '方案', type: 'file', parent_id: folder.body.id, body: '# 方案\n\n内容' })
  });
  assert.equal(file.res.status, 201);
  assert.equal(file.body.type, 'file');
  assert.equal(file.body.parent_id, folder.body.id);

  const root = await request(db, '/api/notes');
  assert.deepEqual(root.body.path, []);
  assert.deepEqual(root.body.notes.map((item) => item.title), ['项目', '根文件']);

  const nested = await request(db, `/api/notes?parent_id=${folder.body.id}`);
  assert.deepEqual(nested.body.path.map((item) => item.title), ['项目']);
  assert.deepEqual(nested.body.notes.map((item) => item.title), ['方案']);

  const deleted = await request(db, `/api/notes/${folder.body.id}`, { method: 'DELETE' });
  assert.equal(deleted.body.ok, true);

  const afterDelete = await request(db, '/api/notes');
  assert.deepEqual(afterDelete.body.notes.map((item) => item.title), ['根文件']);
  assert.equal(db.notes.length, 1);
});
