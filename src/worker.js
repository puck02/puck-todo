const PRIORITY_WEIGHT = { urgent: 4, high: 3, medium: 2, low: 1 };
const VALID_PRIORITIES = new Set(Object.keys(PRIORITY_WEIGHT));
const VALID_STATUS = new Set(['pending', 'completed']);
const VALID_NOTE_TYPES = new Set(['file', 'folder']);

class HttpError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function nowIso() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, '');
}

function json(data, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      'Cache-Control': 'no-store'
    }
  });
}

function normalizeTodo(row) {
  return {
    ...row,
    priority_label: { urgent: '紧急', high: '高', medium: '中', low: '低' }[row.priority] || row.priority
  };
}

function normalizeNote(row) {
  return {
    ...row,
    type: row.type || 'file',
    parent_id: row.parent_id ?? null,
    body: row.body || ''
  };
}

function monthRange(month) {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new HttpError('月份格式必须是 YYYY-MM');
  const [year, monthIndex] = month.split('-').map(Number);
  const start = new Date(Date.UTC(year, monthIndex - 1, 1));
  const end = new Date(Date.UTC(year, monthIndex, 1));
  return [start.toISOString().slice(0, 19), end.toISOString().slice(0, 19)];
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

function toId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError('资源 ID 不合法');
  return id;
}

function validateTodoPayload(payload, partial = false) {
  const updates = {};
  if ('title' in payload || !partial) {
    updates.title = String(payload.title || '').trim();
    if (!updates.title) throw new HttpError('事件名称不能为空');
  }
  if ('priority' in payload || !partial) {
    updates.priority = String(payload.priority || 'medium');
    if (!VALID_PRIORITIES.has(updates.priority)) throw new HttpError('优先级必须是 low/medium/high/urgent');
  }
  if ('note' in payload || !partial) {
    updates.note = String(payload.note || '').trim();
  }
  if ('due_at' in payload || !partial) {
    updates.due_at = String(payload.due_at || '');
    if (Number.isNaN(Date.parse(updates.due_at))) throw new HttpError('截止时间不合法');
  }
  if ('status' in payload) {
    updates.status = String(payload.status || '');
    if (!VALID_STATUS.has(updates.status)) throw new HttpError('状态必须是 pending/completed');
  }
  return updates;
}

function validateNotePayload(payload, partial = false) {
  const updates = {};
  if ('title' in payload || !partial) {
    updates.title = String(payload.title || '').trim();
    if (!updates.title) throw new HttpError('笔记标题不能为空');
  }
  if ('type' in payload || !partial) {
    updates.type = String(payload.type || 'file');
    if (!VALID_NOTE_TYPES.has(updates.type)) throw new HttpError('笔记类型必须是 file/folder');
  }
  if ('parent_id' in payload || !partial) {
    const parentId = payload.parent_id ?? null;
    updates.parent_id = parentId === null || parentId === '' ? null : toId(parentId);
  }
  if ('body' in payload || !partial) {
    updates.body = String(payload.body || '');
  }
  if (updates.type === 'folder') updates.body = '';
  return updates;
}

async function getTodo(db, id) {
  const row = await db.prepare('SELECT * FROM todos WHERE id=?').bind(id).first();
  if (!row) throw new HttpError('待办不存在', 404);
  return normalizeTodo(row);
}

async function listTodos(db, month) {
  const [start, end] = monthRange(month);
  const { results = [] } = await db.prepare(`
    SELECT * FROM todos WHERE due_at >= ? AND due_at < ?
    ORDER BY CASE priority WHEN 'urgent' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END DESC,
             due_at ASC, created_at ASC
  `).bind(start, end).all();
  const items = results.map(normalizeTodo);
  const pending = items.filter((item) => item.status === 'pending');
  const completed = items
    .filter((item) => item.status === 'completed')
    .sort((a, b) => String(b.completed_at || '').localeCompare(String(a.completed_at || '')));
  return { month, pending, completed };
}

async function createTodo(db, payload) {
  const data = validateTodoPayload(payload);
  const now = nowIso();
  const result = await db.prepare(`
    INSERT INTO todos (title, priority, note, due_at, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'pending', ?, ?)
  `).bind(data.title, data.priority, data.note, data.due_at, now, now).run();
  return getTodo(db, result.meta.last_row_id);
}

async function updateTodo(db, id, payload) {
  const updates = validateTodoPayload(payload, true);
  const keys = Object.keys(updates);
  if (!keys.length) return getTodo(db, id);
  updates.updated_at = nowIso();
  if (updates.status === 'completed') updates.completed_at = updates.updated_at;
  if (updates.status === 'pending') updates.completed_at = null;
  const assignments = Object.keys(updates).map((key) => `${key}=?`).join(', ');
  const params = [...Object.values(updates), id];
  const result = await db.prepare(`UPDATE todos SET ${assignments} WHERE id=?`).bind(...params).run();
  if (!result.meta.changes) throw new HttpError('待办不存在', 404);
  return getTodo(db, id);
}

async function completeTodo(db, id) {
  const now = nowIso();
  const result = await db.prepare("UPDATE todos SET status='completed', completed_at=?, updated_at=? WHERE id=?").bind(now, now, id).run();
  if (!result.meta.changes) throw new HttpError('待办不存在', 404);
  return getTodo(db, id);
}

async function uncompleteTodo(db, id) {
  const now = nowIso();
  const result = await db.prepare("UPDATE todos SET status='pending', completed_at=NULL, updated_at=? WHERE id=?").bind(now, id).run();
  if (!result.meta.changes) throw new HttpError('待办不存在', 404);
  return getTodo(db, id);
}

async function deleteTodo(db, id) {
  const result = await db.prepare('DELETE FROM todos WHERE id=?').bind(id).run();
  return { ok: result.meta.changes > 0 };
}

async function getNote(db, id) {
  const row = await db.prepare('SELECT * FROM notes WHERE id=?').bind(id).first();
  if (!row) throw new HttpError('笔记不存在', 404);
  return normalizeNote(row);
}

async function getNotePath(db, parentId) {
  const path = [];
  let currentId = parentId;
  while (currentId) {
    const item = await getNote(db, currentId);
    if (item.type !== 'folder') throw new HttpError('父级必须是文件夹');
    path.unshift({ id: item.id, title: item.title });
    currentId = item.parent_id;
  }
  return path;
}

async function listNotes(db, parentId = null) {
  const statement = parentId
    ? db.prepare("SELECT * FROM notes WHERE parent_id=? ORDER BY CASE type WHEN 'folder' THEN 0 ELSE 1 END ASC, updated_at DESC, created_at DESC").bind(parentId)
    : db.prepare("SELECT * FROM notes WHERE parent_id IS NULL ORDER BY CASE type WHEN 'folder' THEN 0 ELSE 1 END ASC, updated_at DESC, created_at DESC");
  const { results = [] } = await statement.all();
  return { parent_id: parentId, path: await getNotePath(db, parentId), notes: results.map(normalizeNote) };
}

async function createNote(db, payload) {
  const data = validateNotePayload(payload);
  if (data.parent_id) {
    const parent = await getNote(db, data.parent_id);
    if (parent.type !== 'folder') throw new HttpError('父级必须是文件夹');
  }
  const now = nowIso();
  const result = await db.prepare('INSERT INTO notes (title, body, type, parent_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').bind(data.title, data.body, data.type, data.parent_id, now, now).run();
  return getNote(db, result.meta.last_row_id);
}

async function updateNote(db, id, payload) {
  const updates = validateNotePayload(payload, true);
  if (updates.parent_id) {
    if (updates.parent_id === id) throw new HttpError('不能移动到自身');
    const parent = await getNote(db, updates.parent_id);
    if (parent.type !== 'folder') throw new HttpError('父级必须是文件夹');
  }
  const keys = Object.keys(updates);
  if (!keys.length) return getNote(db, id);
  updates.updated_at = nowIso();
  const assignments = Object.keys(updates).map((key) => `${key}=?`).join(', ');
  const result = await db.prepare(`UPDATE notes SET ${assignments} WHERE id=?`).bind(...Object.values(updates), id).run();
  if (!result.meta.changes) throw new HttpError('笔记不存在', 404);
  return getNote(db, id);
}

async function deleteNote(db, id) {
  const item = await getNote(db, id);
  if (item.type === 'folder') {
    await db.prepare('DELETE FROM notes WHERE id IN (WITH RECURSIVE descendants(id) AS (SELECT id FROM notes WHERE id=? UNION ALL SELECT notes.id FROM notes INNER JOIN descendants ON notes.parent_id=descendants.id) SELECT id FROM descendants)').bind(id).run();
    return { ok: true };
  }
  const result = await db.prepare('DELETE FROM notes WHERE id=?').bind(id).run();
  return { ok: result.meta.changes > 0 };
}

async function handleApi(request, env) {
  if (!env.DB) throw new HttpError('D1 数据库未绑定', 500);

  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;
  const parts = path.split('/').filter(Boolean);

  if (method === 'GET' && path === '/api/health') return json({ ok: true });

  if (parts[1] === 'todos') {
    if (method === 'GET' && parts.length === 2) {
      const month = url.searchParams.get('month') || new Date().toISOString().slice(0, 7);
      return json(await listTodos(env.DB, month));
    }
    if (method === 'POST' && parts.length === 2) return json(await createTodo(env.DB, await readJson(request)), 201);
    if (parts.length >= 3) {
      const id = toId(parts[2]);
      if (method === 'PATCH' && parts.length === 3) return json(await updateTodo(env.DB, id, await readJson(request)));
      if (method === 'DELETE' && parts.length === 3) return json(await deleteTodo(env.DB, id));
      if (method === 'POST' && parts[3] === 'complete') return json(await completeTodo(env.DB, id));
      if (method === 'POST' && parts[3] === 'uncomplete') return json(await uncompleteTodo(env.DB, id));
    }
  }

  if (parts[1] === 'notes') {
    if (method === 'GET' && parts.length === 2) {
      const parentIdParam = url.searchParams.get('parent_id');
      const parentId = parentIdParam ? toId(parentIdParam) : null;
      return json(await listNotes(env.DB, parentId));
    }
    if (method === 'POST' && parts.length === 2) return json(await createNote(env.DB, await readJson(request)), 201);
    if (parts.length === 3) {
      const id = toId(parts[2]);
      if (method === 'GET') return json(await getNote(env.DB, id));
      if (method === 'PATCH') return json(await updateNote(env.DB, id, await readJson(request)));
      if (method === 'DELETE') return json(await deleteNote(env.DB, id));
    }
  }

  throw new HttpError('Not found', 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname.startsWith('/api/')) return await handleApi(request, env);
      if (env.ASSETS) return env.ASSETS.fetch(request);
      return new Response('Not found', { status: 404 });
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      console.error(JSON.stringify({ message: 'request failed', path: url.pathname, status, error: error.message }));
      return json({ error: error.message || '服务器错误' }, status);
    }
  }
};

export {
  createNote,
  createTodo,
  listNotes,
  listTodos,
  monthRange,
  validateNotePayload,
  validateTodoPayload
};
