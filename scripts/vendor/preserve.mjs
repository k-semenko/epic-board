const normalized = (text) => text.replace(/\r\n?/g, '\n').replace(/\n+$/, '');

export function protectLute(lute, document, marked) {
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
