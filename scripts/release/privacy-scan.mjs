#!/usr/bin/env node
// Fails if tracked files leak personal paths, emails, private keys or tokens.
// A line containing `privacy-scan: allow` is skipped.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './lib.mjs';
import { SECRET_RULES } from '../../server/secrets.mjs';

const SKIP_PREFIXES = ['vendor/'];
const ALLOW_MARK = 'privacy-scan: allow';

// Generic placeholders and CI/system accounts, compared case-insensitively.
const HOME_PLACEHOLDERS = new Set([
  'you', 'your', 'yourname', 'your-name', 'your_name', 'user', 'username', 'user-name',
  'me', 'name', 'example', 'someone', 'runner', 'ubuntu', 'shared', 'gh-runner', 'linuxbrew',
]);
const EMAIL_ALLOWED_DOMAINS = [/(^|\.)users\.noreply\.github\.com$/i, /(^|\.)example\.(com|org|net)$/i];
const EMAIL_ALLOWED_EXACT = new Set(['noreply@anthropic.com']);
const EMAIL_ALLOWED_LOCAL = new Set(['git']); // ssh remotes like git@host

const RULES = [
  {
    id: 'home-path',
    re: /(?<![\w.-])\/(Users|home)\/([A-Za-z0-9._-]+)/g,
    ok: (m) => HOME_PLACEHOLDERS.has(m[2].toLowerCase()),
  },
  {
    id: 'email',
    re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b/g,
    ok: (m) => {
      const addr = m[0].toLowerCase();
      const [local, domain] = addr.split('@');
      return EMAIL_ALLOWED_EXACT.has(addr)
        || EMAIL_ALLOWED_LOCAL.has(local)
        || EMAIL_ALLOWED_DOMAINS.some((d) => d.test(domain));
    },
  },
  ...SECRET_RULES,
];

const files = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
  .split('\0')
  .filter((f) => f && !SKIP_PREFIXES.some((p) => f.startsWith(p)));

const findings = [];
for (const file of files) {
  let buf;
  try {
    buf = readFileSync(join(ROOT, file));
  } catch {
    continue; // tracked but deleted in the working tree
  }
  if (buf.includes(0)) continue; // binary
  const lines = buf.toString('utf8').split(/\r?\n/);
  lines.forEach((line, i) => {
    if (line.includes(ALLOW_MARK)) return;
    for (const rule of RULES) {
      for (const m of line.matchAll(rule.re)) {
        if (rule.ok?.(m)) continue;
        findings.push(`${file}:${i + 1}: ${rule.id}: ${m[0]}`);
      }
    }
  });
}

if (findings.length) {
  console.error(`privacy scan: ${findings.length} finding(s) in ${files.length} tracked files`);
  for (const f of findings) console.error(`  ${f}`);
  console.error(`Fix them, or append "${ALLOW_MARK}" to a line that is intentionally public.`);
  process.exit(1);
}
console.log(`privacy scan ok: ${files.length} tracked files`);
