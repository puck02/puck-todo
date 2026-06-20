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
  assert.match(app, /file-preview/);
  assert.match(app, /stopPropagation\(\)/);
  assert.doesNotMatch(app, /toggleNotesDrawer/);
  assert.doesNotMatch(app, /drawer-collapsed/);
  assert.match(style, /\.folder-icon/);
  assert.match(style, /\.editor-view/);
  assert.doesNotMatch(style, /notes-drawer|finder-body|drawer-collapsed|finder-workspace|note-actions|note-editor|note-item-actions/);
});
