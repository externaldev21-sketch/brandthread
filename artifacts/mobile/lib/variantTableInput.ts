/**
 * Input helpers for the variant table's inline Price and Stock cells.
 * Sanitizers run on every keystroke (they only strip what can't be part of
 * the value); parsers turn the final text into a number or null.
 */

/** Digits and one decimal point, at most 2 decimals. "$45.999" → "45.99". */
export function sanitizePriceInput(text: string): string {
  const cleaned = text.replace(/[^0-9.]/g, '');
  const dot = cleaned.indexOf('.');
  if (dot === -1) return cleaned;
  const whole = cleaned.slice(0, dot);
  const decimals = cleaned.slice(dot + 1).replace(/\./g, '').slice(0, 2);
  return `${whole}.${decimals}`;
}

/** Whole numbers only, at most 6 digits. "1,200 pcs" → "1200". */
export function sanitizeStockInput(text: string): string {
  return text.replace(/[^0-9]/g, '').slice(0, 6);
}

/** Price text → cents, or null when empty / not a positive amount. */
export function parsePriceCents(text: string): number | null {
  const clean = sanitizePriceInput(text);
  if (!clean || clean === '.') return null;
  const n = Number(clean);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
}

/** Stock text → whole number, or null when empty. */
export function parseStock(text: string): number | null {
  const clean = sanitizeStockInput(text);
  return clean === '' ? null : Number(clean);
}
