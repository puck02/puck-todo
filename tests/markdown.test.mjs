import assert from 'node:assert/strict';
import test from 'node:test';

import { renderMarkdown } from '../static/markdown.js';

test('renderMarkdown turns lightweight markdown into safe html', () => {
  const html = renderMarkdown('# 会议纪要\n\n- [x] 完成复盘\n- **明天**继续\n\nhttps://example.com\n<script>alert(1)</script>');

  assert.match(html, /<h1>会议纪要<\/h1>/);
  assert.match(html, /<input type="checkbox" checked disabled \/>/);
  assert.match(html, /<strong>明天<\/strong>继续/);
  assert.match(html, /<a href="https:\/\/example\.com" target="_blank" rel="noopener noreferrer">https:\/\/example\.com<\/a>/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});
