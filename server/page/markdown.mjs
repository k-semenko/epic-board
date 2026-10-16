// A small Markdown renderer for the docs viewer. Everything is escaped first, so a document can
// never inject markup or script; only the constructs below turn back into HTML.
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const SAFE_URL = /^(https?:\/\/|mailto:|#|\/(?![\/\\]))/i;

function inline(text) {
  const codes = [];
  let s = esc(text).replace(/`([^`]+)`/g, (_, c) => {
    codes.push(`<code>${c}</code>`);
    return `\u0000${codes.length - 1}\u0000`;
  });
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, url) => {
    const raw = url.replace(/&amp;/g, '&');
    return SAFE_URL.test(raw) ? `<a href="${url}" target="_blank" rel="noopener">${label}</a>` : label;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/__([^_]+)__/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*\w])\*([^*\s][^*]*)\*(?!\w)/g, '$1<em>$2</em>').replace(/(^|[^_\w])_([^_\s][^_]*)_(?!\w)/g, '$1<em>$2</em>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, n) => codes[Number(n)]);
}

const slugify = (text) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '') || 'section';

const LIST = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const TABLE_SEP = /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const cells = (line) => line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

function renderList(items) {
  let out = '';
  let i = 0;
  while (i < items.length) {
    const top = items[i];
    const ordered = /\d/.test(top.marker);
    out += ordered ? '<ol>' : '<ul>';
    while (i < items.length && items[i].indent === top.indent) {
      const item = items[i];
      const children = [];
      i++;
      while (i < items.length && items[i].indent > top.indent) children.push(items[i++]);
      const task = item.text.match(/^\[([ xX])\]\s+(.*)$/);
      const cls = task ? ` class="task${task[1] === ' ' ? '' : ' done'}"` : '';
      out += `<li${cls}>${inline(task ? task[2] : item.text)}${children.length ? renderList(children) : ''}</li>`;
    }
    out += ordered ? '</ol>' : '</ul>';
  }
  return out;
}

export function renderMarkdown(source) {
  const lines = String(source ?? '').replace(/\r\n?/g, '\n').split('\n');
  const toc = [];
  const seen = new Map();
  const blocks = [];
  let para = [];
  const flush = () => {
    if (para.length) blocks.push(`<p>${inline(para.join('\n'))}</p>`);
    para = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = line.match(/^```\s*([\w+-]*)\s*$/);
    if (fence) {
      flush();
      const body = [];
      for (i++; i < lines.length && !/^```\s*$/.test(lines[i]); i++) body.push(lines[i]);
      blocks.push(`<pre><code${fence[1] ? ` class="lang-${esc(fence[1])}"` : ''}>${esc(body.join('\n'))}</code></pre>`);
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (heading) {
      flush();
      const text = heading[2];
      let id = slugify(text);
      const n = seen.get(id) || 0;
      seen.set(id, n + 1);
      if (n) id = `${id}-${n + 1}`;
      toc.push({ level: heading[1].length, text, id });
      blocks.push(`<h${heading[1].length} id="${esc(id)}">${inline(text)}</h${heading[1].length}>`);
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flush();
      blocks.push('<hr>');
      continue;
    }
    if (line.includes('|') && TABLE_SEP.test(lines[i + 1] || '')) {
      flush();
      const head = cells(line);
      const rows = [];
      for (i += 2; i < lines.length && lines[i].includes('|') && lines[i].trim(); i++) rows.push(cells(lines[i]));
      i--;
      blocks.push(`<table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
      continue;
    }
    if (/^>\s?/.test(line)) {
      flush();
      const body = [];
      for (; i < lines.length && /^>\s?/.test(lines[i]); i++) body.push(lines[i].replace(/^>\s?/, ''));
      i--;
      blocks.push(`<blockquote>${renderMarkdown(body.join('\n')).html}</blockquote>`);
      continue;
    }
    if (LIST.test(line)) {
      flush();
      const items = [];
      for (; i < lines.length; i++) {
        const m = lines[i].match(LIST);
        if (m) items.push({ indent: m[1].replace(/\t/g, '  ').length, marker: m[2], text: m[3] });
        else if (lines[i].trim() && /^\s+/.test(lines[i]) && items.length) items.at(-1).text += ` ${lines[i].trim()}`;
        else break;
      }
      i--;
      blocks.push(renderList(items));
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    para.push(line);
  }
  flush();
  return { html: blocks.join('\n'), toc };
}
