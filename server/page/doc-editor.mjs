export function createDocEditor({ container, text, lang, title, onChange, onSave, onError }) {
  const frame = container.ownerDocument.createElement('iframe');
  frame.className = 'doc-editor-frame';
  frame.src = '/editor';
  frame.title = title || 'Markdown editor';

  let disposed = false;
  let started = false;
  let settled = false;
  let instance = null;
  let resolveReady, rejectReady;
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  // Loading can fail before the parent begins awaiting the editor.
  ready.catch(() => {});

  function stopListening() {
    frame.removeEventListener('load', load);
    frame.removeEventListener('error', loadError);
  }

  function fail(error) {
    if (disposed || settled) return;
    settled = true;
    stopListening();
    rejectReady(error);
    try { onError?.(error); } catch {}
  }

  function liveCallback(callback) {
    return (...args) => { if (!disposed && (!settled || instance)) return callback?.(...args); };
  }

  async function load() {
    if (disposed || started || settled) return;
    started = true;
    stopListening();
    try {
      const root = frame.contentDocument?.querySelector('#editor-root');
      const api = frame.contentWindow?.EpicMarkdown;
      if (!root || typeof api?.mountMarkdownEditor !== 'function') throw new Error('Markdown editor failed to initialize');
      const mounted = await api.mountMarkdownEditor({
        root, text, lang,
        onChange: liveCallback(onChange), onSave: liveCallback(onSave),
      });
      if (disposed) { mounted?.destroy?.(); return; }
      if (typeof mounted?.getMarkdown !== 'function' || typeof mounted?.destroy !== 'function') {
        mounted?.destroy?.();
        throw new Error('Markdown editor returned an invalid instance');
      }
      instance = mounted;
      settled = true;
      resolveReady();
    } catch (error) { fail(error); }
  }

  function loadError() { fail(new Error('Markdown editor failed to load')); }

  function abortError() {
    const error = new Error('Markdown editor was destroyed');
    error.name = 'AbortError';
    return error;
  }

  frame.addEventListener('load', load);
  frame.addEventListener('error', loadError);
  container.appendChild(frame);

  return {
    ready,
    async getMarkdown() {
      await ready;
      if (disposed) throw abortError();
      return instance.getMarkdown();
    },
    destroy() {
      if (disposed) return;
      disposed = true;
      stopListening();
      frame.remove();
      if (!settled) { settled = true; rejectReady(abortError()); }
      const mounted = instance;
      instance = null;
      mounted?.destroy();
    },
  };
}
