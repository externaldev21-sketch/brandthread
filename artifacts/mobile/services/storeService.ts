// ─── Brandthread AI Store Builder — Service Layer ────────────────────────────
// All persistence via AsyncStorage. No real AI backend required.
// Mock generation is separated into pure functions — never placed in UI code.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '@/lib/api';
import {
  Storefront, StoreSection, StoreSectionType, StoreSectionSettings,
  StoreCollection, StorePage, StorePolicy, StoreMenu, StoreMenuItem,
  StoreDomain, StoreSEO, StoreThemeSettings, StoreBranding,
  StoreGenerationAnswers, StoreGenerationResult, StoreAISuggestion,
  StoreVersion, StoreUndoEntry, StorePublishStatus, StoreSettings,
  StoreColorPalette, StoreTypography, TypographyStyle,
  BUILTIN_THEMES, AI_SUGGESTION_POOL, COLOR_PRESETS, TYPOGRAPHY_STYLES,
  SECTION_TYPE_LABELS,
  StoreTheme, BrandStyle, BrandMood, HomepagePriority,
} from './storeTypes';

const STORE_KEY = 'bt:store:v1';
const DRAFT_ANSWERS_KEY = 'bt:store:draft_answers:v1';

export type StoreApplyFailure = {
  kind: 'network' | 'server' | 'unknown';
  message: string;
};

export class StoreApplyError extends Error {
  readonly kind: StoreApplyFailure['kind'];

  constructor(failure: StoreApplyFailure) {
    super(failure.message);
    this.name = 'StoreApplyError';
    this.kind = failure.kind;
  }
}

/**
 * Converts transport and API errors into wording that can safely be shown in
 * the apply-results UI. API errors include their status in the shared client;
 * fetch failures do not, so they are identified by their standard messages.
 */
export function getStoreApplyFailure(error: unknown): StoreApplyFailure {
  if (error instanceof StoreApplyError) {
    return { kind: error.kind, message: error.message };
  }

  const message = error instanceof Error ? error.message : String(error ?? '');
  if (/^API\s+\d{3}:/i.test(message)) {
    return {
      kind: 'server',
      message: 'Our store service could not save this design. Please try again in a moment.',
    };
  }

  if (
    /network request failed|failed to fetch|fetch failed|network error|offline|timed?\s*out|connection/i.test(message)
    || (error instanceof TypeError && /fetch/i.test(message))
  ) {
    return {
      kind: 'network',
      message: 'We could not reach Brandthread. Check your connection, then try again.',
    };
  }

  return {
    kind: 'unknown',
    message: 'We could not apply this design right now. Please try again.',
  };
}

// ─── ID Generator ─────────────────────────────────────────────────────────────
function uid(prefix = 'id'): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

// ─── Default structures ───────────────────────────────────────────────────────
function defaultBranding(): StoreBranding {
  return {
    colors: {
      primary: '#7c3aed',
      secondary: '#5b21b6',
      accent: '#a78bfa',
      background: '#0f0f1a',
      text: '#f4f4ff',
      buttonText: '#0f0f1a',
    },
    typography: {
      style: 'modern',
      headingFont: 'Inter',
      bodyFont: 'Inter',
      buttonFont: 'Inter',
      fontWeight: '600',
      letterSpacing: 0,
      textCase: 'none',
    },
    buttonStyle: 'filled',
    cornerRadius: 'rounded',
    iconStyle: 'outline',
    animationLevel: 'standard',
  };
}

function defaultThemeSettings(themeId = 'vertex'): StoreThemeSettings {
  return {
    themeId,
    activePresetId: 'violet',
    overrides: {},
    headerLogoPosition: 'left',
    headerMenuStyle: 'inline',
    headerSearch: true,
    headerCart: true,
    headerAccount: true,
    stickyHeader: true,
    transparentHeader: false,
    announcementBar: {
      enabled: false,
      text: 'Free shipping on orders over $150',
      backgroundColor: '#7c3aed',
      textColor: '#ffffff',
      dismissible: true,
      sticky: true,
      hasCountdown: false,
    },
    footerNewsletter: true,
    footerSocialLinks: {},
    footerPolicies: true,
    footerContactInfo: '',
    footerCopyright: `© ${new Date().getFullYear()} Your Brand Name`,
    footerPaymentIcons: true,
    productPage: {
      mediaLayout: 'stacked',
      imageSize: 'large',
      infoPosition: 'below',
      variantStyle: 'buttons',
      sizeGuide: false,
      reviews: true,
      stickyCart: true,
      relatedProducts: true,
      sellerLink: true,
      sellerContent: true,
    },
    collectionPage: {
      columns: 2,
      cardStyle: 'standard',
      filters: true,
      sorting: true,
      quickAdd: true,
      pagination: 'infinite',
    },
  };
}

function defaultSettings(): StoreSettings {
  return {
    storeName: '',
    storeUrl: '',
    contactEmail: '',
    supportEmail: '',
    currency: 'USD',
    language: 'en',
    timezone: 'America/New_York',
    measurementUnit: 'imperial',
    storeStatus: 'not_started',
    passwordProtected: false,
    checkoutRequireAccount: false,
    checkoutGuestAllowed: true,
    orderNotifications: true,
    analyticsEnabled: false,
  };
}

function defaultSEO(): StoreSEO {
  return {
    homepageTitle: '',
    homepageDescription: '',
    sitemapEnabled: true,
    searchVisible: false,
    productSeoDefaults: { titleTemplate: '{{product}} – {{store}}', descriptionTemplate: '{{description}}' },
    collectionSeoDefaults: { titleTemplate: '{{collection}} – {{store}}', descriptionTemplate: '{{description}}' },
  };
}

function defaultMenus(): StoreMenu[] {
  return [
    { id: uid('menu'), type: 'main', name: 'Main Menu', items: [], updatedAt: new Date().toISOString() },
    { id: uid('menu'), type: 'mobile', name: 'Mobile Menu', items: [], updatedAt: new Date().toISOString() },
    { id: uid('menu'), type: 'footer', name: 'Footer Menu', items: [], updatedAt: new Date().toISOString() },
  ];
}

function defaultDomain(): StoreDomain {
  return {
    id: uid('domain'),
    type: 'brandthread',
    subdomain: '',
    verificationStatus: 'not_started',
    sslStatus: 'not_issued',
    isPrimary: true,
  };
}

function defaultStorefront(): Storefront {
  return {
    id: uid('store'),
    sellerId: 'local',
    settings: defaultSettings(),
    branding: defaultBranding(),
    themeSettings: defaultThemeSettings(),
    sections: [],
    collections: [],
    pages: [],
    policies: [],
    menus: defaultMenus(),
    seo: defaultSEO(),
    domains: [defaultDomain()],
    publishStatus: 'not_started',
    aiSuggestions: [],
    versions: [],
    undoStack: [],
    redoStack: [],
    lastEditedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  };
}

// ─── Persistence ──────────────────────────────────────────────────────────────
export async function getStorefront(): Promise<Storefront> {
  try {
    // Load from AsyncStorage first (local truth for complex UI state)
    const raw = await AsyncStorage.getItem(STORE_KEY);
    const local: Storefront = raw ? JSON.parse(raw) as Storefront : defaultStorefront();

    // Overlay server-side published state (non-blocking)
    try {
      const remote = await api.store.get();
      if (remote?.status === 'published') {
        local.publishStatus = 'published';
        local.publishedAt = remote.publishedAt ?? local.publishedAt;
      } else if (remote?.status === 'draft' && local.publishStatus === 'published') {
        local.publishStatus = 'unpublished';
      }
      local.sharePreviewRevokedAt = remote?.sharePreviewRevokedAt ?? null;
      // Sync server title/slug if we don't have one locally
      if (!local.settings.storeUrl && remote?.slug) {
        local.settings.storeUrl = `${remote.slug}.brandthread.app`;
      }
    } catch { /* no-op — API may not be reachable */ }

    if (!raw) await AsyncStorage.setItem(STORE_KEY, JSON.stringify(local));
    return local;
  } catch {
    return defaultStorefront();
  }
}

async function saveStorefront(store: Storefront): Promise<Storefront> {
  store.lastEditedAt = new Date().toISOString();
  await AsyncStorage.setItem(STORE_KEY, JSON.stringify(store));

  // Fire-and-forget sync to real API (best-effort, never blocks UI)
  api.store.save({
    title:       store.settings.storeName || store.settings.storeUrl || undefined,
    description: store.settings.storeName || undefined,
    theme: {
      primaryColor:    store.branding.colors.primary,
      secondaryColor:  store.branding.colors.secondary,
      accentColor:     store.branding.colors.accent,
      backgroundColor: store.branding.colors.background,
      textColor:       store.branding.colors.text,
      fontFamily:      store.branding.typography.headingFont,
      borderRadius:    store.branding.cornerRadius === 'sharp' ? 0 : store.branding.cornerRadius === 'pill' ? 24 : 8,
    },
    branding: {
      tagline:        store.settings.storeName ?? '',
      logoUrl:        store.branding.logoUri ?? '',
      targetAudience: '',
    },
    sections: store.sections.map(s => ({
      type: s.type, title: s.label, enabled: s.enabled, settings: s.settings,
    })),
    seo: {
      metaTitle:       store.seo.homepageTitle,
      metaDescription: store.seo.homepageDescription,
      keywords:        [],
    },
  } as Record<string, unknown>).catch(() => {/* no-op */});

  return store;
}

export async function autosaveStorefront(partial: Partial<Storefront>): Promise<Storefront> {
  const store = await getStorefront();
  const updated = { ...store, ...partial, autosaveAt: new Date().toISOString() };
  return saveStorefront(updated);
}

export async function updateSettings(settings: Partial<StoreSettings>): Promise<Storefront> {
  const store = await getStorefront();
  store.settings = { ...store.settings, ...settings };
  return saveStorefront(store);
}

export async function updateBranding(branding: Partial<StoreBranding>): Promise<Storefront> {
  const store = await getStorefront();
  store.branding = { ...store.branding, ...branding };
  return saveStorefront(store);
}

export async function updateThemeSettings(ts: Partial<StoreThemeSettings>): Promise<Storefront> {
  const store = await getStorefront();
  store.themeSettings = { ...store.themeSettings, ...ts };
  return saveStorefront(store);
}

export async function updateSEO(seo: Partial<StoreSEO>): Promise<Storefront> {
  const store = await getStorefront();
  store.seo = { ...store.seo, ...seo };
  return saveStorefront(store);
}

// ─── Draft generation answers ─────────────────────────────────────────────────
export async function saveDraftAnswers(answers: Partial<StoreGenerationAnswers>): Promise<void> {
  await AsyncStorage.setItem(DRAFT_ANSWERS_KEY, JSON.stringify(answers));
}

export async function loadDraftAnswers(): Promise<Partial<StoreGenerationAnswers> | null> {
  try {
    const raw = await AsyncStorage.getItem(DRAFT_ANSWERS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export async function clearDraftAnswers(): Promise<void> {
  await AsyncStorage.removeItem(DRAFT_ANSWERS_KEY);
}

// ─── Themes ───────────────────────────────────────────────────────────────────
export function getThemes(): StoreTheme[] {
  return BUILTIN_THEMES;
}

export function getThemeById(id: string): StoreTheme | undefined {
  return BUILTIN_THEMES.find(t => t.id === id);
}

export async function applyTheme(themeId: string, presetId?: string): Promise<Storefront> {
  const store = await getStorefront();
  const theme = getThemeById(themeId);
  if (!theme) return store;
  const preset = presetId
    ? theme.presets.find(p => p.paletteId === presetId) ?? theme.presets[0]
    : theme.presets[0];

  // Capture pre-mutation snapshot and persist to DB (fire-and-forget — theme
  // changes are auto-saves; the user can save a named version manually).
  const preThemeSnapshot = await _createVersionSnapshot(store, 'theme_change', `Applied theme: ${theme.name}`);
  api.store.saveVersion(`Applied theme: ${theme.name}`, preThemeSnapshot as Record<string, unknown>).catch(() => {});

  store.themeSettings.themeId = themeId;
  store.themeSettings.activePresetId = preset.paletteId;
  store.branding.colors = preset.colors;
  const typoEntry = TYPOGRAPHY_STYLES.find(t => t.value === theme.defaultTypography);
  if (typoEntry) {
    store.branding.typography = {
      ...store.branding.typography,
      style: theme.defaultTypography,
      headingFont: typoEntry.heading,
      bodyFont: typoEntry.body,
    };
  }
  return saveStorefront(store);
}

// ─── Sections ─────────────────────────────────────────────────────────────────
export async function createSection(type: StoreSectionType, settings?: Partial<StoreSectionSettings>): Promise<Storefront> {
  const store = await getStorefront();
  _pushUndo(store, 'create_section', { sections: store.sections });
  const maxOrder = store.sections.reduce((m, s) => Math.max(m, s.order), -1);
  const section: StoreSection = {
    id: uid('sec'),
    type,
    label: SECTION_TYPE_LABELS[type],
    enabled: true,
    order: maxOrder + 1,
    settings: settings ?? {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  store.sections.push(section);
  return saveStorefront(store);
}

export async function updateSection(id: string, settings: Partial<StoreSectionSettings>): Promise<Storefront> {
  const store = await getStorefront();
  const idx = store.sections.findIndex(s => s.id === id);
  if (idx === -1) return store;
  _pushUndo(store, 'update_section', { section: store.sections[idx] });
  store.sections[idx] = {
    ...store.sections[idx],
    settings: { ...store.sections[idx].settings, ...settings },
    updatedAt: new Date().toISOString(),
  };
  return saveStorefront(store);
}

export async function reorderSections(orderedIds: string[]): Promise<Storefront> {
  const store = await getStorefront();
  _pushUndo(store, 'reorder_sections', { sections: store.sections.map(s => ({ id: s.id, order: s.order })) });
  orderedIds.forEach((id, idx) => {
    const s = store.sections.find(sec => sec.id === id);
    if (s) s.order = idx;
  });
  store.sections.sort((a, b) => a.order - b.order);
  return saveStorefront(store);
}

export async function toggleSection(id: string): Promise<Storefront> {
  const store = await getStorefront();
  const s = store.sections.find(sec => sec.id === id);
  if (!s) return store;
  _pushUndo(store, 'toggle_section', { id, enabled: s.enabled });
  s.enabled = !s.enabled;
  s.updatedAt = new Date().toISOString();
  return saveStorefront(store);
}

export async function duplicateSection(id: string): Promise<Storefront> {
  const store = await getStorefront();
  const orig = store.sections.find(s => s.id === id);
  if (!orig) return store;
  _pushUndo(store, 'duplicate_section', { sections: store.sections });
  const copy: StoreSection = {
    ...JSON.parse(JSON.stringify(orig)),
    id: uid('sec'),
    label: orig.label + ' (Copy)',
    order: orig.order + 0.5,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  store.sections.push(copy);
  store.sections.sort((a, b) => a.order - b.order);
  store.sections.forEach((s, i) => { s.order = i; });
  return saveStorefront(store);
}

export async function deleteSection(id: string): Promise<Storefront> {
  const store = await getStorefront();
  _pushUndo(store, 'delete_section', { sections: JSON.parse(JSON.stringify(store.sections)) });
  store.sections = store.sections.filter(s => s.id !== id);
  store.sections.forEach((s, i) => { s.order = i; });
  store.redoStack = [];
  return saveStorefront(store);
}

// ─── Undo / Redo ──────────────────────────────────────────────────────────────
function _pushUndo(store: Storefront, action: string, before: unknown) {
  store.undoStack.push({ action, before, after: null, timestamp: new Date().toISOString() });
  if (store.undoStack.length > 50) store.undoStack.shift();
}

export async function undoLastAction(): Promise<Storefront> {
  const store = await getStorefront();
  const entry = store.undoStack.pop();
  if (!entry) return store;
  store.redoStack.push({ ...entry, after: JSON.parse(JSON.stringify(store.sections)) });
  if (entry.action === 'delete_section' || entry.action === 'reorder_sections' ||
      entry.action === 'duplicate_section' || entry.action === 'create_section') {
    store.sections = (entry.before as { sections?: StoreSection[] }).sections ??
      (entry.before as StoreSection[]) ?? store.sections;
  } else if (entry.action === 'update_section') {
    const prev = entry.before as StoreSection;
    const idx = store.sections.findIndex(s => s.id === prev.id);
    if (idx !== -1) store.sections[idx] = prev;
  } else if (entry.action === 'toggle_section') {
    const { id, enabled } = entry.before as { id: string; enabled: boolean };
    const s = store.sections.find(sec => sec.id === id);
    if (s) s.enabled = enabled;
  }
  return saveStorefront(store);
}

export async function redoLastAction(): Promise<Storefront> {
  const store = await getStorefront();
  const entry = store.redoStack.pop();
  if (!entry) return store;
  if (entry.after) {
    store.sections = entry.after as StoreSection[];
  }
  store.undoStack.push(entry);
  return saveStorefront(store);
}

// ─── Collections ──────────────────────────────────────────────────────────────
export async function getCollections(): Promise<StoreCollection[]> {
  const store = await getStorefront();
  return store.collections;
}

export async function createCollection(data: Partial<StoreCollection>): Promise<Storefront> {
  const store = await getStorefront();
  const now = new Date().toISOString();
  const col: StoreCollection = {
    id: uid('col'),
    type: 'manual',
    name: 'New Collection',
    description: '',
    productIds: [],
    productOrder: 'manual',
    conditions: [],
    conditionMatch: 'all',
    handle: `collection-${Date.now()}`,
    status: 'draft',
    createdAt: now,
    updatedAt: now,
    ...data,
  };
  store.collections.push(col);
  return saveStorefront(store);
}

export async function updateCollection(id: string, data: Partial<StoreCollection>): Promise<Storefront> {
  const store = await getStorefront();
  const idx = store.collections.findIndex(c => c.id === id);
  if (idx === -1) return store;
  store.collections[idx] = { ...store.collections[idx], ...data, updatedAt: new Date().toISOString() };
  return saveStorefront(store);
}

export async function deleteCollection(id: string): Promise<Storefront> {
  const store = await getStorefront();
  store.collections = store.collections.filter(c => c.id !== id);
  return saveStorefront(store);
}

// ─── Pages ────────────────────────────────────────────────────────────────────
export async function getPages(): Promise<StorePage[]> {
  const store = await getStorefront();
  return store.pages;
}

export async function createPage(data: Partial<StorePage>): Promise<Storefront> {
  const store = await getStorefront();
  const now = new Date().toISOString();
  const page: StorePage = {
    id: uid('page'),
    type: 'custom',
    title: 'New Page',
    slug: `page-${Date.now()}`,
    content: '',
    status: 'draft',
    createdAt: now,
    updatedAt: now,
    ...data,
  };
  store.pages.push(page);
  return saveStorefront(store);
}

export async function updatePage(id: string, data: Partial<StorePage>): Promise<Storefront> {
  const store = await getStorefront();
  const idx = store.pages.findIndex(p => p.id === id);
  if (idx === -1) return store;
  store.pages[idx] = { ...store.pages[idx], ...data, updatedAt: new Date().toISOString() };
  return saveStorefront(store);
}

export async function duplicatePage(id: string): Promise<Storefront> {
  const store = await getStorefront();
  const orig = store.pages.find(p => p.id === id);
  if (!orig) return store;
  const now = new Date().toISOString();
  const copy: StorePage = {
    ...JSON.parse(JSON.stringify(orig)),
    id: uid('page'),
    title: orig.title + ' (Copy)',
    slug: orig.slug + '-copy',
    status: 'draft',
    createdAt: now,
    updatedAt: now,
  };
  store.pages.push(copy);
  return saveStorefront(store);
}

export async function deletePage(id: string): Promise<Storefront> {
  const store = await getStorefront();
  store.pages = store.pages.filter(p => p.id !== id);
  return saveStorefront(store);
}

// ─── Policies ─────────────────────────────────────────────────────────────────
export async function getPolicies(): Promise<StorePolicy[]> {
  const store = await getStorefront();
  return store.policies;
}

export async function upsertPolicy(type: StorePolicy['type'], content: string, aiGenerated = false): Promise<Storefront> {
  const store = await getStorefront();
  const existing = store.policies.findIndex(p => p.type === type);
  const TITLES: Record<string, string> = {
    shipping: 'Shipping Policy', return: 'Return Policy', refund: 'Refund Policy',
    privacy: 'Privacy Policy', terms: 'Terms of Service', pre_order: 'Pre-order Policy',
  };
  const policy: StorePolicy = {
    id: existing >= 0 ? store.policies[existing].id : uid('pol'),
    type, title: TITLES[type] ?? type, content, aiGenerated,
    reviewedBySeller: !aiGenerated,
    updatedAt: new Date().toISOString(),
  };
  if (existing >= 0) {
    store.policies[existing] = policy;
  } else {
    store.policies.push(policy);
  }
  return saveStorefront(store);
}

// ─── Menus ────────────────────────────────────────────────────────────────────
export async function getMenus(): Promise<StoreMenu[]> {
  const store = await getStorefront();
  return store.menus;
}

export async function updateMenu(id: string, items: StoreMenuItem[]): Promise<Storefront> {
  const store = await getStorefront();
  const idx = store.menus.findIndex(m => m.id === id);
  if (idx === -1) return store;
  store.menus[idx] = { ...store.menus[idx], items, updatedAt: new Date().toISOString() };
  return saveStorefront(store);
}

// ─── Domains ──────────────────────────────────────────────────────────────────
export async function updateDomain(id: string, data: Partial<StoreDomain>): Promise<Storefront> {
  const store = await getStorefront();
  const idx = store.domains.findIndex(d => d.id === id);
  if (idx === -1) return store;
  store.domains[idx] = { ...store.domains[idx], ...data };
  return saveStorefront(store);
}

export async function addCustomDomain(domain: string): Promise<Storefront> {
  const store = await getStorefront();
  store.domains.push({
    id: uid('domain'),
    type: 'custom',
    customDomain: domain,
    verificationStatus: 'pending',
    sslStatus: 'pending',
    isPrimary: false,
  });
  return saveStorefront(store);
}

// ─── Versions ─────────────────────────────────────────────────────────────────

/**
 * Fetch saved store versions.
 *
 * Strategy:
 * 1. Try the real DB first — versions are durable across app uninstalls and
 *    device switches because they live in the server database.
 * 2. Treat the DB response as authoritative even when it is an empty list;
 *    only fall back to AsyncStorage when the API call itself throws (network
 *    unreachable, server error, etc.).
 * 3. Back-fill the local AsyncStorage cache with the authoritative DB list so
 *    offline reads work after a successful online fetch.
 */
export async function getVersions(): Promise<StoreVersion[]> {
  try {
    const dbVersions = await api.store.versions();
    if (Array.isArray(dbVersions)) {
      // DB is authoritative — map every returned version (including empty list)
      const mapped: StoreVersion[] = dbVersions.map((v: any) => ({
        id:          v.id,
        label:       v.label       ?? 'Version',
        trigger:     (v.trigger    ?? 'manual') as StoreVersion['trigger'],
        snapshot:    (v.snapshot   ?? {})        as StoreVersion['snapshot'],
        createdAt:   v.createdAt   ?? new Date().toISOString(),
        createdBy:   v.createdBy,
      }));

      // Back-fill the local cache so the UI can read versions while offline
      try {
        const store = await getStorefront();
        store.versions = mapped;
        await AsyncStorage.setItem(STORE_KEY, JSON.stringify(store));
      } catch { /* cache failure is non-fatal */ }

      return mapped;
    }
  } catch { /* API unreachable — fall through to local */ }

  // Local fallback — only reached on API failure (not on empty list)
  const store = await getStorefront();
  return store.versions;
}

/**
 * Capture a snapshot of the current store state into the local version list.
 *
 * Returns the captured snapshot object so callers can pass it as an explicit
 * payload to `api.store.saveVersion()`.  Passing the snapshot to the server
 * avoids the race between a concurrent storefront PUT and the snapshot POST:
 * the server stores exactly what the client observed at snapshot time, not
 * whatever happens to be in the DB row at the moment of the INSERT.
 *
 * This function does NOT call the API — each call site decides whether to
 * persist the snapshot to the DB (awaited for critical paths, fire-and-forget
 * for best-effort auto-saves).
 */
async function _createVersionSnapshot(
  store: Storefront,
  trigger: StoreVersion['trigger'],
  label: string,
): Promise<StoreVersion['snapshot']> {
  const snapshot: StoreVersion['snapshot'] = {
    sections:      JSON.parse(JSON.stringify(store.sections)),
    branding:      JSON.parse(JSON.stringify(store.branding)),
    themeSettings: JSON.parse(JSON.stringify(store.themeSettings)),
  };
  const version: StoreVersion = {
    id: uid('ver'),
    label,
    trigger,
    snapshot,
    createdAt: new Date().toISOString(),
  };
  store.versions.unshift(version);
  if (store.versions.length > 20) store.versions.pop();
  return snapshot;
}

export async function createVersion(label: string): Promise<Storefront> {
  const store = await getStorefront();
  // Capture the pre-save snapshot so the server stores what the client sees
  // right now, not what the DB holds after the concurrent storefront sync.
  const snapshot = await _createVersionSnapshot(store, 'manual', label);

  // Sync current local state to the backend BEFORE saving the version snapshot.
  // Not best-effort: if either call fails we propagate the error so the caller
  // (handleSaveVersion) can surface an Alert — we never silently lose a version.
  await api.store.save({
    sections: store.sections as any,
    branding: store.branding as any,
    theme: { themeId: store.themeSettings.themeId } as any,
  });
  // Save the version snapshot server-side with the explicit client payload.
  // Throws on failure so local state is only committed once the DB confirms.
  await api.store.saveVersion(label, snapshot as Record<string, unknown>);
  return saveStorefront(store);
}

export async function restoreVersion(versionId: string): Promise<Storefront> {
  const store = await getStorefront();

  // ── Save the pre-restore snapshot BEFORE touching the server ──────────────
  // This must happen first so the snapshot captures the current state, not the
  // already-restored one.  We await the DB write so the safety version is
  // durable before any server mutation takes place.
  const preSnapshot = await _createVersionSnapshot(store, 'manual', 'Auto-saved before restore');
  try {
    await api.store.saveVersion('Auto-saved before restore', preSnapshot as Record<string, unknown>);
  } catch { /* non-fatal — local snapshot still recorded in AsyncStorage */ }

  // ── Try server restore ─────────────────────────────────────────────────────
  try {
    const restored = await api.store.restoreVersion(versionId);
    if (restored) {
      // Apply DB fields (sections / branding / theme) returned by the restore
      if (Array.isArray(restored.sections))   store.sections = restored.sections as any;
      if (restored.branding && typeof restored.branding === 'object') store.branding = restored.branding as any;
      if (restored.theme    && typeof restored.theme    === 'object') {
        const t = restored.theme as any;
        if (t.themeId) store.themeSettings.themeId = t.themeId;
      }
      return saveStorefront(store);
    }
  } catch { /* fall through to local */ }

  // ── Local fallback ─────────────────────────────────────────────────────────
  const ver = store.versions.find(v => v.id === versionId);
  if (!ver?.snapshot) return store;
  if (ver.snapshot.sections)      store.sections      = ver.snapshot.sections;
  if (ver.snapshot.branding)      store.branding      = ver.snapshot.branding;
  if (ver.snapshot.themeSettings) store.themeSettings = ver.snapshot.themeSettings;
  return saveStorefront(store);
}

// ─── AI Suggestions ───────────────────────────────────────────────────────────
export async function generateAISuggestions(): Promise<Storefront> {
  const store = await getStorefront();
  const active = store.aiSuggestions.filter(s => !s.dismissed && !s.applied);
  if (active.length >= 3) return store;
  // Pick random suggestions not already present
  const existing = new Set(store.aiSuggestions.map(s => s.title));
  const pool = AI_SUGGESTION_POOL.filter(s => !existing.has(s.title));
  const picks = pool.sort(() => Math.random() - 0.5).slice(0, 3 - active.length);
  const now = new Date().toISOString();
  picks.forEach(p => {
    store.aiSuggestions.push({ ...p, id: uid('sug'), dismissed: false, applied: false, createdAt: now });
  });
  return saveStorefront(store);
}

export async function applyAISuggestion(id: string): Promise<Storefront> {
  const store = await getStorefront();
  const s = store.aiSuggestions.find(s => s.id === id);
  if (s) { s.applied = true; }
  return saveStorefront(store);
}

export async function dismissAISuggestion(id: string): Promise<Storefront> {
  const store = await getStorefront();
  const s = store.aiSuggestions.find(s => s.id === id);
  if (s) { s.dismissed = true; }
  return saveStorefront(store);
}

// ─── Mock AI Generation ───────────────────────────────────────────────────────
// Pure functions. No network calls. Separated from UI.

function _pickColorFromAnswers(answers: StoreGenerationAnswers): StoreColorPalette {
  if (answers.colors.primary !== '#7c3aed') return answers.colors; // user customized
  // pick a preset based on mood + style
  const mood = answers.moods[0];
  const style = answers.primaryStyle;
  if (style === 'luxury' || mood === 'premium' || mood === 'exclusive') return COLOR_PRESETS[7].colors; // Obsidian
  if (style === 'minimal' || mood === 'clean') return COLOR_PRESETS[1].colors; // Alabaster
  if (style === 'streetwear' || mood === 'bold' || mood === 'raw') return COLOR_PRESETS[3].colors; // Tokyo
  if (style === 'vintage') return COLOR_PRESETS[4].colors; // Linen
  if (style === 'y2k' || mood === 'colorful' || mood === 'playful') return COLOR_PRESETS[3].colors; // Tokyo
  if (style === 'outdoor' || style === 'sportswear') return COLOR_PRESETS[5].colors; // Cobalt
  if (mood === 'dark' || mood === 'futuristic') return COLOR_PRESETS[0].colors; // Midnight
  return COLOR_PRESETS[0].colors; // default Midnight
}

function _pickThemeFromAnswers(answers: StoreGenerationAnswers): string {
  const style = answers.primaryStyle;
  const mood = answers.moods[0];
  if (style === 'luxury') return 'luxe';
  if (style === 'streetwear') return mood === 'dark' ? 'noir' : 'street';
  if (style === 'minimal') return 'canvas';
  if (style === 'vintage') return 'archive';
  if (style === 'y2k' || style === 'techwear') return 'tokyo';
  if (style === 'outdoor' || style === 'sportswear') return mood === 'bold' ? 'motion' : 'horizon';
  if (style === 'high_fashion') return 'muse';
  if (mood === 'editorial') return 'gallery';
  if (mood === 'futuristic' || mood === 'dark') return 'pulse';
  if (mood === 'bold') return 'district';
  return 'vertex';
}

function _buildSectionsFromAnswers(answers: StoreGenerationAnswers): StoreSection[] {
  const now = new Date().toISOString();
  const sections: StoreSection[] = [];
  let order = 0;

  const add = (type: StoreSectionType, label: string, settings: StoreSectionSettings = {}) => {
    sections.push({ id: uid('sec'), type, label, enabled: true, order: order++, settings, createdAt: now, updatedAt: now });
  };

  // Primary hero based on homepage priority
  const hero = answers.homepagePriority;
  if (hero === 'hero_video') add('hero_video', 'Hero Video', { heading: 'The Brand.', description: 'Wear the future.', buttonLabel: 'Shop Now', muted: true, autoplay: true, loop: true, overlayStrength: 40 });
  else if (hero === 'hero_slideshow') add('hero_slideshow', 'Hero Slideshow', { heading: 'New Collection', buttonLabel: 'Shop Now', slides: [{}, {}, {}] });
  else add('hero_image', 'Hero Image', { heading: 'The Brand.', description: 'Shop the new collection.', buttonLabel: 'Shop Now', overlayStrength: 30 });

  // Announcement bar if features include it
  if (answers.features.includes('announcement_bar')) {
    add('announcement', 'Announcement Bar', { heading: 'Free shipping on orders over $150', visible: true, sticky: true, dismissible: true });
  }

  // Drop countdown if selected
  if (hero === 'drop_countdown' || answers.additionalSections.includes('drop_countdown')) {
    add('drop_countdown', 'Drop Countdown', { heading: 'New Drop Coming', countdownStyle: 'bold', dropDate: new Date(Date.now() + 7 * 86400000).toISOString() });
  }

  // Featured collection / best sellers
  if (hero === 'featured_collection' || answers.additionalSections.includes('featured_collection')) {
    add('featured_collection', 'Featured Collection', { heading: 'New Arrivals', collectionRef: 'new_arrivals', columns: 2 });
  } else if (hero === 'best_sellers' || answers.additionalSections.includes('best_sellers')) {
    add('product_grid', 'Best Sellers', { heading: 'Best Sellers', collectionRef: 'best_sellers', columns: 2 });
  } else {
    add('featured_collection', 'Shop the Collection', { heading: 'Shop the Collection', columns: 2 });
  }

  // Brand story
  if (answers.brandStory || hero === 'brand_story') {
    add('brand_story', 'Brand Story', { heading: 'Our Story', storyText: answers.brandStory || 'Tell your brand story here.', textAlignment: 'center' });
  }

  // Lookbook
  if (hero === 'lookbook' || answers.additionalSections.includes('lookbook')) {
    add('lookbook', 'Lookbook', { heading: 'The Lookbook' });
  }

  // Image with text
  add('image_with_text', 'Quality & Craft', { heading: 'Designed to last.', description: 'Built with intention, worn with pride.', buttonLabel: 'Learn More', textAlignment: 'left' });

  // Seller posts
  if (answers.features.includes('seller_posts') || answers.existingContent.includes('social_posts')) {
    add('seller_posts', 'From the Thread', { heading: 'From the Thread', postCount: 6, postLayout: 'grid' });
  }

  // Customer reviews
  if (answers.features.includes('product_reviews') || answers.existingContent.includes('customer_reviews')) {
    add('customer_reviews', 'What Customers Say', { heading: 'What Customers Say', reviews: [
      { author: 'Alex M.', text: 'Incredible quality and fast shipping.', rating: 5, date: new Date().toISOString() },
      { author: 'Jordan T.', text: 'Love the fit. Ordering again.', rating: 5, date: new Date().toISOString() },
    ]});
  }

  // Email / newsletter
  if (answers.features.includes('email_signup')) {
    add('newsletter', 'Stay in the Loop', { heading: 'Join the community.', description: 'Get early access to drops and exclusive offers.', buttonLabel: 'Subscribe' });
  }

  return sections;
}

export async function generateStoreFromAnswers(answers: StoreGenerationAnswers): Promise<StoreGenerationResult> {
  // Call the real AI API — throws on failure so the generating screen can surface
  // the error and offer a retry. The previous mock fallback was removed because it:
  //   • silently masked real API/network failures as successful "generation"
  //   • used a partial inline mapper that hardcoded all sections to hero_image and
  //     discarded font, border-radius, title, subtitle, description, SEO, and branding
  // mapAiConfigToResult (shared with logo/moodboard/social paths) extracts every
  // field the AI returns and populates the full StoreGenerationResult.
  const currentStore = await getStorefront();
  const aiData = await api.store.generate(answers as unknown as Record<string, unknown>);
  const cfg = (aiData?.config ?? {}) as any;
  return mapAiConfigToResult(cfg, currentStore, answers);
}

// ─── Map AI font family name → local TypographyStyle ─────────────────────────
function mapAiTypography(fontFamily?: string): TypographyStyle {
  if (!fontFamily) return 'modern';
  const f = fontFamily.toLowerCase();
  if (f.includes('serif') && !f.includes('sans')) return 'classic';
  if (f.includes('mono') || f.includes('code'))   return 'technical';
  if (f.includes('bold') || f.includes('condensed')) return 'bold';
  if (f.includes('editorial') || f.includes('vogue')) return 'editorial';
  if (f.includes('luxury') || f.includes('elegant')) return 'luxury';
  if (f.includes('minimal') || f.includes('helvetica') || f.includes('neue')) return 'minimal';
  return 'modern';
}

// ─── Map raw AI config (from any generation endpoint) → typed StoreSection[] ──
// The AI returns generic types ("hero", "products", etc.); we map them to the
// specific StoreSectionType values the editor understands.
function mapAiConfigToSections(cfg: any): StoreSection[] {
  const TYPE_MAP: Record<string, StoreSectionType> = {
    hero:         'hero_image',
    products:     'product_grid',
    about:        'image_with_text',
    story:        'brand_story',
    testimonials: 'customer_reviews',
    newsletter:   'newsletter',
    faq:          'faq',
    social:       'social_feed',
    lookbook:     'lookbook',
    announcement: 'announcement',
  };
  const aiSections: any[] = Array.isArray(cfg?.sections) ? cfg.sections : [];
  return aiSections.map((s: any, idx: number): StoreSection => ({
    id:        `ai_${Date.now()}_${idx}`,
    type:      TYPE_MAP[s.type] ?? 'text_banner',
    label:     s.title ?? s.type ?? 'Section',
    enabled:   true,
    order:     idx,
    settings:  { heading: s.title ?? '', description: s.content ?? '' },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }));
}

// ─── Map AI borderRadius number → local cornerRadius enum ────────────────────
function mapAiBorderRadius(r?: number): StoreBranding['cornerRadius'] {
  if (r === undefined || r === null) return 'subtle';
  if (r === 0)  return 'sharp';
  if (r <= 8)   return 'subtle';
  if (r <= 16)  return 'rounded';
  return 'pill';
}

// ─── Map a complete raw AI config → StoreGenerationResult ────────────────────
// Extracts ALL fields the AI returns: palette, typography (including exact font
// names and border radius), sections, title, subtitle, description, SEO
// (including keywords), and DB-side branding (tagline/mission/targetAudience).
function mapAiConfigToResult(
  cfg: any,
  currentStore: Storefront,
  fromAnswers: StoreGenerationAnswers,
): StoreGenerationResult {
  const t = cfg?.theme ?? {};
  const palette: StoreColorPalette = {
    primary:    t.primaryColor    ?? currentStore.branding.colors.primary,
    secondary:  t.secondaryColor  ?? currentStore.branding.colors.secondary,
    accent:     t.accentColor     ?? currentStore.branding.colors.accent,
    background: t.backgroundColor ?? currentStore.branding.colors.background,
    text:       t.textColor       ?? currentStore.branding.colors.text,
    buttonText: currentStore.branding.colors.buttonText,
  };
  const aiSections = mapAiConfigToSections(cfg);
  const b = cfg?.branding ?? {};
  const hasSeo = cfg?.seo?.metaTitle || cfg?.seo?.metaDescription || cfg?.seo?.keywords?.length;
  const hasApiBranding = b.tagline || b.mission || b.targetAudience;
  return {
    sections: aiSections.length > 0 ? aiSections : currentStore.sections,
    branding: {
      ...currentStore.branding,
      colors: palette,
      cornerRadius: t.borderRadius !== undefined
        ? mapAiBorderRadius(t.borderRadius)
        : currentStore.branding.cornerRadius,
      typography: {
        ...currentStore.branding.typography,
        style:       mapAiTypography(t.fontFamily),
        // Preserve exact AI font name so the DB receives the real typeface
        headingFont: t.fontFamily ?? currentStore.branding.typography.headingFont,
        bodyFont:    t.fontFamily ?? currentStore.branding.typography.bodyFont,
        buttonFont:  t.fontFamily ?? currentStore.branding.typography.buttonFont,
      },
    },
    suggestedThemeId: t.themeId ?? 'vertex',
    generatedAt:      new Date().toISOString(),
    fromAnswers,
    storeTitle:       cfg?.title       || undefined,
    storeSubtitle:    cfg?.subtitle    || undefined,
    storeDescription: cfg?.description || undefined,
    storeSeo: hasSeo ? {
      homepageTitle:       cfg.seo?.metaTitle       || undefined,
      homepageDescription: cfg.seo?.metaDescription || undefined,
      keywords:            Array.isArray(cfg.seo?.keywords) ? cfg.seo.keywords : [],
    } : undefined,
    apiBranding: hasApiBranding ? {
      tagline:        b.tagline        || undefined,
      mission:        b.mission        || undefined,
      targetAudience: b.targetAudience || undefined,
    } : undefined,
  };
}

export async function applyGenerationResult(result: StoreGenerationResult): Promise<Storefront> {
  const store = await getStorefront();
  // Capture pre-AI snapshot and persist to DB fire-and-forget (explicit payload
  // avoids race with the awaited api.store.save() below).
  const preAiSnapshot = await _createVersionSnapshot(store, 'ai_change', 'Before AI generation');
  api.store.saveVersion('Before AI generation', preAiSnapshot as Record<string, unknown>).catch(() => {});
  store.sections = result.sections;
  store.branding  = result.branding;
  store.themeSettings.themeId = result.suggestedThemeId;
  const theme = BUILTIN_THEMES.find(t => t.id === result.suggestedThemeId);
  if (theme?.presets[0]) store.themeSettings.activePresetId = theme.presets[0].paletteId;
  store.generatedFrom = result.fromAnswers;
  if (result.storeTitle)                    store.settings.storeName      = result.storeTitle;
  if (result.storeSeo?.homepageTitle)       store.seo.homepageTitle       = result.storeSeo.homepageTitle;
  if (result.storeSeo?.homepageDescription) store.seo.homepageDescription = result.storeSeo.homepageDescription;
  if (store.publishStatus === 'not_started') store.publishStatus = 'draft';
  store.lastEditedAt = new Date().toISOString();

  // ── ONE authoritative backend save, performed BEFORE committing local state ──
  // This eliminates the race between saveStorefront's fire-and-forget PUT and a
  // subsequent awaited PUT: only one PUT is issued, and local state is committed
  // only after it succeeds.  Throws on failure; callers must NOT navigate.
  await api.store.save({
    title:       result.storeTitle       ?? store.settings.storeName ?? undefined,
    subtitle:    result.storeSubtitle    ?? undefined,
    description: result.storeDescription ?? undefined,
    sections:    store.sections as any,
    branding: {
      ...(result.apiBranding ?? {}),
      logoUrl: store.branding.logoUri ?? '',
    } as any,
    theme: {
      primaryColor:    store.branding.colors.primary,
      secondaryColor:  store.branding.colors.secondary,
      accentColor:     store.branding.colors.accent,
      backgroundColor: store.branding.colors.background,
      textColor:       store.branding.colors.text,
      // Persist exact AI font name, not the reduced style enum
      fontFamily:      store.branding.typography.headingFont,
      borderRadius:    store.branding.cornerRadius === 'sharp'   ? 0
                     : store.branding.cornerRadius === 'pill'    ? 24
                     : store.branding.cornerRadius === 'rounded' ? 12 : 8,
    } as any,
    seo: {
      metaTitle:       result.storeSeo?.homepageTitle,
      metaDescription: result.storeSeo?.homepageDescription,
      keywords:        result.storeSeo?.keywords ?? [],
    },
  } as any);

  // Commit local state only after the backend confirms success
  await AsyncStorage.setItem(STORE_KEY, JSON.stringify(store));
  return store;
}

// ─── Generate from social (full flow: call API → map complete config → apply) ──
// Throws on backend-sync failure — callers must catch and surface the error.
export async function generateFromSocial(
  profileUrl: string,
  base64s?: string[],
  context?: Record<string, unknown>,
): Promise<Storefront> {
  const callCtx: Record<string, unknown> = { ...(context ?? {}) };
  if (base64s?.length) callCtx.base64List = base64s;

  const aiData = await api.store.fromSocial(profileUrl, callCtx);
  const cfg = aiData?.config as any;
  const currentStore = await getStorefront();

  const fromAnswers: StoreGenerationAnswers = {
    primaryStyle: null, secondaryStyles: [], moods: [],
    colors: currentStore.branding.colors,
    typography: 'modern' as any,
    homepagePriority: null, additionalSections: [], brandStory: '',
    targetCustomers: [], ageRange: null, audienceDescription: '',
    existingContent: [], features: [], moodBoardUris: [],
  };

  // mapAiConfigToResult extracts ALL fields: sections, palette, typography,
  // title, subtitle, description, SEO, and DB branding.
  return applyGenerationResult(mapAiConfigToResult(cfg, currentStore, fromAnswers));
}

// ─── Apply from logo (full flow: API → map ALL config → apply → backend sync) ─
// Throws on backend failure — callers must catch and NOT navigate on error.
export async function applyFromLogo(logoUri: string, base64?: string | null): Promise<Storefront> {
  try {
    const currentStore = await getStorefront();
    const fromAnswers: StoreGenerationAnswers = {
      primaryStyle: null, secondaryStyles: [], moods: [],
      colors: currentStore.branding.colors, typography: 'modern' as any,
      homepagePriority: null, additionalSections: [], brandStory: '',
      targetCustomers: [], ageRange: null, audienceDescription: '',
      existingContent: [], features: [],
      logoUri: logoUri ?? undefined, moodBoardUris: [],
    };
    const aiData = await (base64 ? api.store.fromLogo(base64, {}) : api.store.fromLogo(logoUri, {}));
    const cfg = (aiData?.config ?? {}) as any;
    return await applyGenerationResult(mapAiConfigToResult(cfg, currentStore, fromAnswers));
  } catch (error) {
    throw new StoreApplyError(getStoreApplyFailure(error));
  }
}

// ─── Apply from moodboard (full flow: API → map ALL config → apply → backend sync) ─
// Throws on backend failure — callers must catch and NOT navigate on error.
export async function applyFromMoodboard(imageUris: string[], base64List?: string[]): Promise<Storefront> {
  try {
    const currentStore = await getStorefront();
    const fromAnswers: StoreGenerationAnswers = {
      primaryStyle: null, secondaryStyles: [], moods: [],
      colors: currentStore.branding.colors, typography: 'modern' as any,
      homepagePriority: null, additionalSections: [], brandStory: '',
      targetCustomers: [], ageRange: null, audienceDescription: '',
      existingContent: [], features: [], moodBoardUris: imageUris,
    };
    const aiData = await (base64List?.length
      ? api.store.fromMoodboard(base64List, {})
      : api.store.fromMoodboard(imageUris, {}));
    const cfg = (aiData?.config ?? {}) as any;
    return await applyGenerationResult(mapAiConfigToResult(cfg, currentStore, fromAnswers));
  } catch (error) {
    throw new StoreApplyError(getStoreApplyFailure(error));
  }
}

// ─── Generate from logo ───────────────────────────────────────────────────────
export async function generateFromLogo(logoUri: string, base64?: string | null): Promise<{
  dominantColors: string[];
  suggestedPalette: StoreColorPalette;
  suggestedThemeId: string;
  suggestedTypography: TypographyStyle;
  brandMoods: BrandMood[];
  aiSections: StoreSection[];
  source: 'ai' | 'fallback';
}> {
  if (base64) {
    try {
      const aiData = await api.store.fromLogo(base64, {});
      if (aiData?.config?.theme) {
        const cfg = aiData.config;
        const palette: StoreColorPalette = {
          primary:    cfg.theme?.primaryColor ?? '#7c3aed',
          secondary:  cfg.theme?.secondaryColor ?? '#5b21b6',
          accent:     cfg.theme?.accentColor ?? '#a78bfa',
          background: cfg.theme?.backgroundColor ?? '#0f0f1a',
          text:       cfg.theme?.textColor ?? '#f4f4ff',
          buttonText: '#0f0f1a',
        };
        return {
          dominantColors: [palette.primary, palette.accent, palette.secondary],
          suggestedPalette: palette,
          suggestedThemeId: (cfg.theme as any)?.themeId ?? 'vertex',
          suggestedTypography: 'modern',
          brandMoods: ['premium', 'clean'],
          aiSections: mapAiConfigToSections(cfg),
          source: 'ai',
        };
      }
    } catch { /* fall through to mock */ }
  }
  try {
    const aiData = await api.store.fromLogo(logoUri, {});
    if (aiData?.config?.theme) {
      const cfg = aiData.config;
      const palette: StoreColorPalette = {
        primary:    cfg.theme?.primaryColor ?? '#7c3aed',
        secondary:  cfg.theme?.secondaryColor ?? '#5b21b6',
        accent:     cfg.theme?.accentColor ?? '#a78bfa',
        background: cfg.theme?.backgroundColor ?? '#0f0f1a',
        text:       cfg.theme?.textColor ?? '#f4f4ff',
        buttonText: '#0f0f1a',
      };
      return {
        dominantColors: [palette.primary, palette.accent, palette.secondary],
        suggestedPalette: palette,
        suggestedThemeId: 'vertex',
        suggestedTypography: 'modern',
        brandMoods: ['premium', 'clean'],
        aiSections: mapAiConfigToSections(cfg),
        source: 'ai',
      };
    }
  } catch { /* fall through to mock */ }

  // Deterministic mock fallback — AI could not read the image
  await new Promise(r => setTimeout(r, 800));
  const idx = logoUri.length % COLOR_PRESETS.length;
  const palette = COLOR_PRESETS[idx];
  return {
    dominantColors: [palette.colors.primary, palette.colors.accent, palette.colors.secondary],
    suggestedPalette: palette.colors,
    suggestedThemeId: BUILTIN_THEMES[idx % BUILTIN_THEMES.length].id,
    suggestedTypography: TYPOGRAPHY_STYLES[idx % TYPOGRAPHY_STYLES.length].value,
    brandMoods: ['premium', 'clean'],
    aiSections: [],
    source: 'fallback',
  };
}

// ─── Generate from mood board ─────────────────────────────────────────────────
export async function generateFromMoodBoard(imageUris: string[], base64List?: string[]): Promise<{
  colorPalette: StoreColorPalette;
  typographyDirection: TypographyStyle;
  layoutStyle: string;
  imageTreatment: string;
  suggestedThemeId: string;
  suggestedSections: StoreSectionType[];
  aiSections: StoreSection[];
  source: 'ai' | 'fallback';
}> {
  if (base64List?.length) {
    try {
      const aiData = await api.store.fromMoodboard(base64List, {});
      if (aiData?.config?.theme) {
        const cfg = aiData.config;
        const palette: StoreColorPalette = {
          primary:    cfg.theme?.primaryColor ?? '#7c3aed',
          secondary:  cfg.theme?.secondaryColor ?? '#5b21b6',
          accent:     cfg.theme?.accentColor ?? '#a78bfa',
          background: cfg.theme?.backgroundColor ?? '#0f0f1a',
          text:       cfg.theme?.textColor ?? '#f4f4ff',
          buttonText: '#0f0f1a',
        };
        return {
          colorPalette: palette,
          typographyDirection: 'modern',
          layoutStyle: 'editorial',
          imageTreatment: 'high-contrast with minimal overlay',
          suggestedThemeId: (cfg.theme as any)?.themeId ?? 'vertex',
          suggestedSections: ['hero_image', 'lookbook', 'featured_collection', 'brand_story', 'seller_posts', 'newsletter'],
          aiSections: mapAiConfigToSections(cfg),
          source: 'ai',
        };
      }
    } catch { /* fall through */ }
  }
  try {
    const aiData = await api.store.fromMoodboard(imageUris, {});
    if (aiData?.config?.theme) {
      const cfg = aiData.config;
      const palette: StoreColorPalette = {
        primary:    cfg.theme?.primaryColor ?? '#7c3aed',
        secondary:  cfg.theme?.secondaryColor ?? '#5b21b6',
        accent:     cfg.theme?.accentColor ?? '#a78bfa',
        background: cfg.theme?.backgroundColor ?? '#0f0f1a',
        text:       cfg.theme?.textColor ?? '#f4f4ff',
        buttonText: '#0f0f1a',
      };
      return {
        colorPalette: palette,
        typographyDirection: 'modern',
        layoutStyle: 'editorial',
        imageTreatment: 'high-contrast with minimal overlay',
        suggestedThemeId: 'vertex',
        suggestedSections: ['hero_image', 'lookbook', 'featured_collection', 'brand_story', 'seller_posts', 'newsletter'],
        aiSections: mapAiConfigToSections(cfg),
        source: 'ai',
      };
    }
  } catch { /* fall through to mock */ }

  // Mock fallback — AI could not read the images
  await new Promise(r => setTimeout(r, 1000));
  const idx = imageUris.length % COLOR_PRESETS.length;
  const palette = COLOR_PRESETS[idx];
  return {
    colorPalette: palette.colors,
    typographyDirection: TYPOGRAPHY_STYLES[idx % TYPOGRAPHY_STYLES.length].value,
    layoutStyle: 'editorial',
    imageTreatment: 'high-contrast with minimal overlay',
    suggestedThemeId: BUILTIN_THEMES[(idx + 2) % BUILTIN_THEMES.length].id,
    suggestedSections: ['hero_image', 'lookbook', 'featured_collection', 'brand_story', 'seller_posts', 'newsletter'],
    aiSections: [],
    source: 'fallback',
  };
}

// ─── Publish ──────────────────────────────────────────────────────────────────
export interface StoreValidationResult {
  errors: string[];
  warnings: string[];
  recommendations: string[];
  canPublish: boolean;
}

export async function validateStore(): Promise<StoreValidationResult> {
  const store = await getStorefront();
  const errors: string[] = [];
  const warnings: string[] = [];
  const recommendations: string[] = [];

  if (!store.settings.storeName) errors.push('Store name is required.');
  if (!store.branding.logoUri) warnings.push('No logo uploaded. Add a logo for a professional storefront.');
  if (store.sections.length === 0) errors.push('Homepage has no sections. Add at least one section.');
  if (!store.menus.find(m => m.type === 'main' && m.items.length > 0)) warnings.push('Main navigation is empty.');
  if (!store.settings.contactEmail) warnings.push('No contact email set.');
  if (!store.policies.find(p => p.type === 'shipping')) warnings.push('No shipping policy. Buyers expect to know how orders ship.');
  if (!store.policies.find(p => p.type === 'return')) warnings.push('No return policy. Add one to increase buyer confidence.');
  if (store.domains.every(d => !d.subdomain && !d.customDomain)) errors.push('No store URL configured. Set a Brandthread subdomain.');

  if (!store.seo.homepageTitle) recommendations.push('Add an SEO title to improve search visibility.');
  if (!store.seo.homepageDescription) recommendations.push('Add a meta description for search engines.');
  if (store.sections.filter(s => s.enabled).length < 3) recommendations.push('Add more homepage sections to engage buyers.');

  return {
    errors,
    warnings,
    recommendations,
    canPublish: errors.length === 0,
  };
}

export async function publishStore(): Promise<{ success: boolean; message: string; storefront?: Storefront }> {
  const validation = await validateStore();
  if (!validation.canPublish) {
    return { success: false, message: `Cannot publish: ${validation.errors[0]}` };
  }
  const store = await getStorefront();
  // Capture pre-publish snapshot and persist to DB fire-and-forget so sellers
  // can roll back to the last draft even after the server restarts.
  const publishLabel = `Published ${new Date().toLocaleString()}`;
  const prePublishSnapshot = await _createVersionSnapshot(store, 'publish', publishLabel);
  api.store.saveVersion(publishLabel, prePublishSnapshot as Record<string, unknown>).catch(() => {});

  store.publishStatus = 'published';
  store.publishedAt = new Date().toISOString();
  await saveStorefront(store);

  // Publish to real API
  try { await api.store.publish(); } catch { /* no-op */ }

  return { success: true, message: 'Your store is now live.', storefront: store };
}

export async function unpublishStore(): Promise<Storefront> {
  const store = await getStorefront();
  store.publishStatus = 'unpublished';
  try { await api.store.unpublish(); } catch { /* no-op */ }
  return saveStorefront(store);
}

export async function saveDraft(): Promise<Storefront> {
  const store = await getStorefront();
  if (store.publishStatus === 'not_started') store.publishStatus = 'draft';
  return saveStorefront(store);
}

// ─── Mock AI policy generator ─────────────────────────────────────────────────
export function generatePolicyDraft(type: StorePolicy['type'], storeName: string): string {
  const disclaimer = '\n\n⚠️ This draft was generated for reference only and is not legal advice. Please review with a qualified professional before publishing.';
  const templates: Record<string, string> = {
    shipping: `SHIPPING POLICY\n\nWe process all orders within 2–5 business days. Shipping times vary by location.\n\nDomestic orders typically arrive in 5–10 business days. International orders may take 2–4 weeks.\n\nTracking information is emailed once your order ships.${disclaimer}`,
    return: `RETURN POLICY\n\nWe accept returns within 30 days of delivery for unworn, unwashed items in original condition with all tags attached.\n\nTo initiate a return, contact us at the email provided. Sale items are final sale and not eligible for return.${disclaimer}`,
    refund: `REFUND POLICY\n\nOnce we receive your return and inspect the item, we will process a refund to your original payment method within 5–10 business days.\n\nShipping costs are non-refundable unless the return is due to our error.${disclaimer}`,
    privacy: `PRIVACY POLICY\n\n${storeName} collects information you provide when placing orders, including name, email, and shipping address. We use this information to fulfill orders and communicate with you.\n\nWe do not sell your information to third parties.${disclaimer}`,
    terms: `TERMS OF SERVICE\n\nBy purchasing from ${storeName}, you agree to these terms. We reserve the right to refuse service, cancel orders, or limit quantities at our discretion.\n\nPrices and availability are subject to change without notice.${disclaimer}`,
    pre_order: `PRE-ORDER POLICY\n\nPre-order items are charged at the time of purchase. Estimated delivery dates are provided but not guaranteed.\n\nIf we are unable to fulfill a pre-order within 90 days of the estimated date, you may request a full refund.${disclaimer}`,
  };
  return templates[type] ?? `${type.toUpperCase()} POLICY\n\nContent coming soon.${disclaimer}`;
}
