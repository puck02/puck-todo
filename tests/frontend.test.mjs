import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

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

  const deleteHandler = app.indexOf("del.addEventListener('click'");
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
