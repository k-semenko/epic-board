export const DEFAULT_SECTION_ORDER = Object.freeze(['waiting', 'map', 'branches', 'sessions', 'decisions', 'history']);

export function normalizeSectionOrder(value) {
  const known = Array.isArray(value) ? value.filter((id) => DEFAULT_SECTION_ORDER.includes(id)) : [];
  return [...new Set([...known, ...DEFAULT_SECTION_ORDER])];
}

export function moveSection(order, id, index) {
  const next = [...order];
  const from = next.indexOf(id);
  if (from === -1) return next;
  next.splice(from, 1);
  next.splice(Math.max(0, Math.min(index, next.length)), 0, id);
  return next;
}
