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
  const state = { month: '', data: { pending: [], completed: [] }, busy: false, nextTempId: 1 };
  const TODO_TRANSITION_MS = 220;
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
    if (state.busy) return;
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

  function syncTodoBusyControls() {
    document.body.classList.toggle('todo-locked', state.busy);
    document.body.setAttribute('aria-busy', String(state.busy));
    for (const el of document.querySelectorAll('body[data-page="todos"] button, body[data-page="todos"] input, body[data-page="todos"] select, body[data-page="todos"] textarea')) {
      el.disabled = state.busy;
    }
  }

  function setTodoOperationBusy(busy) {
    state.busy = busy;
    syncTodoBusyControls();
  }

  function sortPending(items) {
    const weights = { urgent: 4, high: 3, medium: 2, low: 1 };
    return items.sort((a, b) =>
      (weights[b.priority] || 0) - (weights[a.priority] || 0) ||
      String(a.due_at || '').localeCompare(String(b.due_at || '')) ||
      String(a.created_at || '').localeCompare(String(b.created_at || ''))
    );
  }

  function cloneTodoData() {
    return {
      pending: [...state.data.pending],
      completed: [...state.data.completed]
    };
  }

  function renderTodos() {
    pendingMeta.textContent = `${state.data.pending.length} 件`;
    completedMeta.textContent = `${state.data.completed.length} 件`;
    renderList(pendingList, state.data.pending, false);
    renderList(completedList, state.data.completed, true);
    syncTodoBusyControls();
  }

  function removeTodoFromState(todoId) {
    const keep = (todo) => String(todo.id) !== String(todoId);
    state.data.pending = state.data.pending.filter(keep);
    state.data.completed = state.data.completed.filter(keep);
  }

  function addOptimisticTodo(payload) {
    const dueMonth = payload.due_at.slice(0, 7);
    const monthChanged = dueMonth && dueMonth !== monthPicker.value;
    if (monthChanged) {
      monthPicker.value = dueMonth;
      state.month = dueMonth;
      state.data = { pending: [], completed: [] };
    }

    const now = new Date().toISOString().slice(0, 19);
    const todo = {
      id: `temp-${Date.now()}-${state.nextTempId++}`,
      title: payload.title.trim(),
      priority: payload.priority || 'medium',
      due_at: payload.due_at,
      note: payload.note.trim(),
      status: 'pending',
      created_at: now,
      updated_at: now,
      completed_at: null,
      __entering: true,
      __optimistic: true,
      __monthChanged: monthChanged
    };
    state.data.pending = sortPending([...state.data.pending, todo]);
    renderTodos();
    return todo;
  }

  function replaceOptimisticTodo(tempId, todo) {
    state.data.pending = sortPending(state.data.pending.map((item) => String(item.id) === String(tempId) ? todo : item));
    renderTodos();
  }

  function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async function removeTodoWithTransition(todoId) {
    const card = document.querySelector(`[data-todo-id="${String(todoId)}"]`);
    if (card) {
      card.classList.add('leaving');
      await wait(TODO_TRANSITION_MS);
    }
    removeTodoFromState(todoId);
    renderTodos();
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
      card.className = [
        'todo-item',
        completed ? 'completed' : '',
        item.__entering ? 'entering' : '',
        item.__optimistic ? 'pending-sync' : ''
      ].filter(Boolean).join(' ');
      card.dataset.todoId = String(item.id);

      const check = document.createElement('button');
      check.className = `check ${completed ? 'done' : ''}`;
      check.type = 'button';
      check.title = completed ? '取消完成' : '标记完成';
      check.setAttribute('aria-label', completed ? `取消完成：${item.title}` : `标记完成：${item.title}`);
      check.addEventListener('click', async () => {
        if (state.busy || item.__optimistic) return;
        try {
          await request(`/api/todos/${item.id}/${completed ? 'uncomplete' : 'complete'}`, { method: 'POST' });
          toast(completed ? '已恢复' : '已完成');
          await loadTodos();
        } catch (err) {
          toast(err.message);
        }
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
      edit.addEventListener('click', () => {
        if (state.busy || item.__optimistic) return;
        openEditModal(item);
      });

      const del = document.createElement('button');
      del.className = 'icon-btn danger';
      del.type = 'button';
      del.textContent = '删除';
      del.title = '删除待办';
      del.setAttribute('aria-label', `删除待办：${item.title}`);
      del.addEventListener('click', async () => {
        if (state.busy || item.__optimistic) return;
        if (!confirm(`删除「${item.title}」？`)) return;
        const previousData = cloneTodoData();
        setTodoOperationBusy(true);
        try {
          await removeTodoWithTransition(item.id);
          await request(`/api/todos/${item.id}`, { method: 'DELETE' });
          toast('已删除');
        } catch (err) {
          state.data = previousData;
          renderTodos();
          toast(err.message);
        } finally {
          setTodoOperationBusy(false);
        }
      });
      actions.append(edit, del);

      card.append(check, body, actions);
      container.appendChild(card);
      if (item.__entering) {
        requestAnimationFrame(() => card.classList.remove('entering'));
        item.__entering = false;
      }
    }
  }

  async function loadTodos() {
    state.month = monthPicker.value || currentMonth();
    state.data = await request(`/api/todos?month=${encodeURIComponent(state.month)}`);
    renderTodos();
  }

  function shiftMonth(delta) {
    if (state.busy) return;
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
    if (state.busy) return;
    const payload = {
      title: $('titleInput').value,
      priority: $('priorityInput').value,
      due_at: $('dueInput').value,
      note: $('noteInput').value
    };
    const previousMonth = monthPicker.value;
    const previousData = cloneTodoData();
    setTodoOperationBusy(true);
    const optimisticTodo = addOptimisticTodo(payload);
    $('titleInput').value = '';
    $('noteInput').value = '';
    try {
      const created = await request('/api/todos', { method: 'POST', body: JSON.stringify(payload) });
      replaceOptimisticTodo(optimisticTodo.id, created);
      toast('已添加');
      if (optimisticTodo.__monthChanged) await loadTodos();
    } catch (err) {
      monthPicker.value = previousMonth;
      state.month = previousMonth;
      state.data = previousData;
      $('titleInput').value = payload.title;
      $('noteInput').value = payload.note;
      renderTodos();
      toast(err.message);
    } finally {
      setTodoOperationBusy(false);
    }
  });

  monthPicker.addEventListener('change', () => {
    if (state.busy) return;
    loadTodos().catch(err => toast(err.message));
  });
  $('prevMonth').addEventListener('click', () => shiftMonth(-1));
  $('nextMonth').addEventListener('click', () => shiftMonth(1));
  closeEditModal.addEventListener('click', closeEditModalFn);
  cancelEdit.addEventListener('click', closeEditModalFn);
  editModal.addEventListener('click', (e) => { if (e.target === editModal) closeEditModalFn(); });
  editForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (state.busy || !editState.currentId) return;
    const payload = {
      title: editTitleInput.value,
      priority: editPriorityInput.value,
      due_at: editDueInput.value,
      note: editNoteInput.value
    };
    try {
      await request(`/api/todos/${editState.currentId}`, { method: 'PATCH', body: JSON.stringify(payload) });
      toast('已保存');
      closeEditModalFn();
      await loadTodos();
    } catch (err) {
      toast(err.message);
    }
  });

  monthPicker.value = currentMonth();
  initDueInput();
  loadTodos().catch(err => toast(err.message));
}

function initNotesPage() {
  const state = { notes: [], path: [], parentId: null, contextItem: null };
  const folderView = $('folderView');
  const editorView = $('editorView');
  const notesList = $('notesList');
  const notesMeta = $('notesMeta');
  const breadcrumb = $('breadcrumb');
  const newItemButton = $('newItemButton');
  const newItemMenu = $('newItemMenu');
  const contextMenu = $('contextMenu');
  const deleteContextItem = $('deleteContextItem');
  const backToFolder = $('backToFolder');
  const noteForm = $('noteForm');
  const noteTitleInput = $('noteTitleInput');
  const noteMarkdownInput = $('noteMarkdownInput');
  const notePreview = $('notePreview');
  const saveNoteButton = $('saveNoteButton');
  const noteState = { currentId: null };

  function updateNotePreview() {
    const html = renderMarkdown(noteMarkdownInput.value);
    notePreview.classList.toggle('empty-preview', !html);
    notePreview.innerHTML = html || '开始输入后显示预览。';
  }

  function folderQuery() {
    return state.parentId ? `?parent_id=${state.parentId}` : '';
  }

  function closeMenus() {
    newItemMenu.classList.add('hidden');
    newItemButton.setAttribute('aria-expanded', 'false');
    contextMenu.classList.add('hidden');
    state.contextItem = null;
  }

  function openEditor(note) {
    noteState.currentId = note.id;
    noteTitleInput.value = note.title || '';
    noteMarkdownInput.value = note.body || '';
    saveNoteButton.textContent = '保存';
    folderView.classList.add('hidden');
    editorView.classList.remove('hidden');
    updateNotePreview();
    noteTitleInput.focus();
  }

  function closeEditor() {
    noteState.currentId = null;
    noteForm.reset();
    editorView.classList.add('hidden');
    folderView.classList.remove('hidden');
    updateNotePreview();
  }

  async function enterFolder(folder) {
    state.parentId = folder ? folder.id : null;
    closeEditor();
    await loadNotes();
  }

  function renderBreadcrumb() {
    breadcrumb.innerHTML = '';
    const root = document.createElement('button');
    root.type = 'button';
    root.textContent = '根目录';
    root.addEventListener('click', () => enterFolder(null).catch(err => toast(err.message)));
    breadcrumb.appendChild(root);
    for (const item of state.path) {
      const crumb = document.createElement('button');
      crumb.type = 'button';
      crumb.textContent = item.title;
      crumb.addEventListener('click', () => enterFolder(item).catch(err => toast(err.message)));
      breadcrumb.appendChild(crumb);
    }
  }

  function openContextMenu(event, item) {
    event.preventDefault();
    event.stopPropagation();
    state.contextItem = item;
    const menuWidth = 136;
    const menuHeight = 48;
    contextMenu.style.left = `${Math.min(event.clientX, window.innerWidth - menuWidth - 8)}px`;
    contextMenu.style.top = `${Math.min(event.clientY, window.innerHeight - menuHeight - 8)}px`;
    contextMenu.classList.remove('hidden');
  }

  function renderNotes() {
    notesList.innerHTML = '';
    renderBreadcrumb();
    if (!state.notes.length) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = '空文件夹。';
      notesList.appendChild(empty);
      return;
    }

    for (const note of state.notes) {
      const openItem = (event) => {
        event.stopPropagation();
        if (note.type === 'folder') enterFolder(note).catch(err => toast(err.message));
        else openEditor(note);
      };
      const item = document.createElement('article');
      item.className = `note-file-card ${note.type === 'folder' ? 'folder-card' : 'file-card'}`;
      item.addEventListener('contextmenu', (event) => openContextMenu(event, note));
      item.addEventListener('click', openItem);

      const fileIcon = document.createElement('button');
      fileIcon.className = note.type === 'folder' ? 'folder-icon' : 'file-icon';
      fileIcon.type = 'button';
      fileIcon.setAttribute('aria-label', note.type === 'folder' ? `进入文件夹：${note.title}` : `打开笔记：${note.title}`);
      const fileLines = document.createElement('span');
      fileLines.className = 'file-lines';
      fileLines.innerHTML = '<i></i><i></i><i></i>';
      if (note.type !== 'folder') {
        const iconPreview = document.createElement('span');
        iconPreview.className = 'file-icon-preview compact-markdown';
        iconPreview.innerHTML = renderMarkdown(note.body || '');
        fileIcon.append(iconPreview, fileLines);
      }

      const head = document.createElement('button');
      head.className = 'note-item-head';
      head.type = 'button';
      const title = document.createElement('h3');
      title.textContent = note.title;
      const time = document.createElement('span');
      time.textContent = formatDue(note.updated_at);
      head.append(title, time);

      item.append(fileIcon, head);
      notesList.appendChild(item);
    }
  }

  async function loadNotes() {
    const data = await request(`/api/notes${folderQuery()}`);
    state.notes = data.notes || [];
    state.path = data.path || [];
    notesMeta.textContent = `${state.notes.length} 条`;
    renderNotes();
  }

  async function createItem(type) {
    const title = prompt(type === 'folder' ? '文件夹名称' : '文件名称');
    if (!title) return;
    const payload = { title, type, parent_id: state.parentId };
    if (type === 'file') payload.body = '';
    const item = await request('/api/notes', { method: 'POST', body: JSON.stringify(payload) });
    toast(type === 'folder' ? '已新建文件夹' : '已新建文件');
    await loadNotes();
    if (type === 'file') openEditor(item);
  }

  async function deleteContextTarget() {
    if (!state.contextItem) return;
    const target = state.contextItem;
    const label = state.contextItem.type === 'folder' ? '文件夹' : '文件';
    if (!confirm(`删除${label}「${state.contextItem.title}」？`)) return;
    await request(`/api/notes/${target.id}`, { method: 'DELETE' });
    state.contextItem = null;
    closeMenus();
    toast('已删除');
    await loadNotes();
  }

  noteMarkdownInput.addEventListener('input', updateNotePreview);
  noteForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      title: noteTitleInput.value,
      body: noteMarkdownInput.value
    };
    if (!noteState.currentId) return;
    await request(`/api/notes/${noteState.currentId}`, { method: 'PATCH', body: JSON.stringify(payload) });
    toast('已保存');
    await loadNotes();
  });
  backToFolder.addEventListener('click', closeEditor);
  newItemButton.addEventListener('click', () => {
    const open = newItemMenu.classList.toggle('hidden');
    newItemButton.setAttribute('aria-expanded', String(!open));
  });
  newItemMenu.addEventListener('click', (event) => {
    const type = event.target?.dataset?.createType;
    if (!type) return;
    closeMenus();
    createItem(type).catch(err => toast(err.message));
  });
  deleteContextItem.addEventListener('click', (event) => {
    event.stopPropagation();
    deleteContextTarget().catch(err => toast(err.message));
  });
  contextMenu.addEventListener('click', (event) => event.stopPropagation());
  document.addEventListener('click', (event) => {
    if (!newItemMenu.contains(event.target) && event.target !== newItemButton && !contextMenu.contains(event.target)) closeMenus();
  });

  updateNotePreview();
  loadNotes().catch(err => toast(err.message));
}

if (page === 'todos') initTodosPage();
if (page === 'notes') initNotesPage();
