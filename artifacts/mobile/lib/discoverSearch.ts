/**
 * Pure helpers for the Discover in-place search overlay
 * (components/discover/search). No react-native imports so they stay
 * unit-testable.
 */

export const RECENT_CAP = 10;

const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

/** Put `term` first, drop any case/spacing duplicate of it, cap the list. */
export function mergeRecent(list: readonly string[], term: string, cap = RECENT_CAP): string[] {
  const t = term.trim().replace(/\s+/g, ' ');
  if (!t) return list.slice(0, cap);
  const key = norm(t);
  return [t, ...list.filter((x) => norm(x) !== key)].slice(0, cap);
}

/** Remove `term` (case/spacing-insensitive). */
export function removeRecent(list: readonly string[], term: string): string[] {
  const key = norm(term);
  return list.filter((x) => norm(x) !== key);
}

/** Dedupe a server list the same way mergeRecent does, keeping order. */
export function dedupeRecent(list: readonly string[], cap = RECENT_CAP): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const t = raw.trim();
    const key = norm(t);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(t);
    if (out.length >= cap) break;
  }
  return out;
}

export interface HighlightPart { text: string; match: boolean }

/** Split `text` around the first case-insensitive occurrence of `query`. */
export function highlightParts(text: string, query: string): HighlightPart[] {
  const q = query.trim();
  if (!q) return [{ text, match: false }];
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return [{ text, match: false }];
  return [
    { text: text.slice(0, idx), match: false },
    { text: text.slice(idx, idx + q.length), match: true },
    { text: text.slice(idx + q.length), match: false },
  ].filter((p) => p.text.length > 0);
}

export interface SuggestionGroups<B, P, R, T> {
  brands: B[];
  people: P[];
  products: R[];
  hashtags: T[];
}

/** Per-group caps for the live suggestion list (keeps it one screen tall). */
export const SUGGESTION_CAPS = { brands: 3, people: 3, products: 3, hashtags: 3 } as const;

export function capSuggestions<B, P, R, T>(g: SuggestionGroups<B, P, R, T>): SuggestionGroups<B, P, R, T> {
  return {
    brands: g.brands.slice(0, SUGGESTION_CAPS.brands),
    people: g.people.slice(0, SUGGESTION_CAPS.people),
    products: g.products.slice(0, SUGGESTION_CAPS.products),
    hashtags: g.hashtags.slice(0, SUGGESTION_CAPS.hashtags),
  };
}

/** People suggestions exclude seller accounts already shown as brands. */
export function dedupePeopleAgainstBrands<P extends { userId: string }>(people: P[], brandSellerIds: ReadonlySet<string>): P[] {
  return people.filter((p) => !brandSellerIds.has(p.userId));
}

/** Fits = posts by buyer accounts. Unknown author type is not a Fit. */
export function isFitAuthor(accountType: string | null | undefined): boolean {
  return accountType === 'buyer';
}

export type SearchResultTab = 'top' | 'brands' | 'people' | 'products' | 'fits';

export const SEARCH_RESULT_TABS: Array<{ key: SearchResultTab; label: string }> = [
  { key: 'top', label: 'Top' },
  { key: 'brands', label: 'Brands' },
  { key: 'people', label: 'People' },
  { key: 'products', label: 'Products' },
  { key: 'fits', label: 'Fits' },
];

/** Interleave two photo lists for the Top grid: a, b, a, b, ... then the rest. */
export function interleave<A, B>(a: A[], b: B[]): Array<A | B> {
  const out: Array<A | B> = [];
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i += 1) {
    if (i < a.length) out.push(a[i]);
    if (i < b.length) out.push(b[i]);
  }
  return out;
}

/** Split a flat list into rows of `cols` (the 2-column trending list). */
export function toColumnsRowMajor<T>(items: T[], cols = 2): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += cols) rows.push(items.slice(i, i + cols));
  return rows;
}
