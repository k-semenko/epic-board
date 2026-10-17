import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readEpic, readHistory } from './store.mjs';
import { allTexts } from './docs.mjs';
import { readSettings } from './settings.mjs';

const PAGE = join(dirname(fileURLToPath(import.meta.url)), 'page');
const VENDOR = join(dirname(fileURLToPath(import.meta.url)), '..', 'vendor');
const inlineScript = (code) => `<script>\n${code.replace(/<\/script/gi, '<\\/script')}\n</script>`;
// Order matters: a module may only import the ones listed before it.
const DEPS = { './i18n.mjs': '__i18n', './lanes.mjs': '__lanes', './icons.mjs': '__icons', './history.mjs': '__history', './markdown.mjs': '__markdown', './section-order.mjs': '__sectionOrder', './section-settings.mjs': '__sectionSettings', './waiting.mjs': '__waiting', './pagination.mjs': '__pagination', './doc-editor.mjs': '__docEditor' };
const IMPORT = /^import\s*\{([^}]+)\}\s*from\s*'([^']+)';\s*$/gm;
const linkImports = (src) => src.replace(IMPORT, (_, list, from) => {
  if (!DEPS[from]) throw new Error(`export bundle: unknown module ${from}`);
  return `const {${list}} = ${DEPS[from]};`;
});

// Each page module becomes a scoped object, so same-named helpers in two modules never collide.
function wrapModule(file, name) {
  const src = readFileSync(join(PAGE, file), 'utf8');
  const names = [...src.matchAll(/^export\s+(?:async\s+)?(?:function\*?|const|let|class)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
  const body = linkImports(src).replace(/^export\s+/gm, '');
  return `const ${name} = (() => {\n${body}\nreturn { ${names.join(', ')} };\n})();\n`;
}

export function bundleScript() {
  const deps = Object.entries(DEPS).map(([file, name]) => wrapModule(file, name)).join('\n');
  const app = linkImports(readFileSync(join(PAGE, 'app.js'), 'utf8'));
  return `(() => {\n${deps}\n${app}\n})();\n`;
}

// JSON inside <script> must not be able to close it: escape every "<".
const LINE_SEPARATORS = /[\u2028\u2029]/g;
const safeJson = (value) => JSON.stringify(value).replace(/</g, '\\u003c').replace(LINE_SEPARATORS, (c) => `\\u${c.charCodeAt(0).toString(16)}`);
const escHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const iconUri = (name) => `data:image/svg+xml,${encodeURIComponent(readFileSync(join(PAGE, name), 'utf8'))}`;

// An export is one file. Icons travel inside it; the home-screen PNG stays on the server.
function detachLocalIcons(html) {
  return html
    .replace('href="/static/favicon.svg"', `href="${iconUri('favicon.svg')}"`)
    .replace('href="/static/favicon-dark.svg"', `href="${iconUri('favicon-dark.svg')}"`)
    .replace(/[ \t]*<link rel="apple-touch-icon" href="\/static\/apple-touch-icon.png">\n/, '');
}

export function buildExport(id) {
  const epic = readEpic(id);
  const history = readHistory(id, { limit: Infinity });
  const css = readFileSync(join(PAGE, 'style.css'), 'utf8');
  const data = { epic, history, docs: allTexts(id), settings: readSettings(), exportedAt: new Date().toISOString() };
  return detachLocalIcons(readFileSync(join(PAGE, 'epic.html'), 'utf8'))
    .replace(/<title>[^<]*<\/title>/, `<title>${escHtml(epic.id)} · ${escHtml(epic.title)} · EpicBoard</title>`)
    .replace('<link rel="stylesheet" href="/static/style.css">', () => `<style>\n${css}\n</style>`)
    .replace('<script src="/vendor/marked.min.js"></script>', () => inlineScript(readFileSync(join(VENDOR, 'marked.min.js'), 'utf8')))
    .replace('<script src="/vendor/purify.min.js"></script>', () => inlineScript(readFileSync(join(VENDOR, 'purify.min.js'), 'utf8')))
    .replace('<script type="module" src="/static/app.js"></script>', () => `<script>window.__EPIC_EXPORT__ = ${safeJson(data)};</script>\n<script>\n${bundleScript().replace(/<\/script/gi, '<\\/script')}\n</script>`);
}
