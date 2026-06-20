import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('office UI keeps todos and notes on separate pages', async () => {
  const [homeHtml, notesHtml, app] = await Promise.all([
    readFile(new URL('../static/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../static/notes.html', import.meta.url), 'utf8'),
    readFile(new URL('../static/app.js', import.meta.url), 'utf8')
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
  assert.match(notesHtml, /class="finder-shell drawer-collapsed"/);
  assert.match(notesHtml, /id="toggleNotesDrawer"/);
  assert.match(notesHtml, /aria-controls="notesDrawer"/);
  assert.match(notesHtml, /id="notesDrawer"/);
  assert.match(notesHtml, /class="finder-workspace"/);
  assert.doesNotMatch(notesHtml, /全部笔记/);
  assert.match(notesHtml, /type="module"/);
  assert.match(app, /from '\/markdown\.js'/);
  assert.match(app, /\/api\/notes/);
  assert.match(app, /renderMarkdown/);
  assert.match(app, /initTodosPage/);
  assert.match(app, /initNotesPage/);
  assert.match(app, /toggleNotesDrawer/);
  assert.match(app, /drawer-collapsed/);
});
