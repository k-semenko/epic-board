import { protectLute } from './preserve.mjs';

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
