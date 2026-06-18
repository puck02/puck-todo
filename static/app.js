import { renderMarkdown } from '/markdown.js';

const state = {
  month: '',
  data: { pending: [], completed: [] },
  notes: []
};

const $ = (id) => document.getElementById(id);
const monthPicker = $('monthPicker');
const pendingList = $('pendingList');
const completedList = $('completedList');
const pendingMeta = $('pendingMeta');
const completedMeta = $('completedMeta');
const notesList = $('notesList');
const notesMeta = $('notesMeta');
const toastEl = $('toast');
const editModal = $('editModal');
const closeEditModal = $('closeEditModal');
const cancelEdit = $('cancelEdit');
const editForm = $('editForm');
const editTitleInput = $('editTitleInput');
const editPriorityInput = $('editPriorityInput');
const editDueInput = $('editDueInput');
const editNoteInput = $('editNoteInput');
const noteForm = $('noteForm');
const noteTitleInput = $('noteTitleInput');
const noteMarkdownInput = $('noteMarkdownInput');
const notePreview = $('notePreview');
const saveNoteButton = $('saveNoteButton');
const cancelNoteEdit = $('cancelNoteEdit');

const editState = { currentId: null };
const noteState = { currentId: null };

const dailyQuotes = [
  { text: '一切都在流动。', author: '赫拉克利特' },
  { text: '成为你自己。', author: '尼采' },
  { text: '人应当诗意地栖居。', author: '荷尔德林' },
  { text: '生活在别处。', author: '兰波' },
  { text: '我思故我在。', author: '笛卡尔' },
  { text: '未经审视的人生不值得过。', author: '苏格拉底' },
  { text: '人是万物的尺度。', author: '普罗泰戈拉' },
  { text: '重要的是不要停止发问。', author: '爱因斯坦' },
  { text: '自由是对必然的认识。', author: '斯宾诺莎' },
  { text: '认识你自己。', author: '德尔斐箴言' },
  { text: '凡是过往，皆为序章。', author: '莎士比亚' },
  { text: '今日事，今日毕。', author: '富兰克林' },
  { text: '把时间当作朋友。', author: '李笑来' },
  { text: '行动胜过空想。', author: '歌德' },
  { text: '去生活，而不是解释生活。', author: '加缪' }
];

function dayOfYear(date) {
  const start = new Date(date.getFullYear(), 0, 0);
  const diff = date - start + ((start.getTimezoneOffset() - date.getTimezoneOffset()) * 60 * 1000);
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

function renderDailyQuote(date = new Date()) {
  const quote = dailyQuotes[(dayOfYear(date) - 1) % dailyQuotes.length];
  const quoteText = $('quoteText');
  const quoteAuthor = $('quoteAuthor');
  if (!quoteText || !quoteAuthor) return;
  quoteText.textContent = quote.text;
  quoteAuthor.textContent = `-- ${quote.author}`;
}

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function apiHeaders(extra = {}) {
  return { 'Content-Type': 'application/json', ...extra };
}

async function request(path, options = {}) {
  const res = await fetch(path, { ...options, headers: apiHeaders(options.headers || {}) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `请求失败：${res.status}`);
  return data;
}

function toast(message) {
  toastEl.textContent = message;
  toastEl.classList.add('show');
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2200);
}

function priorityLabel(priority) {
  return { urgent: '紧急', high: '高', medium: '中', low: '低' }[priority] || priority;
}

function formatDue(iso) {
  const d = new Date(iso);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${m}/${day} ${h}:${min}`;
}

function renderTodoNote(note) {
  if (!note) return null;
  const noteEl = document.createElement('div');
  noteEl.className = 'todo-note markdown-preview compact-markdown';
  noteEl.innerHTML = renderMarkdown(note);
  return noteEl;
}

function updateNotePreview() {
  const html = renderMarkdown(noteMarkdownInput.value);
  notePreview.classList.toggle('empty-preview', !html);
  notePreview.innerHTML = html || '开始输入后显示预览。';
}

function resetNoteForm() {
  noteState.currentId = null;
  noteForm.reset();
  saveNoteButton.textContent = '保存笔记';
  cancelNoteEdit.classList.add('hidden');
  updateNotePreview();
}

function openEditModal(item) {
  editState.currentId = item.id;
  editTitleInput.value = item.title || '';
  editPriorityInput.value = item.priority || 'medium';
  editDueInput.value = (item.due_at || '').slice(0, 16);
  editNoteInput.value = item.note || '';
  editModal.classList.remove('hidden');
  editModal.setAttribute('aria-hidden', 'false');
  editTitleInput.focus();
}

function closeEditModalFn() {
  editState.currentId = null;
  editForm.reset();
  editModal.classList.add('hidden');
  editModal.setAttribute('aria-hidden', 'true');
}

function renderList(container, items, completed = false) {
  container.innerHTML = '';
  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = completed ? '这个月还没有完成事项。' : '这个月暂时没有未完成事项。';
    container.appendChild(empty);
    return;
  }

  for (const item of items) {
    const card = document.createElement('article');
    card.className = `todo-item ${completed ? 'completed' : ''}`;

    const check = document.createElement('button');
    check.className = `check ${completed ? 'done' : ''}`;
    check.type = 'button';
    check.title = completed ? '取消完成' : '标记完成';
    check.setAttribute('aria-label', completed ? `取消完成：${item.title}` : `标记完成：${item.title}`);
    check.addEventListener('click', async () => {
      await request(`/api/todos/${item.id}/${completed ? 'uncomplete' : 'complete'}`, { method: 'POST' });
      toast(completed ? '已恢复到未完成' : '已完成');
      await loadTodos();
    });

    const body = document.createElement('div');
    const title = document.createElement('p');
    title.className = 'todo-title';
    title.textContent = item.title;

    const meta = document.createElement('div');
    meta.className = 'todo-meta';
    meta.innerHTML = `<span class="badge ${item.priority}">${priorityLabel(item.priority)}</span><span>截止 ${formatDue(item.due_at)}</span>${item.completed_at ? `<span>完成 ${formatDue(item.completed_at)}</span>` : ''}`;

    body.append(title, meta);
    const noteEl = renderTodoNote(item.note || '');
    if (noteEl) body.append(noteEl);

    const actions = document.createElement('div');
    actions.className = 'actions';
    const edit = document.createElement('button');
    edit.className = 'icon-btn';
    edit.type = 'button';
    edit.textContent = '编辑';
    edit.title = '编辑待办';
    edit.setAttribute('aria-label', `编辑待办：${item.title}`);
    edit.addEventListener('click', () => openEditModal(item));
    const del = document.createElement('button');
    del.className = 'icon-btn danger';
    del.type = 'button';
    del.textContent = '删除';
    del.title = '删除待办';
    del.setAttribute('aria-label', `删除待办：${item.title}`);
    del.addEventListener('click', async () => {
      if (!confirm(`删除「${item.title}」？`)) return;
      await request(`/api/todos/${item.id}`, { method: 'DELETE' });
      toast('已删除');
      await loadTodos();
    });
    actions.append(edit, del);

    card.append(check, body, actions);
    container.appendChild(card);
  }
}

function editNote(note) {
  noteState.currentId = note.id;
  noteTitleInput.value = note.title || '';
  noteMarkdownInput.value = note.body || '';
  saveNoteButton.textContent = '保存修改';
  cancelNoteEdit.classList.remove('hidden');
  updateNotePreview();
  noteTitleInput.focus();
}

function renderNotes() {
  notesList.innerHTML = '';
  if (!state.notes.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = '还没有笔记。';
    notesList.appendChild(empty);
    return;
  }

  for (const note of state.notes) {
    const item = document.createElement('article');
    item.className = 'note-item';

    const head = document.createElement('div');
    head.className = 'note-item-head';
    const title = document.createElement('h3');
    title.textContent = note.title;
    const time = document.createElement('span');
    time.textContent = `更新 ${formatDue(note.updated_at)}`;
    head.append(title, time);

    const preview = document.createElement('div');
    preview.className = 'markdown-preview note-body-preview';
    preview.innerHTML = renderMarkdown(note.body || '');

    const actions = document.createElement('div');
    actions.className = 'actions note-item-actions';
    const edit = document.createElement('button');
    edit.className = 'icon-btn';
    edit.type = 'button';
    edit.textContent = '编辑';
    edit.addEventListener('click', () => editNote(note));
    const del = document.createElement('button');
    del.className = 'icon-btn danger';
    del.type = 'button';
    del.textContent = '删除';
    del.addEventListener('click', async () => {
      if (!confirm(`删除笔记「${note.title}」？`)) return;
      await request(`/api/notes/${note.id}`, { method: 'DELETE' });
      if (noteState.currentId === note.id) resetNoteForm();
      toast('笔记已删除');
      await loadNotes();
    });
    actions.append(edit, del);

    item.append(head, preview, actions);
    notesList.appendChild(item);
  }
}

async function loadTodos() {
  state.month = monthPicker.value || currentMonth();
  state.data = await request(`/api/todos?month=${encodeURIComponent(state.month)}`);
  pendingMeta.textContent = `${state.data.pending.length} 件待办，按优先级和截止时间排序。`;
  completedMeta.textContent = `${state.data.completed.length} 件已完成，最近完成的在前面。`;
  renderList(pendingList, state.data.pending, false);
  renderList(completedList, state.data.completed, true);
}

async function loadNotes() {
  const data = await request('/api/notes');
  state.notes = data.notes || [];
  notesMeta.textContent = `${state.notes.length} 条笔记，最近更新的在前面。`;
  renderNotes();
}

function shiftMonth(delta) {
  const [y, m] = monthPicker.value.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  monthPicker.value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  loadTodos().catch(err => toast(err.message));
}

$('todoForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = {
    title: $('titleInput').value,
    priority: $('priorityInput').value,
    due_at: $('dueInput').value,
    note: $('noteInput').value
  };
  await request('/api/todos', { method: 'POST', body: JSON.stringify(payload) });
  $('titleInput').value = '';
  $('noteInput').value = '';
  toast('已添加待办');
  const dueMonth = payload.due_at.slice(0, 7);
  if (dueMonth !== monthPicker.value) monthPicker.value = dueMonth;
  await loadTodos();
});

noteMarkdownInput.addEventListener('input', updateNotePreview);
noteForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = {
    title: noteTitleInput.value,
    body: noteMarkdownInput.value
  };
  const editing = Boolean(noteState.currentId);
  const path = editing ? `/api/notes/${noteState.currentId}` : '/api/notes';
  await request(path, { method: editing ? 'PATCH' : 'POST', body: JSON.stringify(payload) });
  toast(editing ? '笔记已更新' : '笔记已保存');
  resetNoteForm();
  await loadNotes();
});
cancelNoteEdit.addEventListener('click', resetNoteForm);

monthPicker.addEventListener('change', () => loadTodos().catch(err => toast(err.message)));
$('prevMonth').addEventListener('click', () => shiftMonth(-1));
$('nextMonth').addEventListener('click', () => shiftMonth(1));
closeEditModal.addEventListener('click', closeEditModalFn);
cancelEdit.addEventListener('click', closeEditModalFn);
editModal.addEventListener('click', (e) => { if (e.target === editModal) closeEditModalFn(); });
editForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!editState.currentId) return;
  const payload = {
    title: editTitleInput.value,
    priority: editPriorityInput.value,
    due_at: editDueInput.value,
    note: editNoteInput.value
  };
  await request(`/api/todos/${editState.currentId}`, { method: 'PATCH', body: JSON.stringify(payload) });
  toast('已保存修改');
  closeEditModalFn();
  await loadTodos();
});

function initDueInput() {
  const d = new Date();
  d.setHours(d.getHours() + 2, 0, 0, 0);
  $('dueInput').value = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}T${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

monthPicker.value = currentMonth();
renderDailyQuote();
initDueInput();
updateNotePreview();
Promise.all([loadTodos(), loadNotes()]).catch(err => toast(err.message));
