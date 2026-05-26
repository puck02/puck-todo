const state = {
  month: '',
  data: { pending: [], completed: [] }
};

const $ = (id) => document.getElementById(id);
const monthPicker = $('monthPicker');
const pendingList = $('pendingList');
const completedList = $('completedList');
const pendingMeta = $('pendingMeta');
const completedMeta = $('completedMeta');
const toastEl = $('toast');
const editModal = $('editModal');
const closeEditModal = $('closeEditModal');
const cancelEdit = $('cancelEdit');
const editForm = $('editForm');
const editTitleInput = $('editTitleInput');
const editPriorityInput = $('editPriorityInput');
const editDueInput = $('editDueInput');
const editNoteInput = $('editNoteInput');

const editState = { currentId: null };

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
  { text: '世界以痛吻我。', author: '泰戈尔' },
  { text: '凡是过往，皆为序章。', author: '莎士比亚' },
  { text: '黑夜给了我黑色的眼睛。', author: '顾城' },
  { text: '面朝大海，春暖花开。', author: '海子' },
  { text: '答案在风中飘。', author: '鲍勃·迪伦' },
  { text: '愿你有好运气。', author: '雷蒙德·卡佛' },
  { text: '道路本身就是答案。', author: '卡夫卡' },
  { text: '凡不能毁灭我的，必使我强大。', author: '尼采' },
  { text: '爱具体的人。', author: '陀思妥耶夫斯基' },
  { text: '人可以被毁灭，不能被打败。', author: '海明威' },
  { text: '纵有疾风起，人生不言弃。', author: '瓦雷里' },
  { text: '要么孤独，要么庸俗。', author: '叔本华' },
  { text: '真实的生活在别处。', author: '米兰·昆德拉' },
  { text: '我们仍未知道答案。', author: '生活' },
  { text: '慢慢来，比较快。', author: '民间箴言' },
  { text: '保持热爱，奔赴山海。', author: '网络箴言' },
  { text: '今日事，今日毕。', author: '富兰克林' },
  { text: '把时间当作朋友。', author: '李笑来' },
  { text: '行动胜过空想。', author: '歌德' },
  { text: '去生活，而不是解释生活。', author: '加缪' },
  { text: '在隆冬，我终于知道。', author: '加缪' }
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
  quoteAuthor.textContent = `——${quote.author}`;
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

function linkify(text) {
  const frag = document.createDocumentFragment();
  const regex = /(https?:\/\/[^\s]+)/g;
  let lastIndex = 0;
  let match;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) frag.append(document.createTextNode(text.slice(lastIndex, match.index)));
    const a = document.createElement('a');
    a.href = match[0];
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = match[0];
    frag.append(a);
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) frag.append(document.createTextNode(text.slice(lastIndex)));
  return frag;
}

function renderNote(note) {
  if (!note) return null;
  const noteEl = document.createElement('div');
  noteEl.className = 'todo-note';
  noteEl.append(linkify(note));
  return noteEl;
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
    empty.textContent = completed ? '这个月还没有完成事项。' : '这个月暂时没有未完成事项，轻松一点也很好。';
    container.appendChild(empty);
    return;
  }

  for (const item of items) {
    const card = document.createElement('article');
    card.className = `todo-item ${completed ? 'completed' : ''}`;

    const check = document.createElement('button');
    check.className = `check ${completed ? 'done' : ''}`;
    check.title = completed ? '取消完成' : '标记完成';
    check.addEventListener('click', async () => {
      await request(`/api/todos/${item.id}/${completed ? 'uncomplete' : 'complete'}`, { method: 'POST' });
      toast(completed ? '已恢复到未完成~' : '完成啦，真棒！');
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
    const noteEl = renderNote(item.note || '');
    if (noteEl) body.append(noteEl);

    const actions = document.createElement('div');
    actions.className = 'actions';
    const edit = document.createElement('button');
    edit.className = 'icon-btn';
    edit.textContent = '编辑';
    edit.addEventListener('click', () => openEditModal(item));
    const del = document.createElement('button');
    del.className = 'icon-btn danger';
    del.textContent = '删除';
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
  pendingMeta.textContent = `${state.data.pending.length} 件待办，按优先级和截止时间排序。`;
  completedMeta.textContent = `${state.data.completed.length} 件已完成，最近完成的在前面。`;
  renderList(pendingList, state.data.pending, false);
  renderList(completedList, state.data.completed, true);
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
  toast('已添加待办~');
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
  toast('已保存修改~');
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
loadTodos().catch(err => toast(err.message));
