export function text(value, max = 500) {
  return String(value ?? '').trim().slice(0, max);
}

export function integer(value, fallback = 0) {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function decimal(value, fallback = 0) {
  const parsed = Number.parseFloat(String(value).replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function cleanRut(value) {
  return String(value ?? '').replace(/[^0-9kK]/g, '').toUpperCase().slice(0, 9);
}

export function formatRut(value) {
  const clean = cleanRut(value);
  if (clean.length < 2) return clean;
  const body = clean.slice(0, -1).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${body}-${clean.slice(-1)}`;
}

export function validRut(value) {
  const clean = cleanRut(value);
  if (clean.length < 8) return false;
  const body = clean.slice(0, -1);
  if (!/^\d+$/.test(body)) return false;
  let sum = 0;
  let multiplier = 2;
  for (let index = body.length - 1; index >= 0; index -= 1) {
    sum += Number(body[index]) * multiplier;
    multiplier = multiplier === 7 ? 2 : multiplier + 1;
  }
  const result = 11 - (sum % 11);
  const expected = result === 11 ? '0' : result === 10 ? 'K' : String(result);
  return clean.slice(-1) === expected;
}

export function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value ?? '').trim());
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function nextId(items) {
  return items.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1;
}

export function normalizeTags(value) {
  const input = Array.isArray(value) ? value : String(value ?? '').split(',');
  return [...new Set(input.map((item) => text(item, 40)).filter(Boolean))];
}
