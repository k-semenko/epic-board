import test from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown } from '../server/page/markdown.mjs';

test('headings get ids and come back as a table of contents', () => {
  const { html, toc } = renderMarkdown('# Заголовок\n\n## Раздел 1\n\nТекст.\n\n### Подраздел');
  assert.match(html, /<h1 id="заголовок">Заголовок<\/h1>/);
  assert.match(html, /<h2 id="раздел-1">Раздел 1<\/h2>/);
  assert.deepEqual(toc.map((t) => [t.level, t.text, t.id]), [[1, 'Заголовок', 'заголовок'], [2, 'Раздел 1', 'раздел-1'], [3, 'Подраздел', 'подраздел']]);
});

test('paragraphs, inline code, bold, italic, links', () => {
  const { html } = renderMarkdown('Строка **жирно** и *курсив* и `код` и [ссылка](https://example.com/x).\nПродолжение абзаца.');
  assert.match(html, /<p>Строка <strong>жирно<\/strong> и <em>курсив<\/em> и <code>код<\/code> и <a href="https:\/\/example\.com\/x" target="_blank" rel="noopener">ссылка<\/a>\.\nПродолжение абзаца\.<\/p>/);
});

test('lists, nested lists, checkboxes', () => {
  const { html } = renderMarkdown('- a\n- b\n  - b1\n- [x] готово\n- [ ] нет\n\n1. один\n2. два');
  assert.match(html, /<ul><li>a<\/li><li>b<ul><li>b1<\/li><\/ul><\/li><li class="task done">/);
  assert.match(html, /<ol><li>один<\/li><li>два<\/li><\/ol>/);
});

test('fenced code keeps text verbatim and escaped', () => {
  const { html } = renderMarkdown('```js\nconst a = "<b>";\n**not bold**\n```');
  assert.match(html, /<pre><code class="lang-js">const a = &quot;&lt;b&gt;&quot;;\n\*\*not bold\*\*<\/code><\/pre>/);
});

test('tables, quotes, rules', () => {
  const { html } = renderMarkdown('| A | B |\n|---|:-:|\n| 1 | `2` |\n\n> цитата\n\n---');
  assert.match(html, /<table><thead><tr><th>A<\/th><th>B<\/th><\/tr><\/thead><tbody><tr><td>1<\/td><td><code>2<\/code><\/td><\/tr><\/tbody><\/table>/);
  assert.match(html, /<blockquote><p>цитата<\/p><\/blockquote>/);
  assert.match(html, /<hr>/);
});

test('raw html and javascript links never get through', () => {
  const { html } = renderMarkdown('<script>alert(1)</script>\n\n[x](javascript:alert(1)) <img src=x onerror=alert(1)>');
  assert.doesNotMatch(html, /<script|<img|href="javascript/i);
  assert.match(html, /&lt;script&gt;/);
});

test('links that browsers read as another host stay plain text', () => {
  for (const href of ['/\\evil.example', '//evil.example', 'javascript:alert(1)']) {
    assert.doesNotMatch(renderMarkdown(`[x](${href})`).html, /<a /, href);
  }
  assert.match(renderMarkdown('[x](/local)').html, /<a href="\/local"/);
});
