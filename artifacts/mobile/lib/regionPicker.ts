/**
 * State / Country picker logic (components/checkout/RegionPickerSheet.tsx),
 * kept pure so it is unit-tested:
 *  - search: "New" → New Hampshire, New Jersey, New Mexico, New York; "NY" →
 *    New York (codes match too); "US" → United States; "york" → New York;
 *  - the likely value first: the country from the device's locale, the state
 *    from the ZIP already typed (first three digits, USPS prefixes);
 *  - A–Z sections for the alphabet scrubber.
 */
import type { PickerOption } from '@/components/checkout/CheckoutPrimitives';

const norm = (value: string) => value
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Options matching `query`, best first: exact code, name starts with the
 * query, a later word starts with it, then contains it. Ties stay A–Z.
 */
export function filterRegions(options: PickerOption[], query: string): PickerOption[] {
  const q = norm(query);
  const sorted = sortRegions(options);
  if (!q) return sorted;
  const scored: Array<{ option: PickerOption; score: number }> = [];
  for (const option of sorted) {
    const name = norm(option.label);
    const code = norm(option.value);
    let score = -1;
    if (code === q) score = 0;
    else if (name.startsWith(q)) score = 1;
    else if (name.split(' ').some(word => word.startsWith(q))) score = 2;
    else if (name.includes(q)) score = 3;
    if (score >= 0) scored.push({ option, score });
  }
  return scored.sort((a, b) => a.score - b.score).map(entry => entry.option);
}

/** A–Z by name (the region lists aren't stored alphabetically). */
export function sortRegions(options: PickerOption[]): PickerOption[] {
  return [...options].sort((a, b) => a.label.localeCompare(b.label, 'en'));
}

/** Letters that start at least one option, for the scrubber. */
export function regionLetters(options: PickerOption[]): string[] {
  return [...new Set(sortRegions(options).map(option => option.label.charAt(0).toUpperCase()))];
}

/** Index of the first option starting with `letter` (in A–Z order), or -1. */
export function firstIndexForLetter(sorted: PickerOption[], letter: string): number {
  return sorted.findIndex(option => option.label.charAt(0).toUpperCase() === letter.toUpperCase());
}

// ─── Likely values ────────────────────────────────────────────────────────────

/**
 * USPS 3-digit ZIP prefixes → state. Instant and offline; only used to put
 * the likely state first and as a hint until the server lookup
 * (GET /api/geo/postal) fills City and State.
 */
const ZIP3_RANGES: Array<[number, number, string]> = [
  [5, 5, 'NY'], [6, 7, 'PR'], [8, 8, 'VI'], [9, 9, 'PR'],
  [10, 27, 'MA'], [28, 29, 'RI'], [30, 38, 'NH'], [39, 49, 'ME'], [50, 54, 'VT'], [55, 55, 'MA'], [56, 59, 'VT'],
  [60, 69, 'CT'], [70, 89, 'NJ'],
  [100, 149, 'NY'], [150, 196, 'PA'], [197, 199, 'DE'],
  [200, 200, 'DC'], [201, 201, 'VA'], [202, 205, 'DC'], [206, 219, 'MD'], [220, 246, 'VA'], [247, 268, 'WV'],
  [270, 289, 'NC'], [290, 299, 'SC'], [300, 319, 'GA'], [320, 339, 'FL'], [341, 349, 'FL'],
  [350, 369, 'AL'], [370, 385, 'TN'], [386, 397, 'MS'], [398, 399, 'GA'],
  [400, 427, 'KY'], [430, 459, 'OH'], [460, 479, 'IN'], [480, 499, 'MI'],
  [500, 528, 'IA'], [530, 549, 'WI'], [550, 567, 'MN'], [569, 569, 'DC'], [570, 577, 'SD'], [580, 588, 'ND'], [590, 599, 'MT'],
  [600, 629, 'IL'], [630, 658, 'MO'], [660, 679, 'KS'], [680, 693, 'NE'],
  [700, 714, 'LA'], [716, 729, 'AR'], [730, 732, 'OK'], [733, 733, 'TX'], [734, 749, 'OK'], [750, 799, 'TX'],
  [800, 816, 'CO'], [820, 831, 'WY'], [832, 838, 'ID'], [840, 847, 'UT'], [850, 865, 'AZ'], [870, 884, 'NM'],
  [885, 885, 'TX'], [889, 898, 'NV'], [900, 961, 'CA'], [967, 968, 'HI'],
  [970, 979, 'OR'], [980, 994, 'WA'], [995, 999, 'AK'],
];

/** "10012" → "NY". Null for anything that isn't a known US ZIP prefix. */
export function usStateForZip(zip: string | null | undefined): string | null {
  const digits = (zip ?? '').trim();
  if (!/^\d{3}/.test(digits)) return null;
  const prefix = Number(digits.slice(0, 3));
  return ZIP3_RANGES.find(([from, to]) => prefix >= from && prefix <= to)?.[2] ?? null;
}

/** The country in the device's locale ("en-US" → "US"), or null. */
export function deviceCountry(locale?: string): string | null {
  let tag = locale;
  if (!tag) {
    try { tag = Intl.DateTimeFormat().resolvedOptions().locale; } catch { tag = undefined; }
  }
  const region = tag?.split(/[-_]/).slice(1).find(part => /^[A-Za-z]{2}$/.test(part));
  return region ? region.toUpperCase() : null;
}

/** The likely option to show above the list, if it is in `options`. */
export function suggestedRegion(options: PickerOption[], value: string | null | undefined): PickerOption | null {
  if (!value) return null;
  return options.find(option => option.value === value.toUpperCase()) ?? null;
}
