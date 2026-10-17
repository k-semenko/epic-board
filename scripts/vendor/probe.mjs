import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { protectLute } from './preserve.mjs';

const repository = fileURLToPath(new URL('../../', import.meta.url));
let temporary;
let dom;
try {
  let jsdom = process.argv[2];
  if (!jsdom) {
    temporary = await mkdtemp(path.join(os.tmpdir(), 'epic-editor-probe-'));
    execFileSync('npm', ['install', '--prefix', temporary, '--ignore-scripts', '--no-audit', '--no-fund', 'jsdom@26.1.0'], { stdio: 'inherit' });
    jsdom = path.join(temporary, 'node_modules/jsdom');
  }
  const { JSDOM } = createRequire(import.meta.url)(path.resolve(jsdom));
  dom = new JSDOM('', { runScripts: 'outside-only' });
  const window = dom.window;
  window.TextEncoder = TextEncoder;
  window.TextDecoder = TextDecoder;
  for (const name of ['vditor-lute.min.js', 'marked.min.js']) {
    window.eval(await readFile(path.join(repository, 'vendor', name), 'utf8'));
  }
  const lute = protectLute(window.Lute.New(), window.document, window.marked);
  lute.SetSanitize(true);
  lute.SetInlineMath(false);
  lute.SetVditorHTMLBlockPreview(false);
  const parse = (html) => {
    const template = window.document.createElement('template');
    template.innerHTML = html;
    return template;
  };
  const source = '---\ntitle: Keep\n---\n\n# Heading\n\n```js title="first"\nsame\n```\n\n```js title="second"\nsame\n```\n\nText.\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\nA note[^1].\n\n[^1]: Keep footnote\n\n<div><a href="/">Keep HTML</a><iframe src="https://example.invalid"></iframe></div>\n\nInline $x$.\n';
  const initial = lute.Md2VditorIRDOM(source);
  const baseline = lute.VditorIRDOM2Md(initial);
  for (const html of [initial, lute.SpinVditorIRDOM(initial)]) {
    const template = parse(html);
    assert.equal(template.content.querySelectorAll('.vditor-ir__preview a, .vditor-ir__preview iframe, .language-math').length, 0);
    assert.match(lute.VditorIRDOM2Md(html), /```js title="first"/);
    assert.match(lute.VditorIRDOM2Md(html), /```js title="second"/);
  }
  const edited = parse(initial);
  const paragraph = [...edited.content.querySelectorAll('p')].find((node) => node.textContent === 'Text.');
  paragraph.textContent += ' Changed';
  const code = edited.content.querySelector('[data-type="code-block"] pre > code');
  code.textContent = 'edited body\n';
  const markdown = lute.VditorIRDOM2Md(lute.SpinVditorIRDOM(edited.innerHTML));
  for (const fragment of ['title: Keep', '```js title="first"\nedited body', '```js title="second"\nsame', 'Text. Changed', 'Keep footnote', '<a href="/">Keep HTML</a>', 'Inline $x$.']) {
    assert.ok(markdown.includes(fragment), `edited source retains ${fragment}`);
  }
  const replacement = parse(lute.Md2VditorIRDOM('```js\nnew block\n```\n'));
  edited.content.querySelector('[data-type="code-block"]').replaceWith(replacement.content.firstElementChild);
  const replaced = lute.VditorIRDOM2Md(lute.SpinVditorIRDOM(edited.innerHTML));
  assert.match(replaced, /```js\nnew block/);
  assert.ok(!replaced.includes('title="first"'), 'deleted metadata cannot migrate to a new fence');
  assert.match(replaced, /```js title="second"\nsame/);
  assert.equal(lute.VditorIRDOM2Md(lute.SpinVditorIRDOM(initial)), baseline, 'normalization is stable after undo snapshot');
  console.log('PASS: metadata parse/spin, duplicate fences, unrelated/code edits, deleted fence isolation, frontmatter, footnotes, inert HTML, inline math and stable undo snapshot');
} finally {
  dom?.window.close();
  if (temporary) await rm(temporary, { recursive: true, force: true });
}
