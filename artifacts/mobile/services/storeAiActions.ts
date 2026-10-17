// ─── "Improve Store" suggestion actions ──────────────────────────────────────
// Pure helpers for the structured actions returned by
// POST /api/store/ai/suggestions. A value action edits the local store model
// (which storeService then saves with PUT /api/store); an open_screen action
// only routes the seller to the screen where they can make the change.

import type {
  Storefront, StoreAISuggestion, StoreAISuggestionAction,
} from './storeTypes';

const SCREEN_ROUTES: Record<Extract<StoreAISuggestionAction, { type: 'open_screen' }>['screen'], string> = {
  collections: '/store-collections',
  pages: '/store-pages',
  navigation: '/store-nav',
  products: '/(tabs)/products',
  sections: '/store-sections',
  policies: '/store-policies',
  seo: '/store-seo',
  theme: '/store-theme-picker',
  settings: '/store-settings',
};

const CATEGORIES: StoreAISuggestion['category'][] = [
  'layout', 'branding', 'conversion', 'mobile', 'product', 'copy', 'navigation', 'accessibility', 'performance',
];
const VALUE_TYPES = ['set_store_name', 'set_seo_title', 'set_seo_description', 'set_hero_heading', 'set_hero_description'] as const;

export function screenRoute(action: StoreAISuggestionAction): string | null {
  return action.type === 'open_screen' ? SCREEN_ROUTES[action.screen] ?? null : null;
}

/** One line telling the seller exactly what "Apply" will do. */
export function suggestionPreview(action: StoreAISuggestionAction): string {
  switch (action.type) {
    case 'set_store_name': return `Store name becomes "${action.value}"`;
    case 'set_seo_title': return `Search title becomes "${action.value}"`;
    case 'set_seo_description': return `Search description becomes "${action.value}"`;
    case 'set_hero_heading': return `Hero heading becomes "${action.value}"`;
    case 'set_hero_description': return `Hero text becomes "${action.value}"`;
    case 'open_screen': return 'Opens the screen where you can make this change.';
  }
}

/** Validates one suggestion from the server response; null when unusable. */
export function parseServerSuggestion(raw: unknown): Omit<StoreAISuggestion, 'id' | 'dismissed' | 'applied' | 'createdAt'> | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const category = CATEGORIES.includes(r.category as StoreAISuggestion['category']) ? r.category as StoreAISuggestion['category'] : null;
  const title = typeof r.title === 'string' ? r.title.trim() : '';
  const problem = typeof r.problem === 'string' ? r.problem.trim() : '';
  const recommendation = typeof r.recommendation === 'string' ? r.recommendation.trim() : '';
  const a = r.action && typeof r.action === 'object' ? r.action as Record<string, unknown> : null;
  let action: StoreAISuggestionAction | null = null;
  if (a && (VALUE_TYPES as readonly string[]).includes(String(a.type)) && typeof a.value === 'string' && a.value.trim()) {
    action = { type: a.type as typeof VALUE_TYPES[number], value: a.value.trim() };
  } else if (a && a.type === 'open_screen' && typeof a.screen === 'string' && a.screen in SCREEN_ROUTES) {
    action = { type: 'open_screen', screen: a.screen as keyof typeof SCREEN_ROUTES };
  }
  if (!category || !title || !problem || !recommendation || !action) return null;
  return { category, title, problem, recommendation, action, previewChange: suggestionPreview(action) };
}

/**
 * Apply a value action to the local store model. Returns false when the
 * change has nowhere to go (e.g. a hero edit for a store without a hero).
 */
export function applySuggestionToStore(store: Storefront, action: StoreAISuggestionAction): boolean {
  switch (action.type) {
    case 'set_store_name':
      store.settings = { ...store.settings, storeName: action.value };
      return true;
    case 'set_seo_title':
      store.seo = { ...store.seo, homepageTitle: action.value };
      return true;
    case 'set_seo_description':
      store.seo = { ...store.seo, homepageDescription: action.value };
      return true;
    case 'set_hero_heading':
    case 'set_hero_description': {
      const hero = [...store.sections]
        .sort((a, b) => a.order - b.order)
        .find(s => s.enabled && String(s.type).startsWith('hero'));
      if (!hero) return false;
      const key = action.type === 'set_hero_heading' ? 'heading' : 'description';
      hero.settings = { ...hero.settings, [key]: action.value };
      hero.updatedAt = new Date().toISOString();
      return true;
    }
    case 'open_screen':
      return false;
  }
}

/** True for a 503 { code: "ai_unavailable" } (or any 503) from the suggestions endpoint. */
export function isAiUnavailableError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { status?: unknown; code?: unknown; message?: unknown };
  if (e.code === 'ai_unavailable' || e.status === 503) return true;
  return typeof e.message === 'string' && /^API 503\b/.test(e.message);
}
