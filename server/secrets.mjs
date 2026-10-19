import { BoardError } from './errors.mjs';

// Secret patterns used by the feed and by the release privacy scan.
// Email and home paths stay in the release scanner only; feed rejects tokens and private keys.

export const SECRET_RULES = Object.freeze([
  { id: 'private-key', re: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/g },
  { id: 'github-token', re: /\bgh[pousr]_[A-Za-z0-9]{20,}/g },
  { id: 'github-fine-grained-token', re: /\bgithub_pat_[A-Za-z0-9_]{20,}/g },
  { id: 'gitlab-token', re: /\bglpat-[A-Za-z0-9_-]{20,}/g },
  { id: 'aws-access-key', re: /\bAKIA[0-9A-Z]{16}\b/g },
]);

export function findSecrets(text) {
  if (typeof text !== 'string' || !text) return [];
  const hits = [];
  for (const rule of SECRET_RULES) {
    for (const match of text.matchAll(rule.re)) hits.push({ id: rule.id, match: match[0] });
  }
  return hits;
}

export function assertNoSecrets(text, where = 'value') {
  const hits = findSecrets(text);
  if (hits.length) throw new BoardError(400, 'secret', `${where} looks like a secret (${hits[0].id})`);
}
