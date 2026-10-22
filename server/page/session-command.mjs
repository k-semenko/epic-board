// A shell line that resumes this session in the directory where it was bound.
const BUILD = {
  claude: (cwd, id) => `cd ${shQuote(cwd)} && claude --resume ${shQuote(id)}`,
  grok: (cwd, id) => `grok --cwd ${shQuote(cwd)} --resume ${shQuote(id)}`,
  codex: (cwd, id) => `codex resume ${shQuote(id)} -C ${shQuote(cwd)}`,
  cursor: (cwd, id) => `cursor-agent --workspace ${shQuote(cwd)} --resume ${shQuote(id)}`,
};

export function shQuote(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`;
}

// null when the button can copy. 'noCwd' or 'noCommand' when it stays disabled.
export function resumeGap(session) {
  if (!BUILD[session?.agent]) return 'noCommand';
  if (!session?.cwd) return 'noCwd';
  return null;
}

export function resumeCommand(session) {
  const build = BUILD[session?.agent];
  if (!build || !session?.cwd || !session?.id) return null;
  return build(session.cwd, session.id);
}

export function sessionFacts(session, { esc, icon, t }) {
  const line = (key, name, text) => {
    const shown = text ?? '—';
    const title = text ? ` title="${esc(text)}"` : '';
    return `<div class="session-line"><span class="mark" aria-label="${esc(t(key))}">${icon(name)}</span><span class="txt"${title}>${esc(shown)}</span></div>`;
  };
  return `${line('session.doing', 'play', session.doing)}${line('session.next', 'arrowRight', session.next)}`;
}

export function sessionCopyButton(session, { esc, icon, t }) {
  const gap = resumeGap(session);
  const command = gap ? null : resumeCommand(session);
  const label = gap ? t(gap === 'noCwd' ? 'session.noCwd' : 'session.noCommand') : command;
  const attrs = gap ? ' disabled' : ` data-copy-command="${esc(command)}"`;
  return `<button type="button" class="session-copy live-only"${attrs} title="${esc(label)}" aria-label="${esc(label)}">${icon('copy')}</button>`;
}
