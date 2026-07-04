import { escapeHtml, renderMarkdown } from '/markdown.js';

const $ = (id) => document.getElementById(id);
const page = document.body.dataset.page;
const toastEl = $('toast');

function apiHeaders(extra = {}) {
  return { 'Content-Type': 'application/json', ...extra };
}

async function request(path, options = {}) {
  const res = await fetch(path, { ...options, headers: apiHeaders(options.headers || {}) });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && page !== 'login') {
    const next = encodeURIComponent(`${window.location.pathname}${window.location.search}`);
    window.location.href = `/login?next=${next}`;
  }
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

function formatDateText(dateString) {
  const [year, month, day] = String(dateString || '').split('-');
  return year && month && day ? `${year}/${month}/${day}` : '';
}

function localDateFromString(dateString) {
  const [year, month, day] = String(dateString || '').split('-').map(Number);
  return new Date(year, month - 1, day);
}

function todayLocalDate() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function todayDateString() {
  const d = todayLocalDate();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

function dateStringFromLocalDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function calendarDayDiff(targetDate) {
  return Math.round((targetDate - todayLocalDate()) / 86400000);
}

function onceCountdownStatus(item) {
  const diff = calendarDayDiff(localDateFromString(item.target_date));
  if (diff > 0) return { label: `还有 ${diff} 天`, caption: '还有', value: String(diff), suffix: '天', kind: 'future' };
  if (diff < 0) return { label: `已过去 ${Math.abs(diff)} 天`, caption: '已过去', value: String(Math.abs(diff)), suffix: '天', kind: 'past' };
  return { label: '今天', caption: '', value: '今天', suffix: '', kind: 'today' };
}

function monthlyNextDate(repeatDay) {
  const today = todayLocalDate();
  let year = today.getFullYear();
  let month = today.getMonth() + 1;
  let day = Math.min(repeatDay, daysInMonth(year, month));
  let next = new Date(year, month - 1, day);
  if (next < today) {
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
    day = Math.min(repeatDay, daysInMonth(year, month));
    next = new Date(year, month - 1, day);
  }
  return next;
}

function monthlyCountdownStatus(item) {
  const repeatDay = Number(item.repeat_day || localDateFromString(item.target_date).getDate());
  const next = monthlyNextDate(repeatDay);
  const diff = calendarDayDiff(next);
  const label = diff === 0 ? '今天' : `还有 ${diff} 天`;
  return {
    label,
    caption: diff === 0 ? '' : '还有',
    value: diff === 0 ? '今天' : String(diff),
    suffix: diff === 0 ? '' : '天',
    extra: `每月 ${repeatDay} 日`,
    kind: diff === 0 ? 'today' : 'future'
  };
}

function anniversaryCountdownStatus(item) {
  const start = localDateFromString(item.target_date);
  const today = todayLocalDate();
  let year = today.getFullYear();
  const month = Number(item.repeat_month || start.getMonth() + 1);
  const originalDay = Number(item.repeat_day || start.getDate());
  let day = Math.min(originalDay, daysInMonth(year, month));
  let next = new Date(year, month - 1, day);
  if (next < today) {
    year += 1;
    day = Math.min(originalDay, daysInMonth(year, month));
    next = new Date(year, month - 1, day);
  }
  const totalDays = Math.abs(calendarDayDiff(start));
  const anniversaryYears = Math.max(1, year - start.getFullYear());
  const anniversaryDiff = calendarDayDiff(next);
  const extra = anniversaryDiff === 0
    ? `今天是 ${anniversaryYears} 周年`
    : `离 ${anniversaryYears} 周年还有 ${anniversaryDiff} 天`;
  return {
    label: totalDays === 0 ? '今天' : `已过去 ${totalDays} 天`,
    caption: totalDays === 0 ? '' : '已过去',
    value: totalDays === 0 ? '今天' : String(totalDays),
    suffix: totalDays === 0 ? '' : '天',
    extra,
    kind: totalDays === 0 ? 'today' : 'past'
  };
}

function countdownStatus(item) {
  if (item.event_type === 'monthly') return monthlyCountdownStatus(item);
  if (item.event_type === 'anniversary') return anniversaryCountdownStatus(item);
  return onceCountdownStatus(item);
}

const MARKDOWN_CACHE_LIMIT = 120;
const todoMarkdownCache = new Map();

function renderMarkdownCached(markdown = '') {
  const key = String(markdown || '');
  if (!key) return '';
  if (todoMarkdownCache.has(key)) {
    const cached = todoMarkdownCache.get(key);
    todoMarkdownCache.delete(key);
    todoMarkdownCache.set(key, cached);
    return cached;
  }
  const html = renderMarkdown(key);
  todoMarkdownCache.set(key, html);
  if (todoMarkdownCache.size > MARKDOWN_CACHE_LIMIT) {
    todoMarkdownCache.delete(todoMarkdownCache.keys().next().value);
  }
  return html;
}

function renderTodoNote(note) {
  if (!note) return null;
  const noteEl = document.createElement('div');
  noteEl.className = 'todo-note markdown-preview compact-markdown';
  noteEl.innerHTML = renderMarkdownCached(note);
  return noteEl;
}

function safeNextPath(value) {
  return value && value.startsWith('/') && !value.startsWith('//') ? value : '/';
}

function initLogoutButton() {
  const logoutButton = $('logoutButton');
  if (!logoutButton) return;
  logoutButton.addEventListener('click', async () => {
    logoutButton.disabled = true;
    try {
      await request('/api/auth/logout', { method: 'POST' });
    } catch (err) {
      toast(err.message);
    } finally {
      window.location.href = '/login';
    }
  });
}

function initLoginPage() {
  const loginForm = $('loginForm');
  const emailInput = $('emailInput');
  const passwordInput = $('passwordInput');
  const loginButton = $('loginButton');
  const params = new URLSearchParams(window.location.search);
  const nextPath = safeNextPath(params.get('next'));

  request('/api/auth/status')
    .then((data) => {
      if (data.authenticated) window.location.href = nextPath;
    })
    .catch(() => {});

  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    loginButton.disabled = true;
    try {
      await request('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: emailInput.value, password: passwordInput.value })
      });
      window.location.href = nextPath;
    } catch (err) {
      toast(err.message);
      passwordInput.value = '';
      passwordInput.focus();
    } finally {
      loginButton.disabled = false;
    }
  });
}

function initTodosPage() {
  const state = { month: '', data: { pending: [], completed: [] }, busy: false, nextTempId: 1, loadSeq: 0 };
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

  function invalidateTodoLoads() {
    state.loadSeq += 1;
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

  function findTodoById(todoId) {
    return [...state.data.pending, ...state.data.completed].find((todo) => String(todo.id) === String(todoId));
  }

  function replaceTodoInState(todo) {
    removeTodoFromState(todo.id);
    if (todo.due_at?.slice(0, 7) !== state.month) return;
    if (todo.status === 'completed') {
      state.data.completed = [todo, ...state.data.completed].sort((a, b) =>
        String(b.completed_at || '').localeCompare(String(a.completed_at || '')) ||
        String(a.due_at || '').localeCompare(String(b.due_at || '')) ||
        String(a.created_at || '').localeCompare(String(b.created_at || ''))
      );
    } else {
      state.data.pending = sortPending([...state.data.pending, todo]);
    }
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
    removeTodoFromState(tempId);
    replaceTodoInState(todo);
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
    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = completed ? '暂无已完成。' : '暂无待办。';
      container.replaceChildren(empty);
      return;
    }

    const fragment = document.createDocumentFragment();
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
      check.dataset.todoAction = 'toggle';
      check.setAttribute('aria-label', completed ? `取消完成：${item.title}` : `标记完成：${item.title}`);

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
      edit.dataset.todoAction = 'edit';
      edit.setAttribute('aria-label', `编辑待办：${item.title}`);

      const del = document.createElement('button');
      del.className = 'icon-btn danger';
      del.type = 'button';
      del.textContent = '删除';
      del.title = '删除待办';
      del.dataset.todoAction = 'delete';
      del.setAttribute('aria-label', `删除待办：${item.title}`);
      actions.append(edit, del);

      card.append(check, body, actions);
      fragment.appendChild(card);
      if (item.__entering) {
        requestAnimationFrame(() => card.classList.remove('entering'));
        item.__entering = false;
      }
    }
    container.replaceChildren(fragment);
  }

  async function toggleTodo(item) {
    if (state.busy || item.__optimistic) return;
    invalidateTodoLoads();
    const previousData = cloneTodoData();
    const completed = item.status === 'completed';
    const now = new Date().toISOString().slice(0, 19);
    const moved = {
      ...item,
      status: completed ? 'pending' : 'completed',
      completed_at: completed ? null : now,
      updated_at: now,
      __entering: true
    };
    replaceTodoInState(moved);
    renderTodos();
    try {
      const saved = await request(`/api/todos/${item.id}/${completed ? 'uncomplete' : 'complete'}`, { method: 'POST' });
      replaceTodoInState(saved);
      renderTodos();
      toast(completed ? '已恢复' : '已完成');
    } catch (err) {
      state.data = previousData;
      renderTodos();
      toast(err.message);
    }
  }

  async function deleteTodo(item) {
    if (state.busy || item.__optimistic) return;
    if (!confirm(`删除「${item.title}」？`)) return;
    invalidateTodoLoads();
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
  }

  function handleTodoListClick(event) {
    const button = event.target.closest('button[data-todo-action]');
    if (!button || !event.currentTarget.contains(button)) return;
    const card = button.closest('[data-todo-id]');
    const item = card ? findTodoById(card.dataset.todoId) : null;
    if (!item) return;
    const action = button.dataset.todoAction;
    if (action === 'toggle') toggleTodo(item);
    if (action === 'edit' && !state.busy && !item.__optimistic) openEditModal(item);
    if (action === 'delete') deleteTodo(item);
  }

  async function loadTodos() {
    const seq = ++state.loadSeq;
    const month = monthPicker.value || currentMonth();
    state.month = month;
    const data = await request(`/api/todos?month=${encodeURIComponent(month)}`);
    if (seq !== state.loadSeq) return;
    state.data = data;
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
    invalidateTodoLoads();
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
  pendingList.addEventListener('click', handleTodoListClick);
  completedList.addEventListener('click', handleTodoListClick);
  $('prevMonth').addEventListener('click', () => shiftMonth(-1));
  $('nextMonth').addEventListener('click', () => shiftMonth(1));
  closeEditModal.addEventListener('click', closeEditModalFn);
  cancelEdit.addEventListener('click', closeEditModalFn);
  editModal.addEventListener('click', (e) => { if (e.target === editModal) closeEditModalFn(); });
  editForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (state.busy || !editState.currentId) return;
    const todoId = editState.currentId;
    const current = findTodoById(todoId);
    if (!current) return;
    const payload = {
      title: editTitleInput.value,
      priority: editPriorityInput.value,
      due_at: editDueInput.value,
      note: editNoteInput.value
    };
    const previousData = cloneTodoData();
    invalidateTodoLoads();
    const now = new Date().toISOString().slice(0, 19);
    const optimistic = {
      ...current,
      ...payload,
      title: payload.title.trim(),
      note: payload.note.trim(),
      updated_at: now,
      __optimistic: true
    };
    replaceTodoInState(optimistic);
    renderTodos();
    closeEditModalFn();
    try {
      const saved = await request(`/api/todos/${todoId}`, { method: 'PATCH', body: JSON.stringify(payload) });
      replaceTodoInState(saved);
      renderTodos();
      toast('已保存');
    } catch (err) {
      state.data = previousData;
      renderTodos();
      openEditModal({ ...current, ...payload });
      toast(err.message);
    }
  });

  monthPicker.value = currentMonth();
  initDueInput();
  loadTodos().catch(err => toast(err.message));
}

function initCountdownsPage() {
  const state = { countdowns: [], busy: false, nextTempId: 1 };
  const COUNTDOWN_TRANSITION_MS = 220;
  const countdownForm = $('countdownForm');
  const titleInput = $('countdownTitleInput');
  const typeInput = $('countdownTypeInput');
  const dateInput = $('countdownDateInput');
  const dayInput = $('countdownDayInput');
  const dateField = document.querySelector('.countdown-date-field');
  const dayField = document.querySelector('.countdown-day-field');
  const countdownsMeta = $('countdownsMeta');
  const countdownsList = $('countdownsList');

  function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function syncCountdownBusyControls() {
    document.body.classList.toggle('countdown-locked', state.busy);
    document.body.setAttribute('aria-busy', String(state.busy));
    for (const el of document.querySelectorAll('body[data-page="countdowns"] button, body[data-page="countdowns"] input, body[data-page="countdowns"] select')) {
      el.disabled = state.busy;
    }
  }

  function setCountdownOperationBusy(busy) {
    state.busy = busy;
    syncCountdownBusyControls();
  }

  function sortCountdowns(items) {
    return items.sort((a, b) =>
      String(a.target_date || '').localeCompare(String(b.target_date || '')) ||
      String(a.created_at || '').localeCompare(String(b.created_at || ''))
    );
  }

  function addOptimisticCountdown(payload) {
    const now = new Date().toISOString().slice(0, 19);
    const item = {
      id: `temp-${Date.now()}-${state.nextTempId++}`,
      title: payload.title.trim(),
      target_date: payload.target_date,
      event_type: payload.event_type || 'once',
      repeat_month: payload.repeat_month ?? null,
      repeat_day: payload.repeat_day ?? null,
      created_at: now,
      updated_at: now,
      __entering: true,
      __optimistic: true
    };
    state.countdowns = sortCountdowns([...state.countdowns, item]);
    renderCountdowns();
    return item;
  }

  function replaceOptimisticCountdown(tempId, countdown) {
    state.countdowns = sortCountdowns(state.countdowns.map((item) => String(item.id) === String(tempId) ? countdown : item));
    renderCountdowns();
  }

  function removeCountdownFromState(countdownId) {
    state.countdowns = state.countdowns.filter((item) => String(item.id) !== String(countdownId));
  }

  async function removeCountdownWithTransition(countdownId) {
    const card = document.querySelector(`[data-countdown-id="${String(countdownId)}"]`);
    if (card) {
      card.classList.add('leaving');
      await wait(COUNTDOWN_TRANSITION_MS);
    }
    removeCountdownFromState(countdownId);
    renderCountdowns();
  }

  function renderCountdowns() {
    countdownsMeta.textContent = `${state.countdowns.length} 件`;
    countdownsList.innerHTML = '';
    if (!state.countdowns.length) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = '暂无倒数日。';
      countdownsList.appendChild(empty);
      syncCountdownBusyControls();
      return;
    }

    for (const item of state.countdowns) {
      const status = countdownStatus(item);
      const card = document.createElement('article');
      card.className = [
        'countdown-card',
        status.kind,
        item.__entering ? 'entering' : '',
        item.__optimistic ? 'pending-sync' : ''
      ].filter(Boolean).join(' ');
      card.dataset.countdownId = String(item.id);

      const main = document.createElement('div');
      main.className = 'countdown-main';
      const title = document.createElement('h3');
      title.textContent = item.title;
      const date = document.createElement('p');
      date.className = 'countdown-date';
      date.textContent = formatDateText(item.target_date);
      main.append(title, date);
      if (status.extra) {
        const extra = document.createElement('p');
        extra.className = 'countdown-extra';
        extra.textContent = status.extra;
        main.appendChild(extra);
      }

      const statusBlock = document.createElement('div');
      statusBlock.className = 'countdown-status';
      statusBlock.setAttribute('aria-label', status.label);
      if (status.caption) {
        const caption = document.createElement('p');
        caption.className = 'countdown-label';
        caption.textContent = status.caption;
        statusBlock.appendChild(caption);
      }
      const value = document.createElement('p');
      value.className = 'countdown-value';
      value.textContent = status.value;
      const label = document.createElement('p');
      label.className = 'countdown-label';
      label.textContent = status.suffix || status.label;
      statusBlock.append(value, label);

      const actions = document.createElement('div');
      actions.className = 'actions';
      const del = document.createElement('button');
      del.className = 'icon-btn danger';
      del.type = 'button';
      del.textContent = '删除';
      del.title = '删除倒数日';
      del.setAttribute('aria-label', `删除倒数日：${item.title}`);
      del.addEventListener('click', async () => {
        if (state.busy || item.__optimistic) return;
        if (!confirm(`删除「${item.title}」？`)) return;
        const previous = [...state.countdowns];
        setCountdownOperationBusy(true);
        try {
          await removeCountdownWithTransition(item.id);
          await request(`/api/countdowns/${item.id}`, { method: 'DELETE' });
          toast('已删除');
        } catch (err) {
          state.countdowns = previous;
          renderCountdowns();
          toast(err.message);
        } finally {
          setCountdownOperationBusy(false);
        }
      });
      actions.append(del);

      card.append(main, statusBlock, actions);
      countdownsList.appendChild(card);
      if (item.__entering) {
        requestAnimationFrame(() => card.classList.remove('entering'));
        item.__entering = false;
      }
    }
    syncCountdownBusyControls();
  }

  async function loadCountdowns() {
    const data = await request('/api/countdowns');
    state.countdowns = data.countdowns || [];
    renderCountdowns();
  }

  function syncCountdownTypeFields() {
    const type = typeInput.value;
    const monthly = type === 'monthly';
    dateField.classList.toggle('countdown-field-hidden', monthly);
    dayField.classList.toggle('countdown-field-hidden', !monthly);
    dateInput.required = !monthly;
    dayInput.required = monthly;
  }

  function countdownPayload() {
    const event_type = typeInput.value || 'once';
    const payload = {
      title: titleInput.value,
      event_type,
      target_date: dateInput.value
    };
    if (event_type === 'monthly') {
      payload.target_date = dateInput.value || todayDateString();
      payload.repeat_day = Number(dayInput.value);
    }
    if (event_type === 'anniversary' && dateInput.value) {
      const [, month, day] = dateInput.value.split('-').map(Number);
      payload.repeat_month = month;
      payload.repeat_day = day;
    }
    return payload;
  }

  countdownForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (state.busy) return;
    const payload = countdownPayload();
    const previous = [...state.countdowns];
    setCountdownOperationBusy(true);
    const optimistic = addOptimisticCountdown(payload);
    titleInput.value = '';
    if (payload.event_type === 'monthly') dayInput.value = '';
    try {
      const created = await request('/api/countdowns', { method: 'POST', body: JSON.stringify(payload) });
      replaceOptimisticCountdown(optimistic.id, created);
      toast('已添加');
    } catch (err) {
      state.countdowns = previous;
      titleInput.value = payload.title;
      if (payload.event_type === 'monthly') dayInput.value = payload.repeat_day || '';
      renderCountdowns();
      toast(err.message);
    } finally {
      setCountdownOperationBusy(false);
    }
  });

  typeInput.addEventListener('change', syncCountdownTypeFields);
  dateInput.value = todayDateString();
  syncCountdownTypeFields();
  loadCountdowns().catch(err => toast(err.message));
}

function studyProgress(plan) {
  const items = plan.items || [];
  const total = items.length;
  const completed = items.filter((item) => item.status === 'completed').length;
  return {
    total,
    completed,
    percent: total ? Math.round((completed / total) * 100) : 0
  };
}

function initStudyPage() {
  const state = { plans: [], busy: false, draggedItemId: null, draggedPlanId: null };
  const studyPlanForm = $('studyPlanForm');
  const studyPlanTitleInput = $('studyPlanTitleInput');
  const studyPlansMeta = $('studyPlansMeta');
  const studyPlansList = $('studyPlansList');

  function setStudyBusy(busy) {
    state.busy = busy;
    document.body.classList.toggle('study-locked', state.busy);
    document.body.setAttribute('aria-busy', String(state.busy));
    for (const el of document.querySelectorAll('body[data-page="study"] button, body[data-page="study"] input')) {
      el.disabled = state.busy || el.dataset.orderBoundary === 'true';
    }
  }

  function findPlan(planId) {
    return state.plans.find((plan) => String(plan.id) === String(planId));
  }

  function findItem(itemId) {
    for (const plan of state.plans) {
      const item = (plan.items || []).find((entry) => String(entry.id) === String(itemId));
      if (item) return { plan, item };
    }
    return { plan: null, item: null };
  }

  function updatePlanProgress(plan) {
    const progress = studyProgress(plan);
    plan.total_items = progress.total;
    plan.completed_items = progress.completed;
    plan.progress_percent = progress.percent;
  }

  function replacePlan(savedPlan) {
    state.plans = state.plans.map((plan) => String(plan.id) === String(savedPlan.id) ? savedPlan : plan);
  }

  function renderStudyPlans() {
    studyPlansMeta.textContent = `${state.plans.length} 个计划`;
    if (!state.plans.length) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = '暂无学习计划。';
      studyPlansList.replaceChildren(empty);
      setStudyBusy(state.busy);
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const plan of state.plans) {
      const progress = studyProgress(plan);
      const card = document.createElement('article');
      card.className = 'study-plan-card';
      card.dataset.planId = String(plan.id);

      const head = document.createElement('div');
      head.className = 'study-plan-head';
      const titleWrap = document.createElement('div');
      const title = document.createElement('h2');
      title.className = 'study-plan-title';
      title.textContent = plan.title;
      const progressWrap = document.createElement('div');
      progressWrap.className = 'study-progress';
      const progressText = document.createElement('p');
      progressText.className = 'study-progress-text';
      progressText.textContent = `${progress.completed}/${progress.total} · ${progress.percent}%`;
      const progressTrack = document.createElement('div');
      progressTrack.className = 'study-progress-track';
      const progressBar = document.createElement('span');
      progressBar.className = 'study-progress-bar';
      progressBar.style.width = `${progress.percent}%`;
      progressTrack.appendChild(progressBar);
      progressWrap.append(progressText, progressTrack);
      titleWrap.append(title, progressWrap);

      const planActions = document.createElement('div');
      planActions.className = 'actions';
      planActions.innerHTML = `
        <button class="icon-btn" type="button" data-study-action="edit-plan">编辑</button>
        <button class="icon-btn danger" type="button" data-study-action="delete-plan">删除</button>
      `;
      head.append(titleWrap, planActions);

      const itemForm = document.createElement('form');
      itemForm.className = 'study-item-form';
      itemForm.dataset.studyAction = 'add-item';
      itemForm.innerHTML = `
        <label class="field">
          <span>章节</span>
          <input name="title" type="text" maxlength="120" placeholder="函数、极限与连续" required />
        </label>
        <button class="ghost-action" type="submit">添加</button>
      `;

      const items = document.createElement('div');
      items.className = 'study-items';
      if (!plan.items?.length) {
        const empty = document.createElement('div');
        empty.className = 'empty';
        empty.textContent = '暂无章节。';
        items.appendChild(empty);
      } else {
        plan.items.forEach((item, index) => {
          const safeTitle = escapeHtml(item.title);
          const row = document.createElement('div');
          row.className = `study-item-row ${item.status === 'completed' ? 'completed' : ''}`;
          row.draggable = true;
          row.dataset.itemId = String(item.id);
          row.innerHTML = `
            <button class="drag-handle" type="button" title="拖拽排序" aria-label="拖拽排序">⋮⋮</button>
            <button class="check ${item.status === 'completed' ? 'done' : ''}" type="button" data-study-action="toggle-item" aria-label="切换完成：${safeTitle}"></button>
            <p class="study-item-title">${safeTitle}</p>
            <div class="study-item-actions">
              <button class="icon-btn" type="button" data-study-action="move-up" ${index === 0 ? 'disabled data-order-boundary="true"' : ''}>上移</button>
              <button class="icon-btn" type="button" data-study-action="move-down" ${index === plan.items.length - 1 ? 'disabled data-order-boundary="true"' : ''}>下移</button>
              <button class="icon-btn" type="button" data-study-action="edit-item">编辑</button>
              <button class="icon-btn danger" type="button" data-study-action="delete-item">删除</button>
            </div>
          `;
          items.appendChild(row);
        });
      }

      card.append(head, itemForm, items);
      fragment.appendChild(card);
    }
    studyPlansList.replaceChildren(fragment);
    setStudyBusy(state.busy);
  }

  async function loadStudyPlans() {
    const data = await request('/api/study-plans');
    state.plans = data.plans || [];
    renderStudyPlans();
  }

  async function reorderStudyItems(plan, itemIds) {
    if (state.busy || !plan) return;
    const previous = [...(plan.items || [])];
    const nextItems = itemIds.map((id) => previous.find((item) => String(item.id) === String(id)));
    if (nextItems.some((item) => !item)) return;
    setStudyBusy(true);
    plan.items = nextItems;
    updatePlanProgress(plan);
    renderStudyPlans();
    try {
      const saved = await request(`/api/study-plans/${plan.id}/items/reorder`, {
        method: 'POST',
        body: JSON.stringify({ item_ids: itemIds.map(Number) })
      });
      replacePlan(saved);
      renderStudyPlans();
    } catch (err) {
      plan.items = previous;
      updatePlanProgress(plan);
      renderStudyPlans();
      toast(err.message);
    } finally {
      setStudyBusy(false);
    }
  }

  studyPlanForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (state.busy) return;
    const title = studyPlanTitleInput.value;
    setStudyBusy(true);
    try {
      const plan = await request('/api/study-plans', { method: 'POST', body: JSON.stringify({ title }) });
      state.plans = [plan, ...state.plans];
      studyPlanTitleInput.value = '';
      renderStudyPlans();
      toast('已添加');
    } catch (err) {
      toast(err.message);
    } finally {
      setStudyBusy(false);
    }
  });

  studyPlansList.addEventListener('submit', async (event) => {
    const form = event.target.closest('form[data-study-action="add-item"]');
    if (!form || state.busy) return;
    event.preventDefault();
    const card = form.closest('[data-plan-id]');
    const plan = findPlan(card?.dataset.planId);
    const input = form.elements.title;
    if (!plan) return;
    setStudyBusy(true);
    try {
      const item = await request(`/api/study-plans/${plan.id}/items`, { method: 'POST', body: JSON.stringify({ title: input.value }) });
      plan.items = [...(plan.items || []), item];
      updatePlanProgress(plan);
      input.value = '';
      renderStudyPlans();
      toast('已添加章节');
    } catch (err) {
      toast(err.message);
    } finally {
      setStudyBusy(false);
    }
  });

  studyPlansList.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-study-action]');
    if (!button || state.busy) return;
    const card = button.closest('[data-plan-id]');
    const plan = card ? findPlan(card.dataset.planId) : null;
    const row = button.closest('[data-item-id]');
    const action = button.dataset.studyAction;

    try {
      if (action === 'edit-plan' && plan) {
        const title = prompt('计划名称', plan.title);
        if (title === null) return;
        setStudyBusy(true);
        const saved = await request(`/api/study-plans/${plan.id}`, { method: 'PATCH', body: JSON.stringify({ title }) });
        replacePlan(saved);
        renderStudyPlans();
        toast('已保存');
      }

      if (action === 'delete-plan' && plan) {
        if (!confirm(`删除学习计划「${plan.title}」及其全部章节？`)) return;
        setStudyBusy(true);
        await request(`/api/study-plans/${plan.id}`, { method: 'DELETE' });
        state.plans = state.plans.filter((item) => String(item.id) !== String(plan.id));
        renderStudyPlans();
        toast('已删除');
      }

      if (row && action === 'toggle-item') {
        const { plan: itemPlan, item } = findItem(row.dataset.itemId);
        if (!itemPlan || !item) return;
        const previousItems = itemPlan.items.map((entry) => ({ ...entry }));
        const status = item.status === 'completed' ? 'pending' : 'completed';
        const completed_at = status === 'completed' ? new Date().toISOString().slice(0, 19) : null;
        setStudyBusy(true);
        Object.assign(item, { status, completed_at });
        updatePlanProgress(itemPlan);
        renderStudyPlans();
        try {
          const saved = await request(`/api/study-plan-items/${item.id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
          Object.assign(item, saved);
          updatePlanProgress(itemPlan);
          renderStudyPlans();
        } catch (err) {
          itemPlan.items = previousItems;
          updatePlanProgress(itemPlan);
          renderStudyPlans();
          toast(err.message);
        } finally {
          setStudyBusy(false);
        }
      }

      if (row && action === 'edit-item') {
        const { item } = findItem(row.dataset.itemId);
        if (!plan || !item) return;
        const title = prompt('章节名称', item.title);
        if (title === null) return;
        setStudyBusy(true);
        const saved = await request(`/api/study-plan-items/${item.id}`, { method: 'PATCH', body: JSON.stringify({ title }) });
        Object.assign(item, saved);
        renderStudyPlans();
        toast('已保存');
      }

      if (row && action === 'delete-item') {
        const { item } = findItem(row.dataset.itemId);
        if (!plan || !item) return;
        if (!confirm(`删除章节「${item.title}」？`)) return;
        setStudyBusy(true);
        await request(`/api/study-plan-items/${item.id}`, { method: 'DELETE' });
        plan.items = plan.items.filter((entry) => String(entry.id) !== String(item.id));
        updatePlanProgress(plan);
        renderStudyPlans();
        toast('已删除');
      }

      if (row && (action === 'move-up' || action === 'move-down')) {
        if (!plan) return;
        const index = plan.items.findIndex((item) => String(item.id) === row.dataset.itemId);
        const targetIndex = action === 'move-up' ? index - 1 : index + 1;
        if (index < 0 || targetIndex < 0 || targetIndex >= plan.items.length) return;
        const next = [...plan.items];
        [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
        await reorderStudyItems(plan, next.map((item) => item.id));
      }
    } catch (err) {
      toast(err.message);
    } finally {
      if (action !== 'toggle-item') setStudyBusy(false);
    }
  });

  studyPlansList.addEventListener('dragstart', (event) => {
    const row = event.target.closest('.study-item-row');
    const card = row?.closest('[data-plan-id]');
    if (!row || !card || state.busy) return;
    state.draggedItemId = row.dataset.itemId;
    state.draggedPlanId = card.dataset.planId;
    row.classList.add('dragging');
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  });

  studyPlansList.addEventListener('dragend', (event) => {
    event.target.closest('.study-item-row')?.classList.remove('dragging');
    state.draggedItemId = null;
    state.draggedPlanId = null;
  });

  studyPlansList.addEventListener('dragover', (event) => {
    if (!state.draggedItemId || state.busy) return;
    const row = event.target.closest('.study-item-row');
    const card = row?.closest('[data-plan-id]');
    if (row && card?.dataset.planId === state.draggedPlanId) event.preventDefault();
  });

  studyPlansList.addEventListener('drop', async (event) => {
    const targetRow = event.target.closest('.study-item-row');
    const card = targetRow?.closest('[data-plan-id]');
    if (!targetRow || !card || !state.draggedItemId || state.busy) return;
    if (card.dataset.planId !== state.draggedPlanId || targetRow.dataset.itemId === state.draggedItemId) return;
    event.preventDefault();
    const plan = findPlan(card.dataset.planId);
    const ids = (plan?.items || []).map((item) => String(item.id));
    const from = ids.indexOf(state.draggedItemId);
    const to = ids.indexOf(targetRow.dataset.itemId);
    if (from < 0 || to < 0) return;
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    await reorderStudyItems(plan, ids);
  });

  loadStudyPlans().catch(err => toast(err.message));
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
  let previewFrame = 0;

  function updateNotePreview() {
    const html = renderMarkdownCached(noteMarkdownInput.value);
    notePreview.classList.toggle('empty-preview', !html);
    notePreview.innerHTML = html || '开始输入后显示预览。';
  }

  function scheduleNotePreviewUpdate() {
    if (previewFrame) return;
    previewFrame = requestAnimationFrame(() => {
      previewFrame = 0;
      updateNotePreview();
    });
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
        iconPreview.innerHTML = renderMarkdownCached(note.body || '');
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

  noteMarkdownInput.addEventListener('input', scheduleNotePreviewUpdate);
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

if (page === 'login') initLoginPage();
if (page === 'todos') {
  initLogoutButton();
  initTodosPage();
}
if (page === 'countdowns') {
  initLogoutButton();
  initCountdownsPage();
}
if (page === 'study') {
  initLogoutButton();
  initStudyPage();
}
if (page === 'notes') {
  initLogoutButton();
  initNotesPage();
}
