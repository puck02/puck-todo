import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('office UI exposes notes composer with live markdown preview', async () => {
  const [html, app] = await Promise.all([
    readFile(new URL('../static/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../static/app.js', import.meta.url), 'utf8')
  ]);

  assert.match(html, /id="noteForm"/);
  assert.match(html, /id="noteMarkdownInput"/);
  assert.match(html, /id="notePreview"/);
  assert.match(html, /id="notesList"/);
  assert.match(html, /type="module"/);
  assert.match(app, /from '\/markdown\.js'/);
  assert.match(app, /\/api\/notes/);
  assert.match(app, /renderMarkdown/);
});
