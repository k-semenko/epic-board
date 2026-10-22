import test from 'node:test';
import assert from 'node:assert/strict';
import { resumeCommand, resumeGap, sessionCopyButton, sessionFacts, shQuote } from '../server/page/session-command.mjs';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const icon = (name) => `<svg data-icon="${name}"></svg>`;
const t = (key) => key;
const ui = { esc, icon, t };

test('quotes spaces and embedded single quotes', () => {
  assert.equal(shQuote("a b"), "'a b'");
  assert.equal(shQuote("o'clock"), "'o'\\''clock'");
});

test('resume command per agent uses the full id and the bound directory', () => {
  const cwd = "/work/o'clock";
  const id = '05aeaf99-4c1e-4b7a-9f02-1a6d8e0c33b1';
  const q = `'${cwd.replaceAll("'", `'\\''`)}'`;
  assert.equal(resumeCommand({ agent: 'claude', id, cwd }), `cd ${q} && claude --resume '${id}'`);
  assert.equal(resumeCommand({ agent: 'grok', id, cwd }), `grok --cwd ${q} --resume '${id}'`);
  assert.equal(resumeCommand({ agent: 'codex', id, cwd }), `codex resume '${id}' -C ${q}`);
  assert.equal(resumeCommand({ agent: 'cursor', id, cwd }), `cursor-agent --workspace ${q} --resume '${id}'`);
});

test('no command without a known agent or a directory', () => {
  assert.equal(resumeCommand({ agent: 'gemini', id: 'x', cwd: '/work' }), null);
  assert.equal(resumeGap({ agent: 'gemini', id: 'x', cwd: '/work' }), 'noCommand');
  assert.equal(resumeCommand({ agent: 'claude', id: 'x' }), null);
  assert.equal(resumeGap({ agent: 'claude', id: 'x' }), 'noCwd');
});

test('card lines are one truncated fact each, and the button copies the command', () => {
  const session = { agent: 'claude', id: 'abc', cwd: '/work', doing: 'Night run', next: null };
  const facts = sessionFacts(session, ui);
  assert.match(facts, /data-icon="play"/);
  assert.match(facts, /data-icon="arrowRight"/);
  assert.match(facts, /title="Night run"/);
  assert.match(facts, /session-line/);
  assert.doesNotMatch(facts, /<dt/);
  const button = sessionCopyButton(session, ui);
  assert.match(button, /data-copy-command="cd &#39;\/work&#39; &amp;&amp; claude --resume &#39;abc&#39;"/);
  assert.doesNotMatch(button, /disabled/);
  const quiet = sessionCopyButton({ agent: 'claude', id: 'abc' }, ui);
  assert.match(quiet, /disabled/);
  assert.match(quiet, /session.noCwd/);
  assert.doesNotMatch(quiet, /data-copy-command/);
});
