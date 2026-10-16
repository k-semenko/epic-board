import { Editor, rootCtx, defaultValueCtx, editorViewCtx, serializerCtx } from '@milkdown/kit/core';
import { commonmark, codeBlockSchema, imageSchema, toggleStrongCommand, toggleEmphasisCommand, toggleInlineCodeCommand, wrapInHeadingCommand, wrapInBulletListCommand, wrapInOrderedListCommand, wrapInBlockquoteCommand, toggleLinkCommand, updateLinkCommand, createCodeBlockCommand } from '@milkdown/kit/preset/commonmark';
import { gfm, extendListItemSchemaForTask, insertTableCommand } from '@milkdown/kit/preset/gfm';
import { history, undoCommand, redoCommand } from '@milkdown/kit/plugin/history';
import { listener } from '@milkdown/kit/plugin/listener';
import { clipboard } from '@milkdown/kit/plugin/clipboard';
import { indent } from '@milkdown/kit/plugin/indent';
import { trailing } from '@milkdown/kit/plugin/trailing';
import { $node, $remark, $prose, callCommand } from '@milkdown/kit/utils';
import { Plugin } from '@milkdown/kit/prose/state';
import remarkFrontmatter from 'remark-frontmatter';

const frontmatter = $remark('epicFrontmatter', () => remarkFrontmatter, ['yaml', 'toml']);
const originalFrontmatter = $remark('epicOriginalFrontmatter', () => () => (tree, file) => {
  for (const node of tree.children || []) {
    if (!['yaml', 'toml'].includes(node.type)) continue;
    node.epicSource = String(file.value).slice(node.position.start.offset, node.position.end.offset);
  }
});
const preservedBlock = $node('epic_preserved_block', () => ({
  group: 'block', atom: true, defining: true, isolating: true,
  attrs: { raw: { default: '', validate: 'string' } },
  parseDOM: [{ tag: 'pre[data-markdown-preserved]', getAttrs: (element) => ({ raw: element.textContent }) }],
  toDOM: (node) => ['pre', { class: 'epic-opaque', 'data-markdown-preserved': '', contenteditable: 'false' }, node.attrs.raw],
  parseMarkdown: {
    match: (node) => ['yaml', 'toml'].includes(node.type),
    runner: (state, node, type) => state.addNode(type, { raw: node.epicSource }),
  },
  toMarkdown: {
    match: (node) => node.type.name === 'epic_preserved_block',
    runner: (state, node) => state.addNode('html', undefined, node.attrs.raw),
  },
}));

// Keep fenced-code metadata that the commonmark preset otherwise discards.
const codeWithMetadata = codeBlockSchema.extendSchema((previous) => (ctx) => {
  const spec = previous(ctx);
  return {
    ...spec,
    attrs: { ...spec.attrs, meta: { default: '', validate: 'string' } },
    parseMarkdown: {
      match: (node) => node.type === 'code',
      runner: (state, node, type) => {
        state.openNode(type, { language: node.lang || '', meta: node.meta || '' });
        if (node.value) state.addText(node.value);
        state.closeNode();
      },
    },
    toMarkdown: {
      match: (node) => node.type.name === 'code_block',
      runner: (state, node) => state.addNode('code', undefined, node.textContent, { lang: node.attrs.language, meta: node.attrs.meta || null }),
    },
  };
});

// Preserve unsupported image schemes as text without exposing a live src attribute.
const preservedImage = imageSchema.extendSchema((previous) => (ctx) => ({
  ...previous(ctx),
  toDOM: (node) => {
    let safe = false;
    try { safe = ['http:', 'https:'].includes(new URL(node.attrs.src, document.baseURI).protocol); } catch {}
    return safe
      ? ['img', { ...node.attrs, referrerpolicy: 'no-referrer', loading: 'lazy', decoding: 'async', style: 'max-width:100%' }]
      : ['span', { class: 'epic-image', 'data-markdown-image': '', title: node.attrs.src, contenteditable: 'false' }, node.attrs.alt || node.attrs.src];
  },
}));

const taskCheckboxes = extendListItemSchemaForTask.extendSchema((previous) => (ctx) => {
  const spec = previous(ctx);
  return {
    ...spec,
    toDOM: (node) => {
      const base = spec.toDOM(node);
      if (node.attrs.checked == null) return base;
      return ['li', { ...base[1], 'data-type': 'taskItem' },
        ['label', { contenteditable: 'false' }, ['input', { type: 'checkbox', 'data-task-checkbox': '', checked: node.attrs.checked ? '' : null, 'aria-label': node.textContent || 'Task' }]],
        ['div', { class: 'task-list-content' }, 0]];
    },
  };
});

const labels = {
  en: { toolbar: 'Formatting', paragraph: 'Paragraph', heading: 'Heading', bold: 'Bold', italic: 'Italic', bullet: 'Bullet list', ordered: 'Numbered list', quote: 'Quote', link: 'Link', table: 'Table', inline: 'Inline code', code: 'Code block', undo: 'Undo', redo: 'Redo', url: 'Link URL', invalidUrl: 'Use an https://, http://, mailto:, / or # link.' },
  ru: { toolbar: 'Форматирование', paragraph: 'Абзац', heading: 'Заголовок', bold: 'Жирный', italic: 'Курсив', bullet: 'Список', ordered: 'Нумерованный список', quote: 'Цитата', link: 'Ссылка', table: 'Таблица', inline: 'Код в строке', code: 'Блок кода', undo: 'Отменить', redo: 'Повторить', url: 'Адрес ссылки', invalidUrl: 'Используйте ссылку https://, http://, mailto:, / или #.' },
};
const safeUrl = (value) => /^(https?:\/\/|mailto:|#|\/(?![\/\\]))/i.test(value);

export async function mountMarkdownEditor({ root, text = '', lang = 'en', onChange = () => {}, onSave = () => {} }) {
  if (!root || root.nodeType !== 1) throw new TypeError('An editor root element is required');
  const source = String(text);
  const words = labels[lang] || labels.en;
  const doc = root.ownerDocument;
  const toolbar = doc.createElement('div');
  toolbar.className = 'editor-toolbar';
  toolbar.setAttribute('role', 'toolbar');
  toolbar.setAttribute('aria-label', words.toolbar);
  const host = doc.createElement('div');
  host.className = 'editor-document';
  root.replaceChildren(toolbar, host);
  let ready = false;
  let destroyed = false;
  let initialDoc;
  let lastMarkdown = source;
  let editor;
  const getMarkdown = () => editor.action((ctx) => {
    const current = ctx.get(editorViewCtx).state.doc;
    return current.eq(initialDoc) ? source : ctx.get(serializerCtx)(current);
  });
  const changes = $prose(() => new Plugin({
    view: () => ({
      update(view, previous) {
        if (!ready || destroyed || previous.doc.eq(view.state.doc)) return;
        const markdown = getMarkdown();
        if (markdown === lastMarkdown) return;
        lastMarkdown = markdown;
        onChange(markdown);
      },
    }),
    props: {
      handleDOMEvents: {
        change: (view, event) => {
          const input = event.target.closest('input[data-task-checkbox]');
          if (!input) return false;
          const position = view.state.doc.resolve(view.posAtDOM(input.closest('li'), 0));
          for (let depth = position.depth; depth > 0; depth--) {
            const node = position.node(depth);
            if (node.type.name !== 'list_item') continue;
            view.dispatch(view.state.tr.setNodeMarkup(position.before(depth), undefined, { ...node.attrs, checked: input.checked }));
            return true;
          }
          return false;
        },
        click: (_view, event) => {
          if (!event.target.closest('a')) return false;
          event.preventDefault();
          return true;
        },
      },
    },
  }));
  editor = Editor.make().config((ctx) => {
    ctx.set(rootCtx, host);
    ctx.set(defaultValueCtx, source);
  }).use(commonmark.filter((plugin) => !codeBlockSchema.includes(plugin) && !imageSchema.includes(plugin)))
    .use(codeWithMetadata).use(preservedImage).use(gfm.filter((plugin) => !extendListItemSchemaForTask.includes(plugin)))
    .use(taskCheckboxes).use(frontmatter).use(originalFrontmatter).use(preservedBlock)
    .use(history).use(listener).use(clipboard).use(indent).use(trailing).use(changes);
  try {
    await editor.create();
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      view.dispatch(view.state.tr.setMeta('addToHistory', false));
      initialDoc = view.state.doc;
    });
  } catch (error) {
    await editor.destroy().catch(() => {});
    root.replaceChildren();
    throw error;
  }
  const run = (command, payload) => {
    if (destroyed) return;
    editor.action(callCommand(command.key, payload));
    editor.action((ctx) => ctx.get(editorViewCtx).focus());
  };
  const heading = doc.createElement('select');
  heading.setAttribute('aria-label', words.heading);
  for (let level = 0; level <= 6; level++) {
    const option = doc.createElement('option');
    option.value = String(level);
    option.textContent = level ? `${words.heading} ${level}` : words.paragraph;
    heading.append(option);
  }
  heading.addEventListener('change', () => run(wrapInHeadingCommand, Number(heading.value)));
  toolbar.append(heading);
  const button = (label, caption, action) => {
    const element = doc.createElement('button');
    element.type = 'button';
    element.textContent = caption;
    element.title = label;
    element.setAttribute('aria-label', label);
    element.addEventListener('mousedown', (event) => event.preventDefault());
    element.addEventListener('click', action);
    toolbar.append(element);
  };
  button(words.bold, 'B', () => run(toggleStrongCommand));
  button(words.italic, 'I', () => run(toggleEmphasisCommand));
  button(words.bullet, '•', () => run(wrapInBulletListCommand));
  button(words.ordered, '1.', () => run(wrapInOrderedListCommand));
  button(words.quote, '❯', () => run(wrapInBlockquoteCommand));
  button(words.link, words.link, () => {
    const view = editor.action((ctx) => ctx.get(editorViewCtx));
    const mark = view.state.selection.$from.marks().find((value) => value.type.name === 'link');
    const href = doc.defaultView.prompt(words.url, mark?.attrs.href || 'https://');
    if (href === null) return;
    if (!href.trim()) return run(toggleLinkCommand, { href: mark?.attrs.href || '' });
    if (!safeUrl(href.trim())) return void doc.defaultView.alert(words.invalidUrl);
    run(mark ? updateLinkCommand : toggleLinkCommand, { href: href.trim() });
  });
  button(words.table, words.table, () => run(insertTableCommand, { row: 3, col: 3 }));
  button(words.inline, '`', () => run(toggleInlineCodeCommand));
  button(words.code, '</>', () => run(createCodeBlockCommand));
  button(words.undo, '↶', () => run(undoCommand));
  button(words.redo, '↷', () => run(redoCommand));
  const save = (event) => {
    if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 's') return;
    event.preventDefault();
    event.stopPropagation();
    onSave();
  };
  root.addEventListener('keydown', save);
  ready = true;
  return {
    getMarkdown,
    async destroy() {
      if (destroyed) return;
      destroyed = true;
      ready = false;
      root.removeEventListener('keydown', save);
      await editor.destroy();
      root.replaceChildren();
    },
  };
}

globalThis.EpicMarkdown = { mountMarkdownEditor };
