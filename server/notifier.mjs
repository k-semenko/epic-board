import { feedRev, listFeedItems } from './feed.mjs';
import { readSettings } from './settings.mjs';
import { playSound, showBanner } from './sounds.mjs';
import { DICT } from './page/i18n.mjs';

export const NOTIFY_LEVELS = Object.freeze(['normal', 'important', 'fire']);
const rank = (level) => NOTIFY_LEVELS.indexOf(level);

const levelOf = (item) => (item.severity === 'fire' ? 'fire' : item.severity === 'important' ? 'important' : 'normal');
const fingerprint = (item) => `${item.updatedAt}|${item.count}|${item.changedSinceMark ? 1 : 0}`;
const unseen = (item) => !item.mark || item.changedSinceMark;

const minutes = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

// "22:00-08:00" wraps past midnight; an empty value means never quiet.
export function inQuietHours(range, date = new Date()) {
  const match = /^(\d{2}:\d{2})-(\d{2}:\d{2})$/.exec(range || '');
  if (!match) return false;
  const now = date.getHours() * 60 + date.getMinutes();
  const [from, to] = [minutes(match[1]), minutes(match[2])];
  return from <= to ? now >= from && now < to : now >= from || now < to;
}

function bannerText(level, items, lang) {
  const dict = DICT[lang] || DICT.en;
  const t = (key, vars = {}) => String(dict[key] || DICT.en[key] || key).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
  const top = items.find((item) => levelOf(item) === level) || items[0];
  const more = items.length > 1 ? ` ${t('notify.more', { n: items.length - 1 })}` : '';
  return { title: t(`notify.title.${level}`), body: `${top.title}${more}` };
}

/**
 * Watches the feed and sounds once per batch: items written close together (any connector, CLI or HTTP)
 * are gathered until `quietMs` pass without changes, then the most severe unseen item picks the sound.
 */
export function createNotifier({
  readRev = feedRev,
  readItems = () => listFeedItems(),
  settings = readSettings,
  play = playSound,
  banner = showBanner,
  now = () => Date.now(),
  quietMs = 10_000,
  lang = Intl.DateTimeFormat().resolvedOptions().locale.startsWith('ru') ? 'ru' : 'en',
} = {}) {
  let rev = null;
  const seen = new Map();
  const batch = new Map();
  let lastChange = 0;

  function flush() {
    const items = [...batch.values()];
    batch.clear();
    if (!items.length) return null;
    const s = settings();
    if (!s['feed.notify.enabled'] || inQuietHours(s['feed.notify.quietHours'], new Date(now()))) return null;
    const level = items.map(levelOf).reduce((a, b) => (rank(b) > rank(a) ? b : a), 'normal');
    if (rank(level) < rank(s['feed.notify.minLevel'] || 'normal')) return null;
    const sound = s[`feed.notify.sound.${level}`];
    if (sound && sound !== 'none') play(sound, { volume: s['feed.notify.volume'] });
    if (s['feed.notify.banner']) {
      const { title, body } = bannerText(level, items, lang);
      banner(title, body);
    }
    return { level, count: items.length };
  }

  function tick() {
    const current = readRev();
    if (current !== rev) {
      const items = readItems();
      const first = rev === null;
      const live = new Set();
      for (const item of items) {
        live.add(item.id);
        const print = fingerprint(item);
        // The first look only learns what is already there: a restart must not replay old items.
        if (!first && seen.get(item.id) !== print && unseen(item)) batch.set(item.id, item);
        seen.set(item.id, print);
      }
      for (const id of seen.keys()) if (!live.has(id)) seen.delete(id);
      for (const id of batch.keys()) if (!live.has(id) || !unseen(items.find((x) => x.id === id))) batch.delete(id);
      rev = current;
      lastChange = now();
    }
    if (batch.size && now() - lastChange >= quietMs) return flush();
    return null;
  }

  return { tick, flush, pending: () => batch.size };
}
