/**
 * Ranking + category-chip rules for the unified search endpoint
 * (GET /api/public/search/all — routes/search-unified.ts).
 *
 * Every match is put in a tier before anything else is compared, so a
 * title that starts with the query always beats one that merely contains it,
 * however popular the second one is:
 *
 *   0 EXACT        the whole field equals the query ("Vintage Tee" = "vintage tee")
 *   1 PREFIX       the field starts with the query ("vint" → "Vintage Tee")
 *   2 WORD         a later word starts with the query ("tee" → "Vintage Tee")
 *   3 CONTAINS     the query is inside a word ("tag" → "Vintage Tee")
 *   4 FUZZY        trigram near-miss only ("vintge" → "Vintage Tee")
 *
 * Secondary fields (product descriptions, post captions' body text) never
 * rank above WORD: a product called "Hoodie" beats one that only mentions
 * hoodies in its description.
 *
 * `matchTier` (JS) and `matchTierSql` (Postgres) implement the same rules;
 * the SQL one drives ORDER BY + pagination, the JS one is what the unit tests
 * pin and what the "Top" section uses to interleave the per-type lists.
 */
import { sql, type SQL } from "drizzle-orm";

export const TIER = { EXACT: 0, PREFIX: 1, WORD: 2, CONTAINS: 3, FUZZY: 4 } as const;
export type Tier = (typeof TIER)[keyof typeof TIER];

/** Word boundary = anything that is not a letter or digit (space, '-', '#', '@', '.'). */
const WORD_CHAR = /[\p{L}\p{N}]/u;

export function matchTier(field: string | null | undefined, term: string): Tier {
  const f = (field ?? "").toLowerCase();
  const t = term.toLowerCase().trim();
  if (!t || !f) return TIER.FUZZY;
  if (f === t) return TIER.EXACT;
  if (f.startsWith(t)) return TIER.PREFIX;
  let idx = f.indexOf(t);
  if (idx === -1) return TIER.FUZZY;
  while (idx !== -1) {
    if (!WORD_CHAR.test(f[idx - 1] ?? "")) return TIER.WORD;
    idx = f.indexOf(t, idx + 1);
  }
  return TIER.CONTAINS;
}

/** Secondary fields (descriptions, captions) are capped at WORD. */
export function secondaryTier(tier: Tier): Tier {
  return Math.max(tier, TIER.WORD) as Tier;
}

/** Best tier across a row's primary + secondary fields. */
export function bestTier(primary: Array<string | null | undefined>, secondary: Array<string | null | undefined>, term: string): Tier {
  let best: Tier = TIER.FUZZY;
  for (const f of primary) best = Math.min(best, matchTier(f, term)) as Tier;
  for (const f of secondary) best = Math.min(best, secondaryTier(matchTier(f, term))) as Tier;
  return best;
}

/**
 * One comparable score for interleaving different result types in "Top".
 * Tier dominates (each tier is worth more than any popularity bonus), then
 * trigram similarity, then a log-damped popularity signal (followers, likes).
 */
export function rankScore(tier: Tier, similarity = 0, popularity = 0): number {
  const sim = Math.min(Math.max(similarity, 0), 1);
  const pop = Math.min(Math.log10(1 + Math.max(popularity, 0)) / 10, 0.5);
  return (TIER.FUZZY - tier) * 10 + sim + pop;
}

/**
 * Section order for the "Top" overview: the type holding the best-tier match
 * goes first. Scores aren't comparable across types (a product's trigram
 * similarity vs. a person's follower count), so equal tiers fall back to the
 * buying-intent order products > brands > people > posts.
 */
export const SECTION_PRIORITY = ["products", "brands", "people", "posts"] as const;
export type SectionKey = (typeof SECTION_PRIORITY)[number];

export function orderSections(sections: Partial<Record<SectionKey, { items: Array<{ tier: number }> }>>): SectionKey[] {
  return SECTION_PRIORITY
    .filter((k) => (sections[k]?.items.length ?? 0) > 0)
    .map((k, i) => ({ k, i, best: Math.min(...sections[k]!.items.map((it) => it.tier)) }))
    .sort((a, b) => a.best - b.best || a.i - b.i)
    .map((s) => s.k);
}

// ─── SQL twins ────────────────────────────────────────────────────────────────

function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Postgres ARE escape — the term is matched literally inside the regex. */
export function escapeRegex(term: string): string {
  return term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** SQL CASE returning the same tier `matchTier` would for `column`. */
export function matchTierSql(column: SQL | unknown, term: string): SQL<number> {
  const lower = term.toLowerCase();
  const like = escapeLike(term);
  const wordRe = `(^|[^[:alnum:]])${escapeRegex(lower)}`;
  return sql<number>`(CASE
    WHEN lower(COALESCE(${column}, '')) = ${lower} THEN 0
    WHEN COALESCE(${column}, '') ILIKE ${like + "%"} THEN 1
    WHEN lower(COALESCE(${column}, '')) ~ ${wordRe} THEN 2
    WHEN COALESCE(${column}, '') ILIKE ${"%" + like + "%"} THEN 3
    ELSE 4 END)`;
}

/** SQL twin of `secondaryTier(matchTier(...))`. */
export function secondaryTierSql(column: SQL | unknown, term: string): SQL<number> {
  return sql<number>`GREATEST(${matchTierSql(column, term)}, 2)`;
}

// ─── Category chips ───────────────────────────────────────────────────────────

/**
 * Chips shown under the search bar. Style chips mirror the mobile app's
 * STYLE_TAGS vocabulary (components/StyleTagsPicker.tsx) — the same keys
 * sellers save into products.style_tags. `accessories` is the one product
 * category in the list; it matches the taxonomy keywords in
 * lib/categoryTaxonomy.ts instead of a style tag.
 */
export const SEARCH_STYLE_KEYS = [
  "streetwear", "vintage", "y2k", "minimalist", "athleisure", "luxury",
  "cottagecore", "dark_academia", "coastal", "preppy", "gorpcore", "boho",
  "grunge", "techwear", "basics",
] as const;
export const SEARCH_CATEGORY_CHIP_KEYS = ["accessories"] as const;
export type SearchChipKey = (typeof SEARCH_STYLE_KEYS)[number] | (typeof SEARCH_CATEGORY_CHIP_KEYS)[number];

export function isSearchChipKey(value: string): value is SearchChipKey {
  return (SEARCH_STYLE_KEYS as readonly string[]).includes(value)
    || (SEARCH_CATEGORY_CHIP_KEYS as readonly string[]).includes(value);
}

/**
 * Free-text spellings a seller might have typed into products.tags for a
 * style key ("dark_academia" → "dark academia", "darkacademia").
 */
export function styleTagSpellings(key: string): string[] {
  const spaced = key.replace(/_/g, " ");
  return [...new Set([key, spaced, key.replace(/_/g, ""), spaced.replace(/ /g, "-")])];
}
