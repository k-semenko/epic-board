(()=>{
const normalized = (text) => text.replace(/\r\n?/g, '\n').replace(/\n+$/, '');

function protectLute(lute, document, marked) {
  const parse = (html) => {
    const template = document.createElement('template');
    template.innerHTML = html;
    for (const block of template.content.querySelectorAll('[data-type="html-block"]')) {
      const preview = block.querySelector(':scope > .vditor-ir__preview');
      const source = block.querySelector('code[data-type="html-block"]');
      if (!preview || !source) continue;
      preview.textContent = source.textContent;
      preview.setAttribute('data-render', '1');
    }
    return template;
  };
  const markdownToDom = lute.Md2VditorIRDOM;
  lute.Md2VditorIRDOM = (markdown) => {
    const template = parse(markdownToDom(markdown));
    const source = new Map();
    marked.walkTokens(marked.lexer(markdown), (token) => {
      if (token.type !== 'code' || !token.lang) return;
      const language = token.lang.trim().split(/\s+/)[0];
      const key = `${language}\0${normalized(token.text)}`;
      if (!source.has(key)) source.set(key, []);
      source.get(key).push(token.lang.trim());
    });
    const rendered = new Map();
    for (const block of template.content.querySelectorAll('[data-type="code-block"]')) {
      const info = block.querySelector('[data-type="code-block-info"]');
      const code = block.querySelector('pre > code');
      if (!info || !code) continue;
      const key = `${info.textContent.replace(/\u200b/g, '').trim()}\0${normalized(code.textContent)}`;
      if (!rendered.has(key)) rendered.set(key, []);
      rendered.get(key).push(info);
    }
    // Match only fresh source and matching block contents, never a cache from an earlier edit.
    for (const [key, infos] of source) {
      const elements = rendered.get(key);
      if (elements?.length !== infos.length) continue;
      elements.forEach((element, index) => { element.textContent = `\u200b${infos[index]}`; });
    }
    return template.innerHTML;
  };
  const spin = lute.SpinVditorIRDOM;
  lute.SpinVditorIRDOM = (html) => {
    const template = parse(html);
    const infos = new Map();
    let prefix = 'epic-code-info-';
    while (html.includes(prefix)) prefix += 'x';
    for (const element of template.content.querySelectorAll('[data-type="code-block-info"]')) {
      const value = element.textContent.replace(/\u200b/g, '').trim();
      if (!/\s/.test(value)) continue;
      const token = `${prefix}${infos.size}`;
      infos.set(token, value);
      element.textContent = token;
    }
    const result = parse(spin(template.innerHTML));
    // Metadata travels with its own node through the parser, including duplicate or edited blocks.
    for (const element of result.content.querySelectorAll('[data-type="code-block-info"]')) {
      const token = element.textContent.replace(/\u200b/g, '').trim();
      if (infos.has(token)) element.textContent = `\u200b${infos.get(token)}`;
    }
    return result.innerHTML;
  };
  return lute;
}


(() => {
  const toolbar = ['headings', 'bold', 'italic', 'strike', '|', 'quote', 'list', 'ordered-list', 'check', '|', 'code', 'inline-code', 'link', 'table', '|', 'undo', 'redo'];

  async function mountMarkdownEditor({ root, text = '', lang = 'en', onChange = () => {}, onSave = () => {} }) {
    if (typeof globalThis.Vditor !== 'function' || typeof globalThis.Lute?.New !== 'function' || !globalThis.EpicVditorI18n?.en || typeof globalThis.marked?.lexer !== 'function') throw new Error('The local Markdown editor assets failed to load');
    const source = String(text);
    const createLute = globalThis.Lute.New;
    globalThis.Lute.New = (...args) => {
      const lute = createLute(...args);
      lute.SetInlineMath(false);
      lute.SetVditorHTMLBlockPreview(false);
      return protectLute(lute, root.ownerDocument, globalThis.marked);
    };
    let editor;
    let ready = false;
    let destroyed = false;
    let baseline = '';
    let last = source;
    let observer;
    const read = () => {
      const markdown = editor.getValue();
      return markdown === baseline ? source : markdown;
    };
    const notify = () => {
      if (!ready || destroyed) return;
      const markdown = read();
      if (markdown === last) return;
      last = markdown;
      onChange(markdown);
    };
    const flushUndo = () => {
      if (!ready || destroyed) return;
      const state = editor.vditor;
      clearTimeout(state.ir.processTimeoutId);
      state.undo.addToUndoStack(state);
      notify();
    };
    const keydown = (event) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key.toLowerCase() === 'z' && !event.shiftKey) flushUndo();
      if (event.key.toLowerCase() === 'z' && event.shiftKey) {
        event.preventDefault();
        event.stopPropagation();
        editor.vditor.undo.redo(editor.vditor);
        notify();
        return;
      }
      if (event.key.toLowerCase() !== 's') return;
      event.preventDefault();
      event.stopPropagation();
      notify();
      onSave();
    };
    const click = (event) => {
      if (event.target.closest('[data-type="undo"]')) flushUndo();
    };
    await new Promise((resolve, reject) => {
      try {
        editor = new globalThis.Vditor(root, {
          mode: 'ir', value: source, cache: { enable: false },
          i18n: globalThis.EpicVditorI18n[lang] || globalThis.EpicVditorI18n.en,
          lang: lang === 'ru' ? 'ru_RU' : 'en_US',
          cdn: '/vendor', _lutePath: '/vendor/vditor-lute.min.js', icon: '',
          toolbar, toolbarConfig: { pin: true }, height: 'auto',
          undoDelay: 100, typewriterMode: false,
          hint: { emoji: {}, emojiPath: '/vendor', parse: false },
          link: { isOpen: false }, image: { isPreview: false },
          outline: { enable: false }, resize: { enable: false },
          preview: {
            mode: 'editor', hljs: { enable: false },
            theme: { current: '', path: '' },
            render: { media: { enable: false } },
            markdown: { sanitize: true, autoSpace: false, fixTermTypo: false, codeBlockPreview: false, mathBlockPreview: false },
          },
          input: notify,
          after() {
            globalThis.Lute.New = createLute;
            if (destroyed) return;
            baseline = editor.getValue();
            editor.blur();
            ready = true;
            root.addEventListener('input', notify);
            root.addEventListener('change', notify);
            root.addEventListener('keydown', keydown, true);
            root.addEventListener('click', click, true);
            root.addEventListener('touchstart', click, true);
            observer = new MutationObserver(notify);
            observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true });
            resolve();
          },
        });
      } catch (error) { globalThis.Lute.New = createLute; reject(error); }
    });
    return {
      getMarkdown: read,
      destroy() {
        if (destroyed) return;
        destroyed = true;
        ready = false;
        observer?.disconnect();
        root.removeEventListener('input', notify);
        root.removeEventListener('change', notify);
        root.removeEventListener('keydown', keydown, true);
        root.removeEventListener('click', click, true);
        root.removeEventListener('touchstart', click, true);
        clearTimeout(editor.vditor.ir.processTimeoutId);
        clearTimeout(editor.vditor.ir.hlToolbarTimeoutId);
        editor.destroy();
        root.replaceChildren();
      },
    };
  }

  globalThis.EpicMarkdown = { mountMarkdownEditor };
})();

})();
