const PRIORITY_WEIGHT = { urgent: 4, high: 3, medium: 2, low: 1 };
const VALID_PRIORITIES = new Set(Object.keys(PRIORITY_WEIGHT));
const VALID_STATUS = new Set(['pending', 'completed']);
const VALID_STUDY_ITEM_STATUS = new Set(['pending', 'completed']);
const VALID_NOTE_TYPES = new Set(['file', 'folder']);
const VALID_COUNTDOWN_TYPES = new Set(['once', 'monthly', 'anniversary']);
const SESSION_COOKIE = 'puck_session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const LOGIN_ASSET_PATHS = new Set(['/login', '/login.html']);
const PUBLIC_ASSET_PATHS = new Set(['/style.css', '/app.js', '/markdown.js', '/favicon.svg']);
const encoder = new TextEncoder();
const hmacKeyCache = new Map();

class HttpError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function nowIso() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, '');
}

function json(data, status = 200, headers = {}) {
  return Response.json(data, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      ...headers
    }
  });
}

function bytesToBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function base64UrlToBytes(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(normalized.length + (4 - normalized.length % 4) % 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function timingSafeEqual(left, right) {
  const maxLength = Math.max(left.length, right.length);
  let diff = left.length ^ right.length;
  for (let i = 0; i < maxLength; i += 1) {
    diff |= (left[i] || 0) ^ (right[i] || 0);
  }
  return diff === 0;
}

function parseCookies(header = '') {
  const cookies = new Map();
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    cookies.set(part.slice(0, index).trim(), part.slice(index + 1).trim());
  }
  return cookies;
}

function secretValue(env, name) {
  const value = String(env[name] || '').trim();
  const prefix = `${name}=`;
  return value.startsWith(prefix) ? value.slice(prefix.length).trim() : value;
}

function hasAuthConfig(env) {
  return Boolean(secretValue(env, 'ADMIN_EMAIL') && secretValue(env, 'ADMIN_PASSWORD_HASH') && secretValue(env, 'AUTH_SECRET'));
}

function requireAuthConfig(env) {
  if (!hasAuthConfig(env)) throw new HttpError('登录配置未完成', 500);
}

async function hmacKey(secret) {
  const cached = hmacKeyCache.get(secret);
  if (cached) return cached;
  const key = crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  hmacKeyCache.set(secret, key);
  return key;
}

async function signSessionPayload(payload, secret) {
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(payload));
  return bytesToBase64Url(new Uint8Array(signature));
}

async function verifySessionToken(token, secret) {
  const [payload, signature] = String(token || '').split('.');
  if (!payload || !signature) return null;
  try {
    const valid = await crypto.subtle.verify(
      'HMAC',
      await hmacKey(secret),
      base64UrlToBytes(signature),
      encoder.encode(payload)
    );
    if (!valid) return null;
    const data = JSON.parse(new TextDecoder().decode(base64UrlToBytes(payload)));
    if (!data.exp || data.exp < Math.floor(Date.now() / 1000)) return null;
    return data;
  } catch {
    return null;
  }
}

async function createSessionCookie(email, secret, url) {
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const payload = bytesToBase64Url(encoder.encode(JSON.stringify({ email, exp: expiresAt })));
  const signature = await signSessionPayload(payload, secret);
  const secure = url.protocol === 'https:' ? '; Secure' : '';
  return `${SESSION_COOKIE}=${payload}.${signature}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}${secure}`;
}

function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

async function getSessionUser(request, env) {
  if (!hasAuthConfig(env)) return null;
  const cookies = parseCookies(request.headers.get('Cookie') || '');
  const adminEmail = secretValue(env, 'ADMIN_EMAIL');
  const session = await verifySessionToken(cookies.get(SESSION_COOKIE), secretValue(env, 'AUTH_SECRET'));
  if (!session || String(session.email).toLowerCase() !== adminEmail.toLowerCase()) return null;
  return { email: adminEmail };
}

async function verifyPassword(password, passwordHash) {
  const [scheme, iterationsValue, saltValue, expectedValue] = String(passwordHash || '').split('$');
  const iterations = Number(iterationsValue);
  if (scheme !== 'pbkdf2_sha256' || !Number.isInteger(iterations) || iterations < 10000 || !saltValue || !expectedValue) return false;
  try {
    const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt: base64UrlToBytes(saltValue), iterations },
      key,
      256
    );
    return timingSafeEqual(new Uint8Array(bits), base64UrlToBytes(expectedValue));
  } catch {
    return false;
  }
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

function normalizeCountdown(row) {
  return {
    ...row,
    event_type: row.event_type || 'once',
    target_date: String(row.target_date || '').slice(0, 10),
    repeat_month: row.repeat_month ?? null,
    repeat_day: row.repeat_day ?? null
  };
}

function normalizeStudyPlan(row, items = []) {
  const total_items = items.length;
  const completed_items = items.filter((item) => item.status === 'completed').length;
  return {
    ...row,
    items,
    total_items,
    completed_items,
    progress_percent: total_items ? Math.round((completed_items / total_items) * 100) : 0
  };
}

function normalizeStudyPlanItem(row) {
  return {
    ...row,
    status: row.status || 'pending',
    completed_at: row.completed_at ?? null
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

function isValidDateString(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function clampDay(year, month, day) {
  return Math.min(day, daysInMonth(year, month));
}

function dateStringFromParts(year, month, day) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function validateCountdownPayload(payload) {
  const title = String(payload.title || '').trim();
  const event_type = String(payload.event_type || 'once').trim();
  let target_date = String(payload.target_date || '').trim();
  let repeat_month = payload.repeat_month ?? null;
  let repeat_day = payload.repeat_day ?? null;

  if (!title) throw new HttpError('事件名称不能为空');
  if (!VALID_COUNTDOWN_TYPES.has(event_type)) throw new HttpError('事件类型不合法');

  if (event_type === 'once') {
    if (!isValidDateString(target_date)) throw new HttpError('日期格式必须是 YYYY-MM-DD');
    return { title, target_date, event_type, repeat_month: null, repeat_day: null };
  }

  if (event_type === 'monthly') {
    repeat_day = Number(repeat_day);
    if (!Number.isInteger(repeat_day) || repeat_day < 1 || repeat_day > 31) throw new HttpError('每月日期必须是 1-31');
    const now = new Date();
    const month = now.getUTCMonth() + 1;
    target_date = dateStringFromParts(now.getUTCFullYear(), month, clampDay(now.getUTCFullYear(), month, repeat_day));
    return { title, target_date, event_type, repeat_month: null, repeat_day };
  }

  if (!isValidDateString(target_date)) throw new HttpError('日期格式必须是 YYYY-MM-DD');
  const [year, month, day] = target_date.split('-').map(Number);
  repeat_month = month;
  repeat_day = day;
  return { title, target_date, event_type, repeat_month, repeat_day };
}

function validateStudyPlanPayload(payload) {
  const title = String(payload.title || '').trim();
  if (!title) throw new HttpError('学习计划名称不能为空');
  return { title };
}

function validateStudyPlanItemPayload(payload, partial = false) {
  const updates = {};
  if ('title' in payload || !partial) {
    updates.title = String(payload.title || '').trim();
    if (!updates.title) throw new HttpError('章节名称不能为空');
  }
  if ('status' in payload) {
    updates.status = String(payload.status || '');
    if (!VALID_STUDY_ITEM_STATUS.has(updates.status)) throw new HttpError('章节状态必须是 pending/completed');
  }
  return updates;
}

async function getTodo(db, id) {
  const row = await db.prepare('SELECT * FROM todos WHERE id=?').bind(id).first();
  if (!row) throw new HttpError('待办不存在', 404);
  return normalizeTodo(row);
}

async function listTodos(db, month) {
  const [start, end] = monthRange(month);
  const [{ results: pendingRows = [] }, { results: completedRows = [] }] = await Promise.all([
    db.prepare(`
    SELECT * FROM todos WHERE status='pending' AND due_at >= ? AND due_at < ?
    ORDER BY CASE priority WHEN 'urgent' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END DESC,
             due_at ASC, created_at ASC
  `).bind(start, end).all(),
    db.prepare(`
    SELECT * FROM todos WHERE status='completed' AND due_at >= ? AND due_at < ?
    ORDER BY completed_at DESC, due_at ASC, created_at ASC
  `).bind(start, end).all()
  ]);
  return {
    month,
    pending: pendingRows.map(normalizeTodo),
    completed: completedRows.map(normalizeTodo)
  };
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

async function getCountdown(db, id) {
  const row = await db.prepare('SELECT * FROM countdowns WHERE id=?').bind(id).first();
  if (!row) throw new HttpError('倒数日不存在', 404);
  return normalizeCountdown(row);
}

async function listCountdowns(db) {
  const { results = [] } = await db.prepare('SELECT * FROM countdowns ORDER BY target_date ASC, created_at ASC').all();
  return { countdowns: results.map(normalizeCountdown) };
}

async function createCountdown(db, payload) {
  const data = validateCountdownPayload(payload);
  const now = nowIso();
  const result = await db.prepare('INSERT INTO countdowns (title, target_date, event_type, repeat_month, repeat_day, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(data.title, data.target_date, data.event_type, data.repeat_month, data.repeat_day, now, now).run();
  return getCountdown(db, result.meta.last_row_id);
}

async function deleteCountdown(db, id) {
  const result = await db.prepare('DELETE FROM countdowns WHERE id=?').bind(id).run();
  return { ok: result.meta.changes > 0 };
}

async function getStudyPlan(db, id) {
  const row = await db.prepare('SELECT * FROM study_plans WHERE id=?').bind(id).first();
  if (!row) throw new HttpError('学习计划不存在', 404);
  const { results = [] } = await db.prepare('SELECT * FROM study_plan_items WHERE plan_id=? ORDER BY position ASC, created_at ASC').bind(id).all();
  return normalizeStudyPlan(row, results.map(normalizeStudyPlanItem));
}

async function listStudyPlans(db) {
  const [{ results: planRows = [] }, { results: itemRows = [] }] = await Promise.all([
    db.prepare('SELECT * FROM study_plans ORDER BY created_at DESC, id DESC').all(),
    db.prepare('SELECT * FROM study_plan_items ORDER BY plan_id ASC, position ASC, created_at ASC').all()
  ]);
  const itemsByPlan = new Map(planRows.map((plan) => [plan.id, []]));
  for (const row of itemRows) {
    if (itemsByPlan.has(row.plan_id)) itemsByPlan.get(row.plan_id).push(normalizeStudyPlanItem(row));
  }
  return { plans: planRows.map((plan) => normalizeStudyPlan(plan, itemsByPlan.get(plan.id))) };
}

async function createStudyPlan(db, payload) {
  const data = validateStudyPlanPayload(payload);
  const now = nowIso();
  const result = await db.prepare('INSERT INTO study_plans (title, created_at, updated_at) VALUES (?, ?, ?)').bind(data.title, now, now).run();
  return getStudyPlan(db, result.meta.last_row_id);
}

async function updateStudyPlan(db, id, payload) {
  const updates = {};
  if ('title' in payload) updates.title = validateStudyPlanPayload(payload).title;
  if (!Object.keys(updates).length) return getStudyPlan(db, id);
  updates.updated_at = nowIso();
  const assignments = Object.keys(updates).map((key) => `${key}=?`).join(', ');
  const result = await db.prepare(`UPDATE study_plans SET ${assignments} WHERE id=?`).bind(...Object.values(updates), id).run();
  if (!result.meta.changes) throw new HttpError('学习计划不存在', 404);
  return getStudyPlan(db, id);
}

async function deleteStudyPlan(db, id) {
  await db.prepare('DELETE FROM study_plan_items WHERE plan_id=?').bind(id).run();
  const result = await db.prepare('DELETE FROM study_plans WHERE id=?').bind(id).run();
  return { ok: result.meta.changes > 0 };
}

async function getStudyPlanItem(db, id) {
  const row = await db.prepare('SELECT * FROM study_plan_items WHERE id=?').bind(id).first();
  if (!row) throw new HttpError('章节不存在', 404);
  return normalizeStudyPlanItem(row);
}

async function createStudyPlanItem(db, planId, payload) {
  const data = validateStudyPlanItemPayload(payload);
  const plan = await db.prepare('SELECT id FROM study_plans WHERE id=?').bind(planId).first();
  if (!plan) throw new HttpError('学习计划不存在', 404);
  const positionRow = await db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS position FROM study_plan_items WHERE plan_id=?').bind(planId).first();
  const now = nowIso();
  const result = await db.prepare(`
    INSERT INTO study_plan_items (plan_id, title, status, position, created_at, updated_at)
    VALUES (?, ?, 'pending', ?, ?, ?)
  `).bind(planId, data.title, positionRow.position, now, now).run();
  await db.prepare('UPDATE study_plans SET updated_at=? WHERE id=?').bind(now, planId).run();
  return getStudyPlanItem(db, result.meta.last_row_id);
}

async function updateStudyPlanItem(db, id, payload) {
  const updates = validateStudyPlanItemPayload(payload, true);
  const keys = Object.keys(updates);
  if (!keys.length) return getStudyPlanItem(db, id);
  const item = await getStudyPlanItem(db, id);
  const now = nowIso();
  updates.updated_at = now;
  if (updates.status === 'completed') updates.completed_at = now;
  if (updates.status === 'pending') updates.completed_at = null;
  const assignments = Object.keys(updates).map((key) => `${key}=?`).join(', ');
  const result = await db.prepare(`UPDATE study_plan_items SET ${assignments} WHERE id=?`).bind(...Object.values(updates), id).run();
  if (!result.meta.changes) throw new HttpError('章节不存在', 404);
  await db.prepare('UPDATE study_plans SET updated_at=? WHERE id=?').bind(now, item.plan_id).run();
  return getStudyPlanItem(db, id);
}

async function deleteStudyPlanItem(db, id) {
  const row = await db.prepare('SELECT * FROM study_plan_items WHERE id=?').bind(id).first();
  if (!row) return { ok: false };
  const now = nowIso();
  const result = await db.prepare('DELETE FROM study_plan_items WHERE id=?').bind(id).run();
  await db.prepare('UPDATE study_plans SET updated_at=? WHERE id=?').bind(now, row.plan_id).run();
  return { ok: result.meta.changes > 0 };
}

async function reorderStudyPlanItems(db, planId, payload) {
  const plan = await db.prepare('SELECT * FROM study_plans WHERE id=?').bind(planId).first();
  if (!plan) throw new HttpError('学习计划不存在', 404);
  if (!Array.isArray(payload.item_ids)) throw new HttpError('章节排序数据不完整');
  const itemIds = payload.item_ids.map(toId);
  const { results = [] } = await db.prepare('SELECT id FROM study_plan_items WHERE plan_id=?').bind(planId).all();
  const existingIds = results.map((row) => row.id);
  if (!itemIds.length) {
    if (existingIds.length) throw new HttpError('章节排序数据不完整');
    return normalizeStudyPlan(plan, []);
  }
  const existingSet = new Set(existingIds);
  const itemSet = new Set(itemIds);
  if (itemSet.size !== itemIds.length || itemIds.length !== existingIds.length || itemIds.some((id) => !existingSet.has(id))) {
    throw new HttpError('章节排序数据不完整');
  }
  const now = nowIso();
  for (const [index, itemId] of itemIds.entries()) {
    await db.prepare('UPDATE study_plan_items SET position=?, updated_at=? WHERE id=?').bind(index + 1, now, itemId).run();
  }
  await db.prepare('UPDATE study_plans SET updated_at=? WHERE id=?').bind(now, planId).run();
  return getStudyPlan(db, planId);
}

async function handleAuthApi(request, env, url) {
  const path = url.pathname;
  const method = request.method;

  if (method === 'GET' && path === '/api/auth/status') {
    const user = await getSessionUser(request, env);
    return json({ authenticated: Boolean(user), email: user?.email || null, configured: hasAuthConfig(env) });
  }

  if (method === 'POST' && path === '/api/auth/login') {
    requireAuthConfig(env);
    const payload = await readJson(request);
    const email = String(payload.email || '').trim().toLowerCase();
    const password = String(payload.password || '');
    const adminEmail = secretValue(env, 'ADMIN_EMAIL');
    const validEmail = email === adminEmail.toLowerCase();
    const validPassword = await verifyPassword(password, secretValue(env, 'ADMIN_PASSWORD_HASH'));
    if (!validEmail || !validPassword) throw new HttpError('账号或密码错误', 401);
    const cookie = await createSessionCookie(adminEmail, secretValue(env, 'AUTH_SECRET'), url);
    return json({ ok: true }, 200, { 'Set-Cookie': cookie });
  }

  if (method === 'POST' && path === '/api/auth/logout') {
    return json({ ok: true }, 200, { 'Set-Cookie': clearSessionCookie() });
  }

  throw new HttpError('Not found', 404);
}

async function handleApi(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;
  const parts = path.split('/').filter(Boolean);

  if (method === 'GET' && path === '/api/health') return json({ ok: true });
  if (path.startsWith('/api/auth/')) return await handleAuthApi(request, env, url);

  const user = await getSessionUser(request, env);
  if (!user) throw new HttpError('请先登录', 401);
  if (!env.DB) throw new HttpError('D1 数据库未绑定', 500);

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

  if (parts[1] === 'countdowns') {
    if (method === 'GET' && parts.length === 2) return json(await listCountdowns(env.DB));
    if (method === 'POST' && parts.length === 2) return json(await createCountdown(env.DB, await readJson(request)), 201);
    if (parts.length === 3) {
      const id = toId(parts[2]);
      if (method === 'DELETE') return json(await deleteCountdown(env.DB, id));
    }
  }

  if (parts[1] === 'study-plans') {
    if (method === 'GET' && parts.length === 2) return json(await listStudyPlans(env.DB));
    if (method === 'POST' && parts.length === 2) return json(await createStudyPlan(env.DB, await readJson(request)), 201);
    if (parts.length >= 3) {
      const id = toId(parts[2]);
      if (method === 'PATCH' && parts.length === 3) return json(await updateStudyPlan(env.DB, id, await readJson(request)));
      if (method === 'DELETE' && parts.length === 3) return json(await deleteStudyPlan(env.DB, id));
      if (method === 'POST' && parts.length === 4 && parts[3] === 'items') return json(await createStudyPlanItem(env.DB, id, await readJson(request)), 201);
      if (method === 'POST' && parts.length === 5 && parts[3] === 'items' && parts[4] === 'reorder') {
        return json(await reorderStudyPlanItems(env.DB, id, await readJson(request)));
      }
    }
  }

  if (parts[1] === 'study-plan-items' && parts.length === 3) {
    const id = toId(parts[2]);
    if (method === 'PATCH') return json(await updateStudyPlanItem(env.DB, id, await readJson(request)));
    if (method === 'DELETE') return json(await deleteStudyPlanItem(env.DB, id));
  }

  throw new HttpError('Not found', 404);
}

function isPublicAsset(path) {
  return LOGIN_ASSET_PATHS.has(path) || PUBLIC_ASSET_PATHS.has(path);
}

async function serveAsset(request, env, url) {
  if (!env.ASSETS) return new Response('Not found', { status: 404 });
  if (LOGIN_ASSET_PATHS.has(url.pathname)) {
    const user = await getSessionUser(request, env);
    if (user) return Response.redirect(new URL('/', url), 302);
    return env.ASSETS.fetch(request);
  }
  if (isPublicAsset(url.pathname)) return env.ASSETS.fetch(request);
  const user = await getSessionUser(request, env);
  if (user) return env.ASSETS.fetch(request);
  const loginUrl = new URL('/login', url);
  loginUrl.searchParams.set('next', `${url.pathname}${url.search}`);
  return Response.redirect(loginUrl, 302);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname.startsWith('/api/')) return await handleApi(request, env);
      return await serveAsset(request, env, url);
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      console.error(JSON.stringify({ message: 'request failed', path: url.pathname, status, error: error.message }));
      return json({ error: error.message || '服务器错误' }, status);
    }
  }
};

export {
  createCountdown,
  createNote,
  createStudyPlan,
  createStudyPlanItem,
  createTodo,
  listCountdowns,
  listNotes,
  listStudyPlans,
  listTodos,
  monthRange,
  reorderStudyPlanItems,
  validateCountdownPayload,
  validateNotePayload,
  validateStudyPlanItemPayload,
  validateStudyPlanPayload,
  validateTodoPayload
};
