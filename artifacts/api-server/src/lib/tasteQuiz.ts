/**
 * Onboarding taste quiz — pure helpers (no DB), unit-tested.
 *
 * The quiz shows 12–15 real product photos; each right/left swipe is fed into
 * the buyer's For You taste profile as a `like` / `skip` event. Ranking matches
 * style keys exactly (lowercased), so every product is mapped onto the
 * canonical style vocabulary (STYLE_TAGS in the mobile StyleTagsPicker) here,
 * from its own styleTags, tags and name — sellers rarely fill styleTags in.
 */

export const STYLE_KEYS = [
  "streetwear", "vintage", "y2k", "minimalist", "athleisure", "luxury", "cottagecore",
  "dark_academia", "coastal", "preppy", "gorpcore", "boho", "grunge", "techwear", "basics",
] as const;
export type StyleKey = (typeof STYLE_KEYS)[number];

const KEY_SET = new Set<string>(STYLE_KEYS);

/** Words (lowercase, whole-word) that place a product in a style. */
const KEYWORDS: Record<StyleKey, string[]> = {
  streetwear: ["streetwear", "street", "graphic", "hoodie", "skate", "oversized", "cargo"],
  vintage: ["vintage", "archive", "retro", "washed", "faded", "thrift", "deadstock"],
  y2k: ["y2k", "baby tee", "low rise", "butterfly", "rhinestone"],
  minimalist: ["minimal", "minimalist", "clean", "monochrome", "essential", "tailored"],
  athleisure: ["athleisure", "jogger", "legging", "track", "sport", "active", "running"],
  luxury: ["luxury", "cashmere", "silk", "leather", "couture", "atelier"],
  cottagecore: ["cottagecore", "floral", "prairie", "lace", "smock"],
  dark_academia: ["academia", "tweed", "blazer", "plaid", "oxford"],
  coastal: ["coastal", "linen", "resort", "beach", "stripe"],
  preppy: ["preppy", "polo", "cable knit", "varsity", "pleated"],
  gorpcore: ["gorpcore", "fleece", "outdoor", "trail", "hiking", "shell"],
  boho: ["boho", "crochet", "fringe", "paisley", "maxi"],
  grunge: ["grunge", "distressed", "flannel", "ripped", "band tee"],
  techwear: ["techwear", "utility", "waterproof", "tactical", "nylon"],
  basics: ["basic", "basics", "tee", "t-shirt", "tank", "blank", "everyday"],
};

/** The onboarding style picker's labels, mapped onto ranking keys. */
const PICKER_LABEL_TO_KEY: Record<string, StyleKey | null> = {
  streetwear: "streetwear",
  luxury: "luxury",
  vintage: "vintage",
  athleisure: "athleisure",
  basics: "basics",
  minimal: "minimalist",
  minimalist: "minimalist",
  "graphic tees": "streetwear",
  sneakers: "streetwear",
  denim: "vintage",
  "avant-garde": "luxury",
  accessories: null,
  "sustainable fashion": null,
};

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
const KEYWORD_RES: Array<[StyleKey, RegExp]> = (Object.entries(KEYWORDS) as Array<[StyleKey, string[]]>)
  .flatMap(([key, words]) => words.map((w) => [key, new RegExp(`(^|[^a-z0-9])${escapeRe(w)}([^a-z0-9]|$)`)] as [StyleKey, RegExp]));

export interface QuizProductInput {
  name: string;
  styleTags?: unknown;
  tags?: unknown;
  category?: string | null;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Canonical style keys for one product: explicit styleTags first (already
 * canonical when set through the picker), then keyword matches over tags,
 * name and category. At most 3, in that priority order.
 */
export function deriveStyleKeys(product: QuizProductInput): StyleKey[] {
  const out: StyleKey[] = [];
  const add = (k: string) => {
    if (KEY_SET.has(k) && !out.includes(k as StyleKey)) out.push(k as StyleKey);
  };
  for (const t of stringList(product.styleTags)) add(t.trim().toLowerCase());
  const haystack = [...stringList(product.tags), product.name, product.category ?? ""]
    .join(" · ")
    .toLowerCase();
  for (const [key, re] of KEYWORD_RES) {
    if (re.test(haystack)) add(key);
  }
  return out.slice(0, 3);
}

/** Maps the picker's labels to ranking keys, dropping ones with no style meaning. */
export function pickerLabelsToKeys(labels: string[]): StyleKey[] {
  const out: StyleKey[] = [];
  for (const label of labels) {
    const norm = label.trim().toLowerCase();
    const key = norm in PICKER_LABEL_TO_KEY ? PICKER_LABEL_TO_KEY[norm] : (KEY_SET.has(norm) ? (norm as StyleKey) : null);
    if (key && !out.includes(key)) out.push(key);
  }
  return out;
}

export interface QuizCandidate {
  id: string;
  ownerId: string;
  styleKeys: StyleKey[];
}

/**
 * Picks up to `max` candidates that spread across styles and sellers: one
 * pass per style key (round robin), at most one product per seller, then
 * fills with untagged products. Input order is treated as preference
 * (newest first). Deterministic, so the same catalog yields the same quiz.
 */
export function pickQuizProducts<T extends QuizCandidate>(candidates: T[], max = 15): T[] {
  const picked: T[] = [];
  const usedSellers = new Set<string>();
  const usedIds = new Set<string>();
  const buckets = new Map<string, T[]>();
  for (const c of candidates) {
    const key = c.styleKeys[0] ?? "_none";
    const list = buckets.get(key) ?? [];
    list.push(c);
    buckets.set(key, list);
  }
  const order = [...STYLE_KEYS, "_none"].filter((k) => buckets.has(k));
  const take = (c: T) => {
    picked.push(c);
    usedSellers.add(c.ownerId);
    usedIds.add(c.id);
  };
  let progressed = true;
  while (picked.length < max && progressed) {
    progressed = false;
    for (const key of order) {
      if (picked.length >= max) break;
      const list = buckets.get(key)!;
      const idx = list.findIndex((c) => !usedIds.has(c.id) && !usedSellers.has(c.ownerId));
      if (idx >= 0) {
        take(list[idx]);
        progressed = true;
      }
    }
  }
  // Small catalogs: allow a second product from the same seller.
  for (const c of candidates) {
    if (picked.length >= max) break;
    if (!usedIds.has(c.id)) take(c);
  }
  return picked;
}

export const QUIZ_MIN_PRODUCTS = 12;
export const QUIZ_MAX_PRODUCTS = 15;
