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
      const [title, body, now] = this.params;
      const id = this.db.nextNoteId++;
      this.db.notes.push({ id, title, body, created_at: now, updated_at: now });
      return { meta: { last_row_id: id, changes: 1 } };
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
