/**
 * "Complete the fit" rules — pure so they're unit-testable without a database.
 */

export const MAX_PRODUCT_PAIRINGS = 6;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export type PairingInputResult =
  | { ok: true; ids: string[] }
  | { ok: false; status: 400; error: string; code: string };

/** Shape-level validation of a PUT body: ordered, unique, ≤ cap, no self-pair. */
export function parsePairingInput(productId: string, raw: unknown): PairingInputResult {
  if (!Array.isArray(raw)) {
    return { ok: false, status: 400, error: "pairedProductIds must be an array", code: "invalid_body" };
  }
  if (!raw.every(isUuid)) {
    return { ok: false, status: 400, error: "pairedProductIds must be product ids", code: "invalid_body" };
  }
  const ids = raw.map((id) => id.toLowerCase());
  if (new Set(ids).size !== ids.length) {
    return { ok: false, status: 400, error: "A product can only be paired once", code: "duplicate_pairing" };
  }
  if (ids.includes(productId.toLowerCase())) {
    return { ok: false, status: 400, error: "A product can't be paired with itself", code: "self_pairing" };
  }
  if (ids.length > MAX_PRODUCT_PAIRINGS) {
    return {
      ok: false,
      status: 400,
      error: `You can pair up to ${MAX_PRODUCT_PAIRINGS} products`,
      code: "pairing_cap",
    };
  }
  return { ok: true, ids };
}

/** Lowest variant price in cents (0 when a product has no variants). */
export function lowestPriceCents(variants: Array<{ priceCents: number | null }>): number {
  const prices = variants.map((v) => v.priceCents ?? 0);
  return prices.length ? Math.min(...prices) : 0;
}

/** Sellable now: any variant with stock, or a pre-order listing. */
export function isAvailable(variants: Array<{ stock: number | null }>, isPreOrder: boolean): boolean {
  return isPreOrder || variants.some((v) => (v.stock ?? 0) > 0);
}

// ── Automatic same-brand fallback ────────────────────────────────────────────
// Most sellers never curate pairings, so the public rail tops itself up with
// the same seller's products from complementary categories (a top gets
// bottoms, outerwear, shoes and accessories), like Zara/COS "Complete your
// look". Curated pairings always come first and are never filtered.

/** Total items the public rail shows; auto items only fill up to this. */
export const COMPLETE_THE_FIT_TARGET = 8;

export type OutfitGroup = "top" | "bottom" | "outerwear" | "onepiece" | "footwear" | "accessory";

/** Taxonomy slug (lib/categoryTaxonomy.ts) → outfit slot. */
const GROUP_BY_SLUG: Record<string, OutfitGroup> = {
  hoodies: "top",
  tees: "top",
  knitwear: "top",
  denim: "bottom",
  pants: "bottom",
  shorts: "bottom",
  jackets: "outerwear",
  dresses: "onepiece",
  footwear: "footwear",
  accessories: "accessory",
};

/** What finishes an outfit for each slot, in display order. */
const COMPLEMENTS: Record<OutfitGroup, OutfitGroup[]> = {
  top: ["bottom", "outerwear", "footwear", "accessory"],
  bottom: ["top", "outerwear", "footwear", "accessory"],
  outerwear: ["top", "bottom", "footwear", "accessory"],
  onepiece: ["outerwear", "footwear", "accessory"],
  footwear: ["top", "bottom", "outerwear", "onepiece", "accessory"],
  accessory: ["top", "bottom", "outerwear", "onepiece", "footwear"],
};

export function outfitGroup(slug: string | null): OutfitGroup | null {
  return slug ? GROUP_BY_SLUG[slug] ?? null : null;
}

export function complementaryGroups(group: OutfitGroup | null): OutfitGroup[] {
  return group ? COMPLEMENTS[group] : [];
}

export interface AutoPairingCandidate {
  id: string;
  /** Taxonomy slug from classifyProduct, or null when unclassifiable. */
  slug: string | null;
  available: boolean;
  createdAt: Date;
}

/**
 * Picks the automatic "Complete the fit" items. Same seller is the caller's
 * job (the query is owner-scoped). Rules: never the current product or an
 * already-curated one, never sold out, never the current product's own
 * outfit slot, and nothing when the current product can't be classified
 * (we can't say what completes it). Interleaves the complementary slots in
 * order — one bottom, one jacket, one shoe, one accessory, then again — with
 * newest first inside each slot so the row reads as an outfit, not a list of
 * jeans.
 */
export function selectAutoPairings<T extends AutoPairingCandidate>(
  current: { id: string; slug: string | null },
  candidates: T[],
  opts: { excludeIds?: Iterable<string>; limit: number },
): T[] {
  if (opts.limit <= 0) return [];
  const groups = complementaryGroups(outfitGroup(current.slug));
  if (groups.length === 0) return [];
  const exclude = new Set([current.id, ...(opts.excludeIds ?? [])]);

  const buckets = new Map<OutfitGroup, T[]>(groups.map((g) => [g, []]));
  for (const c of candidates) {
    if (exclude.has(c.id) || !c.available) continue;
    const group = outfitGroup(c.slug);
    if (!group) continue;
    buckets.get(group)?.push(c);
  }
  for (const list of buckets.values()) {
    list.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || a.id.localeCompare(b.id));
  }

  const picked: T[] = [];
  for (let round = 0; picked.length < opts.limit; round++) {
    let any = false;
    for (const g of groups) {
      const c = buckets.get(g)![round];
      if (!c) continue;
      any = true;
      picked.push(c);
      if (picked.length >= opts.limit) break;
    }
    if (!any) break;
  }
  return picked;
}
