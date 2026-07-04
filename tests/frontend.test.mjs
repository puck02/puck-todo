import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function dataName(name) {
  return name.replace(/^data-/, '').replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
}

function decodeHtml(value = '') {
  return String(value)
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&amp;', '&');
}

class FakeClassList {
  constructor(element) {
    this.element = element;
    this.items = new Set();
  }

  set(value) {
    this.items = new Set(String(value || '').split(/\s+/).filter(Boolean));
  }

  add(...tokens) {
    for (const token of tokens) this.items.add(token);
  }

  remove(...tokens) {
    for (const token of tokens) this.items.delete(token);
  }

  toggle(token, force) {
    const enabled = force === undefined ? !this.items.has(token) : Boolean(force);
    if (enabled) this.items.add(token);
    else this.items.delete(token);
    return enabled;
  }

  contains(token) {
    return this.items.has(token);
  }

  toString() {
    return [...this.items].join(' ');
  }
}

class FakeEvent {
  constructor(type, options = {}) {
    this.type = type;
    this.bubbles = options.bubbles ?? true;
    this.dataTransfer = options.dataTransfer || null;
    this.defaultPrevented = false;
    this.target = options.target || null;
    this.currentTarget = null;
    this.stopped = false;
  }

  preventDefault() {
    this.defaultPrevented = true;
  }

  stopPropagation() {
    this.stopped = true;
  }
}

class FakeElement {
  constructor(tagName, ownerDocument) {
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = ownerDocument;
    this.parentNode = null;
    this.children = [];
    this.dataset = {};
    this.attributes = new Map();
    this.classList = new FakeClassList(this);
    this.style = {};
    this.eventListeners = new Map();
    this._textContent = '';
    this._innerHTML = '';
    this.disabled = false;
    this.value = '';
    this.name = '';
    this.id = '';
    this.type = '';
    this.draggable = false;
  }

  get className() {
    return this.classList.toString();
  }

  set className(value) {
    this.classList.set(value);
    this.attributes.set('class', this.className);
  }

  get textContent() {
    return this._textContent + this.children.map((child) => child.textContent).join('');
  }

  set textContent(value) {
    this.children = [];
    this._textContent = String(value ?? '');
  }

  get innerHTML() {
    return this._innerHTML;
  }

  set innerHTML(value) {
    const html = String(value ?? '');
    this._innerHTML = html;
    this.children = [];
    this._textContent = '';
    parseStudyHtml(this, html);
  }

  get elements() {
    const controls = {};
    for (const element of this.querySelectorAll('input, button, select, textarea')) {
      if (element.name) controls[element.name] = element;
    }
    return controls;
  }

  setAttribute(name, value) {
    const stringValue = String(value);
    this.attributes.set(name, stringValue);
    if (name === 'id') {
      this.id = stringValue;
      this.ownerDocument?.register(this);
    } else if (name === 'class') {
      this.className = stringValue;
    } else if (name === 'disabled') {
      this.disabled = true;
    } else if (name === 'name') {
      this.name = stringValue;
    } else if (name === 'type') {
      this.type = stringValue;
    } else if (name.startsWith('data-')) {
      this.dataset[dataName(name)] = stringValue;
    } else {
      this[name] = stringValue;
    }
  }

  getAttribute(name) {
    return this.attributes.get(name) || null;
  }

  append(...nodes) {
    for (const node of nodes) this.appendChild(node);
  }

  appendChild(node) {
    node.parentNode = this;
    this.children.push(node);
    return node;
  }

  replaceChildren(...nodes) {
    this.children = [];
    this.append(...nodes);
  }

  addEventListener(type, handler) {
    if (!this.eventListeners.has(type)) this.eventListeners.set(type, []);
    this.eventListeners.get(type).push(handler);
  }

  dispatchEvent(event) {
    if (!event.target) event.target = this;
    let node = this;
    while (node) {
      event.currentTarget = node;
      for (const handler of node.eventListeners.get(event.type) || []) handler(event);
      if (!event.bubbles || event.stopped) break;
      node = node.parentNode;
    }
    return !event.defaultPrevented;
  }

  click() {
    this.dispatchEvent(new FakeEvent('click'));
  }

  focus() {}

  contains(node) {
    for (let current = node; current; current = current.parentNode) {
      if (current === this) return true;
    }
    return false;
  }

  closest(selector) {
    for (let current = this; current; current = current.parentNode) {
      if (matchesSelector(current, selector)) return current;
    }
    return null;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const selectors = selector.split(',').map((item) => item.trim()).filter(Boolean);
    const results = [];
    const visit = (node) => {
      for (const child of node.children) {
        if (selectors.some((item) => matchesSelector(child, item)) && !results.includes(child)) results.push(child);
        visit(child);
      }
    };
    visit(this);
    return results;
  }
}

class FakeDocument {
  constructor() {
    this.elementsById = new Map();
    this.body = new FakeElement('body', this);
  }

  createElement(tagName) {
    return new FakeElement(tagName, this);
  }

  createDocumentFragment() {
    return new FakeElement('fragment', this);
  }

  register(element) {
    if (element.id) this.elementsById.set(element.id, element);
  }

  getElementById(id) {
    return this.elementsById.get(id) || null;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    if (selector.startsWith('body[data-page="study"] ')) {
      if (this.body.dataset.page !== 'study') return [];
      return this.body.querySelectorAll(selector.slice('body[data-page="study"] '.length));
    }
    return matchesSelector(this.body, selector) ? [this.body, ...this.body.querySelectorAll(selector)] : this.body.querySelectorAll(selector);
  }

  addEventListener() {}
}

function parseAttributes(raw = '') {
  const attrs = {};
  const pattern = /([\w:-]+)(?:="([^"]*)")?/g;
  let match;
  while ((match = pattern.exec(raw))) attrs[match[1]] = match[2] ?? '';
  return attrs;
}

function applyAttributes(element, attrs) {
  for (const [name, value] of Object.entries(attrs)) element.setAttribute(name, value);
}

function createElementFromTag(parent, tagName, attrs = {}, text = '') {
  const element = parent.ownerDocument.createElement(tagName);
  applyAttributes(element, attrs);
  element.textContent = decodeHtml(text);
  return element;
}

function parseButtons(parent, html) {
  const buttons = [];
  const pattern = /<button\s+([^>]*)>([\s\S]*?)<\/button>/g;
  let match;
  while ((match = pattern.exec(html))) {
    const button = createElementFromTag(parent, 'button', parseAttributes(match[1]), match[2]);
    buttons.push(button);
  }
  return buttons;
}

function parseStudyHtml(parent, html) {
  if (html.includes('data-study-action="edit-plan"')) {
    parent.append(...parseButtons(parent, html));
    return;
  }

  if (html.includes('name="title"') && html.includes('data-study-action') === false) {
    const label = createElementFromTag(parent, 'label', { class: 'field' });
    label.appendChild(createElementFromTag(parent, 'span', {}, '章节'));
    const inputMatch = html.match(/<input\s+([^>]*)\/>/);
    if (inputMatch) label.appendChild(createElementFromTag(parent, 'input', parseAttributes(inputMatch[1])));
    parent.append(label, ...parseButtons(parent, html));
    return;
  }

  if (html.includes('drag-handle')) {
    const firstButtons = parseButtons(parent, html.split('<div class="study-item-actions">')[0]);
    parent.append(...firstButtons);
    const titleMatch = html.match(/<p class="study-item-title">([\s\S]*?)<\/p>/);
    if (titleMatch) {
      const title = createElementFromTag(parent, 'p', { class: 'study-item-title' }, titleMatch[1]);
      if (titleMatch[1].includes('<img')) title.appendChild(createElementFromTag(parent, 'img'));
      parent.appendChild(title);
    }
    const actions = createElementFromTag(parent, 'div', { class: 'study-item-actions' });
    actions.append(...parseButtons(parent, html.match(/<div class="study-item-actions">([\s\S]*?)<\/div>/)?.[1] || ''));
    parent.appendChild(actions);
  }
}

function matchesSelector(element, selector) {
  if (!element) return false;
  if (selector.startsWith('#')) return element.id === selector.slice(1);
  if (/^[a-z]+$/i.test(selector)) return element.tagName.toLowerCase() === selector.toLowerCase();
  if (selector.startsWith('.')) {
    return selector.slice(1).split('.').every((className) => element.classList.contains(className));
  }

  const attrMatch = selector.match(/^(?:([a-z]+))?\[([\w-]+)(?:=["']?([^"'\]]+)["']?)?\]$/i);
  if (attrMatch) {
    const [, tagName, attrName, attrValue] = attrMatch;
    if (tagName && element.tagName.toLowerCase() !== tagName.toLowerCase()) return false;
    const value = attrName.startsWith('data-') ? element.dataset[dataName(attrName)] : element.getAttribute(attrName);
    return attrValue === undefined ? value !== undefined && value !== null : String(value) === attrValue;
  }
  return false;
}

function createStudyDocument() {
  const document = new FakeDocument();
  document.body.dataset.page = 'study';
  const logout = document.createElement('button');
  logout.setAttribute('id', 'logoutButton');
  const toast = document.createElement('div');
  toast.setAttribute('id', 'toast');
  const form = document.createElement('form');
  form.setAttribute('id', 'studyPlanForm');
  const titleInput = document.createElement('input');
  titleInput.setAttribute('id', 'studyPlanTitleInput');
  form.appendChild(titleInput);
  const meta = document.createElement('p');
  meta.setAttribute('id', 'studyPlansMeta');
  const list = document.createElement('div');
  list.setAttribute('id', 'studyPlansList');
  document.body.append(logout, form, meta, list, toast);
  return document;
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

test('office UI keeps todos and notes on separate pages', async () => {
  const [homeHtml, notesHtml, app, style] = await Promise.all([
    readFile(new URL('../static/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../static/notes.html', import.meta.url), 'utf8'),
    readFile(new URL('../static/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../static/style.css', import.meta.url), 'utf8')
  ]);

  assert.match(homeHtml, /data-page="todos"/);
  assert.match(homeHtml, /href="\/notes\.html"/);
  assert.doesNotMatch(homeHtml, /id="noteForm"/);
  assert.doesNotMatch(homeHtml, /id="notesList"/);
  assert.match(notesHtml, /data-page="notes"/);
  assert.match(notesHtml, /href="\/"/);
  assert.match(notesHtml, /id="noteForm"/);
  assert.match(notesHtml, /id="noteMarkdownInput"/);
  assert.match(notesHtml, /id="notePreview"/);
  assert.match(notesHtml, /id="notesList"/);
  assert.match(notesHtml, /id="folderView"/);
  assert.match(notesHtml, /id="editorView"/);
  assert.match(notesHtml, /class="editor-view hidden"/);
  assert.match(notesHtml, /id="newItemButton"/);
  assert.match(notesHtml, /id="newItemMenu"/);
  assert.match(notesHtml, /data-create-type="file"/);
  assert.match(notesHtml, /data-create-type="folder"/);
  assert.match(notesHtml, /id="breadcrumb"/);
  assert.match(notesHtml, /id="contextMenu"/);
  assert.match(notesHtml, /finder-icon-grid/);
  assert.match(notesHtml, /class="folder-stage"/);
  assert.match(notesHtml, /class="note-form editor-form"/);
  assert.ok(notesHtml.indexOf('class="preview-wrap"') < notesHtml.indexOf('class="field editor-field"'));
  assert.doesNotMatch(notesHtml, /全部笔记/);
  assert.match(notesHtml, /type="module"/);
  assert.match(app, /from '\/markdown\.js'/);
  assert.match(app, /\/api\/notes/);
  assert.match(app, /renderMarkdown/);
  assert.match(app, /initTodosPage/);
  assert.match(app, /initNotesPage/);
  assert.match(app, /enterFolder/);
  assert.match(app, /openEditor/);
  assert.match(app, /closeEditor/);
  assert.match(app, /contextMenu/);
  assert.match(app, /parent_id/);
  assert.match(app, /note-file-card/);
  assert.match(app, /folder-card/);
  assert.match(app, /file-icon/);
  assert.doesNotMatch(app, /file-preview/);
  assert.doesNotMatch(app, /dblclick/);
  assert.match(app, /addEventListener\('click', openItem\)/);
  assert.match(app, /stopPropagation\(\)/);
  assert.doesNotMatch(app, /toggleNotesDrawer/);
  assert.doesNotMatch(app, /drawer-collapsed/);
  assert.match(style, /\.folder-icon/);
  assert.match(style, /\.editor-view/);
  assert.match(style, /\.topbar\s*\{[\s\S]*position:\s*fixed/);
  assert.match(style, /\.topbar\s*\{[\s\S]*background:\s*rgba\(255,\s*255,\s*255,\s*0\.7\)/);
  assert.match(style, /\.topbar\s*\{[\s\S]*backdrop-filter:\s*blur\(12px\)/);
  assert.doesNotMatch(style, /\.file-preview/);
  assert.doesNotMatch(style, /notes-drawer|finder-body|drawer-collapsed|finder-workspace|note-actions|note-editor|note-item-actions/);
});

test('office UI includes login page and logout controls', async () => {
  const [homeHtml, notesHtml, loginHtml, app, style] = await Promise.all([
    readFile(new URL('../static/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../static/notes.html', import.meta.url), 'utf8'),
    readFile(new URL('../static/login.html', import.meta.url), 'utf8'),
    readFile(new URL('../static/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../static/style.css', import.meta.url), 'utf8')
  ]);

  assert.match(loginHtml, /data-page="login"/);
  assert.match(loginHtml, /id="loginForm"/);
  assert.match(loginHtml, /id="emailInput"/);
  assert.match(loginHtml, /id="passwordInput"/);
  assert.match(homeHtml, /id="logoutButton"/);
  assert.match(notesHtml, /id="logoutButton"/);
  assert.match(app, /initLoginPage/);
  assert.match(app, /\/api\/auth\/login/);
  assert.match(app, /\/api\/auth\/logout/);
  assert.match(style, /\.login-shell/);
  assert.match(style, /\.logout-btn/);
});

test('office UI includes a countdown page', async () => {
  const [homeHtml, notesHtml, countdownHtml, app, style] = await Promise.all([
    readFile(new URL('../static/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../static/notes.html', import.meta.url), 'utf8'),
    readFile(new URL('../static/countdowns.html', import.meta.url), 'utf8'),
    readFile(new URL('../static/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../static/style.css', import.meta.url), 'utf8')
  ]);

  for (const html of [homeHtml, notesHtml, countdownHtml]) {
    assert.match(html, /href="\/countdowns\.html"/);
    assert.match(html, />倒数日</);
  }
  assert.match(countdownHtml, /data-page="countdowns"/);
  assert.match(countdownHtml, /aria-current="page">倒数日</);
  assert.match(countdownHtml, /id="logoutButton"/);
  assert.match(countdownHtml, /id="countdownForm"/);
  assert.match(countdownHtml, /id="countdownTitleInput"/);
  assert.match(countdownHtml, /id="countdownTypeInput"/);
  assert.match(countdownHtml, /id="countdownDateInput"/);
  assert.match(countdownHtml, /id="countdownDayInput"/);
  assert.match(countdownHtml, /value="monthly"/);
  assert.match(countdownHtml, /value="anniversary"/);
  assert.match(countdownHtml, /id="countdownsMeta"/);
  assert.match(countdownHtml, /id="countdownsList"/);
  assert.match(countdownHtml, /type="module"/);

  assert.match(app, /initCountdownsPage/);
  assert.match(app, /\/api\/countdowns/);
  assert.match(app, /monthlyCountdownStatus/);
  assert.match(app, /anniversaryCountdownStatus/);
  assert.match(app, /event_type/);
  assert.match(app, /还有/);
  assert.match(app, /已过去/);
  assert.match(app, /周年/);
  assert.match(app, /今天/);
  assert.match(style, /\.countdown-extra/);
  assert.match(style, /\.countdown-field-hidden/);
  assert.match(style, /\.countdown-grid/);
  assert.match(style, /\.countdown-card/);
  assert.match(style, /\.countdown-value/);
});

test('office UI includes a study plans page', async () => {
  const [homeHtml, notesHtml, countdownHtml, studyHtml, style] = await Promise.all([
    readFile(new URL('../static/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../static/notes.html', import.meta.url), 'utf8'),
    readFile(new URL('../static/countdowns.html', import.meta.url), 'utf8'),
    readFile(new URL('../static/study.html', import.meta.url), 'utf8'),
    readFile(new URL('../static/style.css', import.meta.url), 'utf8')
  ]);

  for (const html of [homeHtml, notesHtml, countdownHtml, studyHtml]) {
    assert.match(html, /href="\/study\.html"/);
    assert.match(html, />学习计划</);
  }
  assert.match(studyHtml, /data-page="study"/);
  assert.match(studyHtml, /aria-current="page">学习计划</);
  assert.match(studyHtml, /id="studyPlanForm"/);
  assert.match(studyHtml, /id="studyPlanTitleInput"/);
  assert.match(studyHtml, /id="studyPlansList"/);
  assert.match(studyHtml, /id="studyPlansMeta"/);
  assert.match(studyHtml, /type="module"/);

  assert.match(style, /\.study-plan-card/);
  assert.match(style, /\.study-progress-bar/);
  assert.match(style, /\.study-item-row/);
  assert.match(style, /\.drag-handle/);
});

test('study plans page wires API progress and reorder interactions', async () => {
  const app = await readFile(new URL('../static/app.js', import.meta.url), 'utf8');

  assert.match(app, /import \{ escapeHtml, renderMarkdown \} from '\/markdown\.js'/);
  assert.match(app, /function\s+initStudyPage/);
  assert.match(app, /\/api\/study-plans/);
  assert.match(app, /\/api\/study-plan-items/);
  assert.match(app, /function\s+studyProgress/);
  assert.match(app, /study-progress-bar/);
  assert.match(app, /study-item-row/);
  assert.match(app, /dragstart/);
  assert.match(app, /drop/);
  assert.match(app, /reorderStudyItems/);
  assert.match(app, /data-study-action="move-up"/);
  assert.match(app, /data-study-action="move-down"/);
});

test('study plans interactions render safely update progress and guard reorder', async () => {
  const document = createStudyDocument();
  const reorderBodies = [];
  let failNextItemPatch = false;
  let nextItemId = 103;
  const plans = [
    {
      id: 1,
      title: '计划 A',
      total_items: 2,
      completed_items: 0,
      progress_percent: 0,
      items: [
        { id: 101, plan_id: 1, title: '<img src=x onerror=alert(1)>', status: 'pending', position: 1, completed_at: null },
        { id: 102, plan_id: 1, title: '第二章', status: 'pending', position: 2, completed_at: null }
      ]
    },
    {
      id: 2,
      title: '计划 B',
      total_items: 1,
      completed_items: 0,
      progress_percent: 0,
      items: [
        { id: 201, plan_id: 2, title: '跨计划章节', status: 'pending', position: 1, completed_at: null }
      ]
    }
  ];

  const syncPlanProgress = (plan) => {
    plan.total_items = plan.items.length;
    plan.completed_items = plan.items.filter((item) => item.status === 'completed').length;
    plan.progress_percent = plan.total_items ? Math.round((plan.completed_items / plan.total_items) * 100) : 0;
  };
  const findServerItem = (itemId) => {
    for (const plan of plans) {
      const item = plan.items.find((entry) => entry.id === itemId);
      if (item) return { plan, item };
    }
    return { plan: null, item: null };
  };
  const jsonResponse = (data, status = 200) => new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });

  const context = {
    __markdown: await import(new URL('../static/markdown.js', import.meta.url)),
    document,
    Response,
    URLSearchParams,
    console,
    confirm: () => true,
    prompt: () => null,
    setTimeout,
    clearTimeout,
    fetch: async (path, options = {}) => {
      const method = options.method || 'GET';
      const body = options.body ? JSON.parse(options.body) : null;

      if (path === '/api/study-plans' && method === 'GET') return jsonResponse({ plans: deepClone(plans) });

      const reorderMatch = String(path).match(/^\/api\/study-plans\/(\d+)\/items\/reorder$/);
      if (reorderMatch && method === 'POST') {
        const plan = plans.find((entry) => entry.id === Number(reorderMatch[1]));
        reorderBodies.push(body);
        plan.items = body.item_ids.map((itemId) => plan.items.find((item) => item.id === itemId));
        plan.items.forEach((item, index) => { item.position = index + 1; });
        syncPlanProgress(plan);
        return jsonResponse(deepClone(plan));
      }

      const addItemMatch = String(path).match(/^\/api\/study-plans\/(\d+)\/items$/);
      if (addItemMatch && method === 'POST') {
        const plan = plans.find((entry) => entry.id === Number(addItemMatch[1]));
        const item = { id: nextItemId++, plan_id: plan.id, title: body.title, status: 'pending', position: plan.items.length + 1, completed_at: null };
        plan.items.push(item);
        syncPlanProgress(plan);
        return jsonResponse(deepClone(item), 201);
      }

      const itemMatch = String(path).match(/^\/api\/study-plan-items\/(\d+)$/);
      if (itemMatch && method === 'PATCH') {
        if (failNextItemPatch) {
          failNextItemPatch = false;
          return jsonResponse({ error: '保存失败' }, 500);
        }
        const { plan, item } = findServerItem(Number(itemMatch[1]));
        if ('status' in body) {
          item.status = body.status;
          item.completed_at = body.status === 'completed' ? '2026-07-04T13:00:00' : null;
        }
        if ('title' in body) item.title = body.title;
        syncPlanProgress(plan);
        return jsonResponse(deepClone(item));
      }

      if (itemMatch && method === 'DELETE') {
        const { plan, item } = findServerItem(Number(itemMatch[1]));
        plan.items = plan.items.filter((entry) => entry.id !== item.id);
        syncPlanProgress(plan);
        return jsonResponse({ ok: true });
      }

      return jsonResponse({ ok: true });
    }
  };
  context.window = { location: { pathname: '/study.html', search: '', href: '' } };
  context.window.window = context.window;

  const app = await readFile(new URL('../static/app.js', import.meta.url), 'utf8');
  const source = app.replace("import { escapeHtml, renderMarkdown } from '/markdown.js';", 'const { escapeHtml, renderMarkdown } = globalThis.__markdown;');
  vm.runInNewContext(source, context, { filename: 'static/app.js' });
  const settle = async () => {
    for (let i = 0; i < 4; i += 1) await flush();
  };
  const planCard = (id = 1) => document.querySelector(`[data-plan-id="${id}"]`);
  const planRows = (id = 1) => planCard(id).querySelectorAll('.study-item-row');
  const progressText = () => planCard(1).querySelector('.study-progress-text').textContent;
  const actionButton = (row, action) => row.querySelector(`[data-study-action="${action}"]`);

  await settle();
  assert.equal(progressText(), '0/2 · 0%');
  assert.equal(document.querySelectorAll('img').length, 0);
  assert.match(planRows()[0].querySelector('.study-item-title').textContent, /<img src=x/);

  actionButton(planRows()[0], 'toggle-item').click();
  await settle();
  assert.equal(progressText(), '1/2 · 50%');
  assert.equal(planCard(1).querySelectorAll('.study-item-row.completed').length, 1);
  assert.equal(document.getElementById('studyPlanTitleInput').disabled, false);

  failNextItemPatch = true;
  actionButton(planRows()[0], 'toggle-item').click();
  await settle();
  assert.equal(progressText(), '1/2 · 50%');
  assert.equal(planCard(1).querySelectorAll('.study-item-row.completed').length, 1);
  assert.equal(document.getElementById('studyPlanTitleInput').disabled, false);

  const addItemForm = planCard(1).querySelector('form[data-study-action="add-item"]');
  addItemForm.elements.title.value = '第三章';
  addItemForm.dispatchEvent(new FakeEvent('submit'));
  await settle();
  assert.equal(progressText(), '1/3 · 33%');
  assert.ok(planRows().some((row) => row.textContent.includes('第三章')));

  const addedRow = planRows().find((row) => row.textContent.includes('第三章'));
  actionButton(addedRow, 'delete-item').click();
  await settle();
  assert.equal(progressText(), '1/2 · 50%');
  assert.equal(planRows().some((row) => row.textContent.includes('第三章')), false);

  actionButton(planRows()[1], 'move-up').click();
  await settle();
  assert.deepEqual(reorderBodies.at(-1), { item_ids: [102, 101] });
  assert.match(planRows()[0].textContent, /第二章/);

  const reorderCount = reorderBodies.length;
  const draggedRow = planRows()[0];
  const otherPlanRow = planRows(2)[0];
  draggedRow.dispatchEvent(new FakeEvent('dragstart', { dataTransfer: { effectAllowed: '' } }));
  otherPlanRow.dispatchEvent(new FakeEvent('drop'));
  draggedRow.dispatchEvent(new FakeEvent('dragend'));
  await settle();
  assert.equal(reorderBodies.length, reorderCount);
});

test('todo add and delete interactions use transitions with operation lockout', async () => {
  const [app, style] = await Promise.all([
    readFile(new URL('../static/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../static/style.css', import.meta.url), 'utf8')
  ]);

  const submitHandler = app.indexOf("$('todoForm').addEventListener('submit'");
  const optimisticAdd = app.indexOf('addOptimisticTodo(payload)', submitHandler);
  const createRequest = app.indexOf("request('/api/todos'", submitHandler);
  assert.ok(submitHandler >= 0, 'todo form submit handler should exist');
  assert.ok(optimisticAdd > submitHandler, 'submit handler should create an optimistic todo');
  assert.ok(createRequest > optimisticAdd, 'optimistic todo should render before POST finishes');

  const deleteHandler = app.indexOf('async function deleteTodo');
  const deleteTransition = app.indexOf('removeTodoWithTransition(item.id)', deleteHandler);
  const deleteRequest = app.indexOf("method: 'DELETE'", deleteHandler);
  assert.ok(deleteHandler >= 0, 'delete click handler should exist');
  assert.ok(deleteTransition > deleteHandler, 'delete handler should start a leave transition');
  assert.ok(deleteRequest > deleteTransition, 'leave transition should run before DELETE request');

  assert.match(app, /setTodoOperationBusy\(true\)/);
  assert.match(app, /setTodoOperationBusy\(false\)/);
  assert.match(style, /\.todo-locked/);
  assert.match(style, /\.todo-item\.entering/);
  assert.match(style, /\.todo-item\.leaving/);
});

test('frontend avoids repeated heavy work during list and editor interactions', async () => {
  const app = await readFile(new URL('../static/app.js', import.meta.url), 'utf8');

  assert.match(app, /todoMarkdownCache/);
  assert.match(app, /function\s+renderMarkdownCached/);
  assert.match(app, /pendingList\.addEventListener\('click', handleTodoListClick\)/);
  assert.match(app, /completedList\.addEventListener\('click', handleTodoListClick\)/);
  assert.match(app, /function\s+scheduleNotePreviewUpdate/);
  assert.match(app, /requestAnimationFrame\(.*updateNotePreview/s);
  assert.match(app, /noteMarkdownInput\.addEventListener\('input', scheduleNotePreviewUpdate\)/);
});
