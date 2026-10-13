/**
 * Live price typing (less-AI pass, item 103). The reference is Depop's
 * "Sell an item" price field: a "$" prefix, a "0.00" placeholder, and the
 * number grouped as you type. Screens keep storing the raw string (no
 * commas) and parse it the way they already do (parseFloat /
 * parseDecimalToCents); only what's on screen is grouped.
 */

/** Keeps digits and one decimal point, at most 2 decimals, no leading zeros
 *  ("007" -> "7", "0.5" stays). Pasted "$1,250.00" becomes "1250.00". */
export function sanitizePriceInput(text: string): string {
  let out = '';
  let seenDot = false;
  let decimals = 0;
  for (const ch of text) {
    if (ch >= '0' && ch <= '9') {
      if (seenDot) {
        if (decimals >= 2) continue;
        decimals += 1;
      }
      out += ch;
    } else if (ch === '.' && !seenDot) {
      seenDot = true;
      out += out === '' ? '0.' : '.';
    }
  }
  const [whole, frac] = out.split('.');
  const trimmed = whole.replace(/^0+(?=\d)/, '');
  return frac === undefined ? trimmed : `${trimmed}.${frac}`;
}

/** Groups the whole part with commas for display: "1250.5" -> "1,250.5". */
export function displayPriceInput(raw: string): string {
  if (!raw) return '';
  const [whole, frac] = raw.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return frac === undefined ? grouped : `${grouped}.${frac}`;
}

/** On blur: pads to two decimals ("12" -> "12.00", "12.5" -> "12.50").
 *  An empty field stays empty. */
export function finishPriceInput(raw: string): string {
  if (!raw) return '';
  const [whole, frac = ''] = raw.split('.');
  return `${whole || '0'}.${frac.padEnd(2, '0')}`;
}
