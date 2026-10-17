/**
 * "Improve Store" AI suggestions.
 *
 * The model is given a compact summary of the seller's real storefront and
 * catalog and must answer with structured suggestions. Each suggestion has an
 * action the app can really perform:
 *   - set_store_name / set_seo_title / set_seo_description /
 *     set_hero_heading / set_hero_description: a concrete new text value the
 *     app saves through PUT /api/store;
 *   - open_screen: no automatic change — the app sends the seller to the
 *     screen where they can make it (collections, pages, navigation, ...).
 * Anything malformed is dropped; nothing is invented on the server.
 */

export const SUGGESTION_CATEGORIES = [
  "layout", "branding", "conversion", "mobile", "product",
  "copy", "navigation", "accessibility", "performance",
] as const;
export type SuggestionCategory = typeof SUGGESTION_CATEGORIES[number];

export const VALUE_ACTIONS = [
  "set_store_name", "set_seo_title", "set_seo_description",
  "set_hero_heading", "set_hero_description",
] as const;
export type ValueAction = typeof VALUE_ACTIONS[number];

export const SUGGESTION_SCREENS = [
  "collections", "pages", "navigation", "products", "sections",
  "policies", "seo", "theme", "settings",
] as const;
export type SuggestionScreen = typeof SUGGESTION_SCREENS[number];

export type SuggestionAction =
  | { type: ValueAction; value: string }
  | { type: "open_screen"; screen: SuggestionScreen };

export interface StoreSuggestion {
  id: string;
  category: SuggestionCategory;
  title: string;
  problem: string;
  recommendation: string;
  action: SuggestionAction;
}

const VALUE_LIMITS: Record<ValueAction, number> = {
  set_store_name: 60,
  set_seo_title: 70,
  set_seo_description: 160,
  set_hero_heading: 80,
  set_hero_description: 200,
};

export const MAX_SUGGESTIONS = 5;

function clean(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  // Collapse whitespace and strip control characters / markup brackets.
  return v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
}

export function parseSuggestionAction(raw: unknown): SuggestionAction | null {
  if (!raw || typeof raw !== "object") return null;
  const a = raw as Record<string, unknown>;
  const type = typeof a.type === "string" ? a.type : "";
  if ((VALUE_ACTIONS as readonly string[]).includes(type)) {
    const limit = VALUE_LIMITS[type as ValueAction];
    const rawValue = typeof a.value === "string" ? a.value.trim() : "";
    // Reject over-long values instead of truncating mid-sentence.
    if (!rawValue || rawValue.length > limit) return null;
    const value = clean(rawValue, limit);
    return value ? { type: type as ValueAction, value } : null;
  }
  if (type === "open_screen") {
    const screen = typeof a.screen === "string" ? a.screen : "";
    return (SUGGESTION_SCREENS as readonly string[]).includes(screen)
      ? { type: "open_screen", screen: screen as SuggestionScreen }
      : null;
  }
  return null;
}

/** Validates the model's JSON reply. Invalid entries are dropped, never repaired with made-up text. */
export function parseSuggestions(raw: unknown, idPrefix = `sug_${Date.now()}`): StoreSuggestion[] {
  const list = raw && typeof raw === "object" && Array.isArray((raw as any).suggestions)
    ? (raw as any).suggestions as unknown[]
    : [];
  const out: StoreSuggestion[] = [];
  const seenTitles = new Set<string>();
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const s = item as Record<string, unknown>;
    const category = typeof s.category === "string" && (SUGGESTION_CATEGORIES as readonly string[]).includes(s.category)
      ? s.category as SuggestionCategory
      : null;
    const title = clean(s.title, 80);
    const problem = clean(s.problem, 300);
    const recommendation = clean(s.recommendation, 400);
    const action = parseSuggestionAction(s.action);
    if (!category || !title || !problem || !recommendation || !action) continue;
    const key = title.toLowerCase();
    if (seenTitles.has(key)) continue;
    seenTitles.add(key);
    out.push({ id: `${idPrefix}_${out.length}`, category, title, problem, recommendation, action });
    if (out.length >= MAX_SUGGESTIONS) break;
  }
  return out;
}

type StorefrontLike = {
  title?: string | null;
  subtitle?: string | null;
  description?: string | null;
  status?: string | null;
  branding?: unknown;
  seo?: unknown;
  sections?: unknown;
  collections?: unknown;
  pages?: unknown;
  navigation?: unknown;
};

function arr(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === "object") : [];
}

/** Compact, factual summary of the seller's store for the prompt. */
export function buildStoreContext(
  sf: StorefrontLike | null | undefined,
  catalog: { activeProductCount: number; sampleProductNames: string[]; productsWithoutImages: number },
): Record<string, unknown> {
  const seo = (sf?.seo && typeof sf.seo === "object" ? sf.seo : {}) as Record<string, unknown>;
  const branding = (sf?.branding && typeof sf.branding === "object" ? sf.branding : {}) as Record<string, unknown>;
  const sections = arr(sf?.sections);
  const collections = arr(sf?.collections);
  const pages = arr(sf?.pages);
  const menus = arr(sf?.navigation);
  return {
    storeName: clean(sf?.title, 120),
    subtitle: clean(sf?.subtitle, 200),
    description: clean(sf?.description, 600),
    tagline: clean(branding.tagline, 200),
    published: sf?.status === "published",
    seo: {
      title: clean(seo.metaTitle, 120),
      description: clean(seo.metaDescription, 300),
    },
    homepageSections: sections.slice(0, 15).map((s) => {
      const settings = (s.settings && typeof s.settings === "object" ? s.settings : {}) as Record<string, unknown>;
      return {
        type: clean(s.type, 40),
        enabled: s.enabled !== false,
        heading: clean(settings.heading ?? s.title, 120),
        description: clean(settings.description ?? s.content, 200),
      };
    }),
    collections: {
      total: collections.length,
      live: collections.filter((c) => c.status === "active").length,
      names: collections.slice(0, 10).map((c) => clean(c.name ?? c.title, 60)).filter(Boolean),
    },
    pages: {
      total: pages.length,
      published: pages.filter((p) => p.status === "published").length,
      types: [...new Set(pages.map((p) => clean(p.type, 30)).filter(Boolean))],
    },
    navigation: menus.map((m) => ({
      type: clean(m.type, 20),
      itemCount: Array.isArray(m.items) ? m.items.length : 0,
    })),
    catalog: {
      activeProducts: catalog.activeProductCount,
      productsWithoutImages: catalog.productsWithoutImages,
      sampleProductNames: catalog.sampleProductNames.slice(0, 10).map((n) => clean(n, 60)),
    },
  };
}

export const SUGGESTIONS_SYSTEM_PROMPT = [
  "You are a storefront conversion expert for Brandthread, a fashion commerce app.",
  "You receive a JSON summary of ONE seller's real storefront. Suggest up to 5 specific improvements based only on that data.",
  "Never invent facts (sales numbers, reviews, products) that are not in the data. Skip things that are already good.",
  "Respond with JSON: {\"suggestions\":[{\"category\":string,\"title\":string,\"problem\":string,\"recommendation\":string,\"action\":object}]}",
  `category is one of: ${SUGGESTION_CATEGORIES.join(", ")}.`,
  "title <= 80 chars, problem <= 300 chars, recommendation <= 400 chars.",
  "action is either a concrete text change the app can save:",
  `  {"type":"set_store_name","value":string<=${VALUE_LIMITS.set_store_name}}`,
  `  {"type":"set_seo_title","value":string<=${VALUE_LIMITS.set_seo_title}}`,
  `  {"type":"set_seo_description","value":string<=${VALUE_LIMITS.set_seo_description}}`,
  `  {"type":"set_hero_heading","value":string<=${VALUE_LIMITS.set_hero_heading}} (only if a hero section exists)`,
  `  {"type":"set_hero_description","value":string<=${VALUE_LIMITS.set_hero_description}} (only if a hero section exists)`,
  "or, when the fix needs the seller's own input, a screen to open:",
  `  {"type":"open_screen","screen":one of ${SUGGESTION_SCREENS.join(", ")}}`,
  "For text changes, write the final ready-to-publish text in value, in the store's voice.",
].join("\n");
