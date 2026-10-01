/**
 * Normalized shopping-category taxonomy for buyer discovery.
 *
 * `products.category` is free text (default 'apparel') and tags are
 * seller-authored, so the same garment shows up as "Hoodie", "hoodies",
 * "Zip Sweatshirt" or only in the product name. This maps those inputs to a
 * small, stable set of slugs the buyer app can browse by. Pure and
 * dependency-free so it is unit-testable without a database.
 *
 * Resolution order: the category field first (the seller's explicit choice),
 * then the product name, then tags. Inside a field, rules are checked in the
 * order of CATEGORY_DEFS, so more specific garments win ("denim jacket" is a
 * jacket, "jeans" is denim).
 */

export interface CategoryDef {
  slug: string;
  label: string;
  /** Lowercase words/phrases; matched on word boundaries, plural-tolerant. */
  keywords: string[];
}

export const CATEGORY_DEFS: CategoryDef[] = [
  { slug: "hoodies", label: "Hoodies", keywords: ["hoodie", "hoody", "hooded sweatshirt", "zip up", "zip-up", "crewneck", "sweatshirt"] },
  { slug: "tees", label: "Tees", keywords: ["tee", "t-shirt", "t shirt", "tshirt", "tank", "tank top", "singlet", "shirt", "polo", "long sleeve", "longsleeve"] },
  { slug: "jackets", label: "Jackets", keywords: ["jacket", "coat", "parka", "bomber", "windbreaker", "puffer", "blazer", "anorak", "trench", "varsity", "outerwear", "fleece", "vest", "gilet"] },
  { slug: "denim", label: "Denim", keywords: ["denim", "jean", "jeans"] },
  { slug: "knitwear", label: "Knitwear", keywords: ["knit", "knitwear", "sweater", "jumper", "cardigan", "knitted"] },
  { slug: "pants", label: "Pants", keywords: ["pant", "pants", "trouser", "trousers", "cargo", "cargos", "jogger", "joggers", "sweatpant", "sweatpants", "chino", "chinos", "leggings", "legging", "track pant", "track pants"] },
  { slug: "shorts", label: "Shorts", keywords: ["short", "shorts", "swim trunks", "trunks"] },
  { slug: "dresses", label: "Dresses", keywords: ["dress", "gown", "skirt", "jumpsuit", "romper"] },
  { slug: "footwear", label: "Footwear", keywords: ["shoe", "shoes", "sneaker", "sneakers", "boot", "boots", "sandal", "sandals", "slide", "slides", "loafer", "loafers", "footwear", "trainer", "trainers", "heel", "heels", "clog", "clogs"] },
  { slug: "accessories", label: "Accessories", keywords: ["accessory", "accessories", "hat", "cap", "beanie", "bag", "tote", "backpack", "belt", "scarf", "glove", "gloves", "sock", "socks", "sunglasses", "jewelry", "jewellery", "necklace", "ring", "bracelet", "wallet", "keychain", "headwear", "bandana", "watch"] },
];

export const CATEGORY_SLUGS = CATEGORY_DEFS.map((c) => c.slug);

export function isCategorySlug(value: string): boolean {
  return CATEGORY_SLUGS.includes(value);
}

export function categoryLabel(slug: string): string | null {
  return CATEGORY_DEFS.find((c) => c.slug === slug)?.label ?? null;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// One regex per definition, built once. Keywords match whole words and
// tolerate a trailing "s"/"es" so "hoodies"/"tees" resolve without listing
// every plural.
const DEF_MATCHERS: Array<{ slug: string; re: RegExp }> = CATEGORY_DEFS.map((def) => ({
  slug: def.slug,
  re: new RegExp(
    `(?:^|[^a-z0-9])(?:${def.keywords.map(escapeRegExp).join("|")})(?:s|es)?(?=$|[^a-z0-9])`,
    "i",
  ),
}));

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.toLowerCase().replace(/[_/]+/g, " ").trim() : "";
}

function matchText(text: string): string | null {
  if (!text) return null;
  for (const { slug, re } of DEF_MATCHERS) if (re.test(text)) return slug;
  return null;
}

/**
 * The primary taxonomy slug for one product, or null when nothing in its
 * category, name or tags maps to a known category (e.g. the untouched
 * default category 'apparel' with a name like "Logo piece").
 */
export function classifyProduct(input: {
  category?: unknown;
  name?: unknown;
  tags?: unknown;
  styleTags?: unknown;
}): string | null {
  const fromCategory = matchText(normalizeText(input.category));
  if (fromCategory) return fromCategory;
  const fromName = matchText(normalizeText(input.name));
  if (fromName) return fromName;
  const tags = [
    ...(Array.isArray(input.tags) ? input.tags : []),
    ...(Array.isArray(input.styleTags) ? input.styleTags : []),
  ];
  for (const tag of tags) {
    const slug = matchText(normalizeText(tag));
    if (slug) return slug;
  }
  return null;
}

export interface CategorySummary {
  slug: string;
  label: string;
  productCount: number;
  coverImageUrl: string | null;
}

/**
 * Builds the category list (only categories that have at least one product,
 * biggest first, ties by taxonomy order) from already-classified products.
 * `products` must be ordered newest-first so the cover is the newest product
 * that has an image.
 */
export function summarizeCategories(
  products: Array<{ slug: string | null; images: unknown }>,
): CategorySummary[] {
  const acc = new Map<string, CategorySummary>();
  for (const p of products) {
    if (!p.slug) continue;
    const label = categoryLabel(p.slug);
    if (!label) continue;
    let entry = acc.get(p.slug);
    if (!entry) {
      entry = { slug: p.slug, label, productCount: 0, coverImageUrl: null };
      acc.set(p.slug, entry);
    }
    entry.productCount += 1;
    if (!entry.coverImageUrl && Array.isArray(p.images)) {
      const first = p.images.find((i): i is string => typeof i === "string" && i.length > 0);
      if (first) entry.coverImageUrl = first;
    }
  }
  return [...acc.values()].sort((a, b) =>
    b.productCount - a.productCount || CATEGORY_SLUGS.indexOf(a.slug) - CATEGORY_SLUGS.indexOf(b.slug));
}
