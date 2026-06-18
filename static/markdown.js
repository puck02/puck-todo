export function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function safeLink(url, label = url) {
  return `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`;
}

function renderInline(text) {
  const links = [];
  const hold = (html) => {
    links.push(html);
    return `\u0000${links.length - 1}\u0000`;
  };

  let html = escapeHtml(text);
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_match, label, url) => hold(safeLink(url, label)));
  html = html.replace(/(^|[\s(])(https?:\/\/[^\s<]+)/g, (_match, prefix, url) => `${prefix}${hold(safeLink(url))}`);
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  html = html.replace(/\u0000(\d+)\u0000/g, (_match, index) => links[Number(index)]);
  return html;
}

export function renderMarkdown(markdown = '') {
  const lines = String(markdown).replace(/\r\n?/g, '\n').split('\n');
  const html = [];
  let paragraph = [];
  let listOpen = false;
  let codeOpen = false;
  let codeLines = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    html.push(`<p>${paragraph.map(renderInline).join('<br>')}</p>`);
    paragraph = [];
  };

  const closeList = () => {
    if (!listOpen) return;
    html.push('</ul>');
    listOpen = false;
  };

  const flushCode = () => {
    html.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
    codeLines = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();

    if (trimmed.startsWith('```')) {
      flushParagraph();
      closeList();
      if (codeOpen) {
        flushCode();
        codeOpen = false;
      } else {
        codeOpen = true;
      }
      continue;
    }

    if (codeOpen) {
      codeLines.push(rawLine);
      continue;
    }

    if (!trimmed) {
      flushParagraph();
      closeList();
      continue;
    }

    const heading = /^(#{1,3})\s+(.+)$/.exec(trimmed);
    if (heading) {
      flushParagraph();
      closeList();
      html.push(`<h${heading[1].length}>${renderInline(heading[2])}</h${heading[1].length}>`);
      continue;
    }

    const task = /^[-*]\s+\[( |x|X)\]\s+(.+)$/.exec(trimmed);
    if (task) {
      flushParagraph();
      if (!listOpen) {
        html.push('<ul>');
        listOpen = true;
      }
      const checked = task[1].toLowerCase() === 'x' ? ' checked' : '';
      html.push(`<li class="task-item"><input type="checkbox"${checked} disabled /> ${renderInline(task[2])}</li>`);
      continue;
    }

    const list = /^[-*]\s+(.+)$/.exec(trimmed);
    if (list) {
      flushParagraph();
      if (!listOpen) {
        html.push('<ul>');
        listOpen = true;
      }
      html.push(`<li>${renderInline(list[1])}</li>`);
      continue;
    }

    if (trimmed.startsWith('> ')) {
      flushParagraph();
      closeList();
      html.push(`<blockquote>${renderInline(trimmed.slice(2))}</blockquote>`);
      continue;
    }

    paragraph.push(line);
  }

  if (codeOpen) flushCode();
  flushParagraph();
  closeList();
  return html.join('\n');
}
