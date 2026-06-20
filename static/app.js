import { renderMarkdown } from '/markdown.js';

const $ = (id) => document.getElementById(id);
const page = document.body.dataset.page;
const toastEl = $('toast');

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
  if (!toastEl) return;
  toastEl.textContent = message;
  toastEl.classList.add('show');
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2200);
}

function priorityLabel(priority) {
  return { urgent: '紧急', high: '高', medium: '中', low: '低' }[priority] || priority;
}

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
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

function initTodosPage() {
  const state = { month: '', data: { pending: [], completed: [] } };
  const monthPicker = $('monthPicker');
  const pendingList = $('pendingList');
  const completedList = $('completedList');
  const pendingMeta = $('pendingMeta');
  const completedMeta = $('completedMeta');
  const editModal = $('editModal');
  const closeEditModal = $('closeEditModal');
  const cancelEdit = $('cancelEdit');
  const editForm = $('editForm');
  const editTitleInput = $('editTitleInput');
  const editPriorityInput = $('editPriorityInput');
  const editDueInput = $('editDueInput');
  const editNoteInput = $('editNoteInput');
  const editState = { currentId: null };

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
      empty.textContent = completed ? '暂无已完成。' : '暂无待办。';
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
        toast(completed ? '已恢复' : '已完成');
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

  async function loadTodos() {
    state.month = monthPicker.value || currentMonth();
    state.data = await request(`/api/todos?month=${encodeURIComponent(state.month)}`);
    pendingMeta.textContent = `${state.data.pending.length} 件`;
    completedMeta.textContent = `${state.data.completed.length} 件`;
    renderList(pendingList, state.data.pending, false);
    renderList(completedList, state.data.completed, true);
  }

  function shiftMonth(delta) {
    const [y, m] = monthPicker.value.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    monthPicker.value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    loadTodos().catch(err => toast(err.message));
  }

  function initDueInput() {
    const d = new Date();
    d.setHours(d.getHours() + 2, 0, 0, 0);
    $('dueInput').value = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}T${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
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
    toast('已添加');
    const dueMonth = payload.due_at.slice(0, 7);
    if (dueMonth !== monthPicker.value) monthPicker.value = dueMonth;
    await loadTodos();
  });

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
    toast('已保存');
    closeEditModalFn();
    await loadTodos();
  });

  monthPicker.value = currentMonth();
  initDueInput();
  loadTodos().catch(err => toast(err.message));
}

function initNotesPage() {
  const state = { notes: [] };
  const notesList = $('notesList');
  const notesMeta = $('notesMeta');
  const noteForm = $('noteForm');
  const noteTitleInput = $('noteTitleInput');
  const noteMarkdownInput = $('noteMarkdownInput');
  const notePreview = $('notePreview');
  const saveNoteButton = $('saveNoteButton');
  const cancelNoteEdit = $('cancelNoteEdit');
  const noteState = { currentId: null };

  function updateNotePreview() {
    const html = renderMarkdown(noteMarkdownInput.value);
    notePreview.classList.toggle('empty-preview', !html);
    notePreview.innerHTML = html || '开始输入后显示预览。';
  }

  function resetNoteForm() {
    noteState.currentId = null;
    noteForm.reset();
    saveNoteButton.textContent = '保存';
    cancelNoteEdit.classList.add('hidden');
    updateNotePreview();
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
      empty.textContent = '暂无笔记。';
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
      time.textContent = formatDue(note.updated_at);
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
        toast('已删除');
        await loadNotes();
      });
      actions.append(edit, del);

      item.append(head, preview, actions);
      notesList.appendChild(item);
    }
  }

  async function loadNotes() {
    const data = await request('/api/notes');
    state.notes = data.notes || [];
    notesMeta.textContent = `${state.notes.length} 条`;
    renderNotes();
  }

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
    toast(editing ? '已更新' : '已保存');
    resetNoteForm();
    await loadNotes();
  });
  cancelNoteEdit.addEventListener('click', resetNoteForm);

  updateNotePreview();
  loadNotes().catch(err => toast(err.message));
}

if (page === 'todos') initTodosPage();
if (page === 'notes') initNotesPage();
