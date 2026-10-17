// ─── Store Settings ↔ server (GET/PUT /api/store) ─────────────────────────────
// The server is the source of truth for Store Settings: storefronts.title,
// storefronts.slug (the real store URL) and storefronts.storeSettings. The
// store password is never sent inside storeSettings — it goes to
// PUT /api/store/password and is stored hashed; the server only reports
// `hasStorePassword`.

import { api } from '@/lib/api';
import { StoreSettings } from './storeTypes';
import { cacheStorefrontLocally } from './storeService';

/** storeSettings keys persisted in the storefronts.storeSettings JSON column. */
export const SERVER_SETTING_KEYS = [
  'contactEmail', 'supportEmail', 'currency', 'language', 'timezone',
  'measurementUnit', 'storeStatus', 'passwordProtected',
  'checkoutRequireAccount', 'checkoutGuestAllowed', 'orderNotifications',
  'analyticsEnabled',
] as const satisfies readonly (keyof StoreSettings)[];

export const STORE_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

/** Client-side mirror of the server slug rules (server re-validates). */
export function validateSlugInput(input: string): string | null {
  const slug = input.trim().toLowerCase();
  if (slug.length < 3 || slug.length > 40) return 'Store URL must be 3-40 characters.';
  if (!STORE_SLUG_RE.test(slug) || slug.includes('--')) {
    return 'Use only lowercase letters, numbers and single hyphens (not at the start or end).';
  }
  return null;
}

/** Bare slug from a stored URL value ("brand", "brand.brandthread.app", "https://…"). */
export function slugFromStoreUrl(value: string | undefined | null): string {
  return String(value ?? '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\.brandthread\.app.*$/i, '')
    .replace(/\/.*$/, '')
    .toLowerCase();
}

export type RemoteStore = {
  title?: string | null;
  slug?: string | null;
  storeSettings?: Record<string, unknown> | null;
  hasStorePassword?: boolean;
};

/** Merge server state over a local/default form. Server wins for every key it has. */
export function settingsFromServer(remote: RemoteStore, base: StoreSettings): StoreSettings & { hasStorePassword: boolean } {
  const server = (remote.storeSettings && typeof remote.storeSettings === 'object') ? remote.storeSettings : {};
  const next: StoreSettings = { ...base, storePassword: '' };
  for (const key of SERVER_SETTING_KEYS) {
    if (key in server && server[key] !== undefined && server[key] !== null) {
      (next as unknown as Record<string, unknown>)[key] = server[key];
    }
  }
  if (typeof remote.title === 'string' && remote.title && remote.title !== 'My Store') next.storeName = remote.title;
  if (remote.slug) next.storeUrl = remote.slug;
  return { ...next, hasStorePassword: remote.hasStorePassword === true };
}

/** storeSettings payload for PUT /api/store — merges over existing server keys, never includes the password. */
export function settingsToServer(form: StoreSettings, existing: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const { storePassword: _pw, hasStorePassword: _has, ...prior } = (existing ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = { ...prior };
  for (const key of SERVER_SETTING_KEYS) out[key] = form[key];
  return out;
}

export async function loadStoreSettings(base: StoreSettings): Promise<StoreSettings & { hasStorePassword: boolean }> {
  const remote = await api.store.get() as RemoteStore;
  const merged = settingsFromServer(remote, base);
  const { hasStorePassword: _h, storePassword: _p, ...cache } = merged;
  await cacheStorefrontLocally(s => { s.settings = { ...s.settings, ...cache }; }).catch(() => {});
  return merged;
}

/**
 * Persist Store Settings. Throws (with the server's message) on any failure so
 * the screen never claims "Saved" for data that only lives on the phone.
 */
export async function saveStoreSettings(
  form: StoreSettings,
  opts: { currentSlug: string; hasStorePassword: boolean },
): Promise<{ slug: string; hasStorePassword: boolean }> {
  const typed = form.storePassword ?? '';
  if (form.passwordProtected && !typed && !opts.hasStorePassword) {
    throw new Error('Enter a store password to turn on password protection.');
  }
  const remote = await api.store.get() as RemoteStore;

  let slug = opts.currentSlug;
  const wantedSlug = slugFromStoreUrl(form.storeUrl);
  if (wantedSlug && wantedSlug !== opts.currentSlug) {
    const err = validateSlugInput(wantedSlug);
    if (err) throw new Error(err);
    slug = (await api.store.setSlug(wantedSlug)).slug;
  }

  await api.store.save({
    ...(form.storeName.trim() ? { title: form.storeName.trim() } : {}),
    storeSettings: settingsToServer(form, remote.storeSettings),
  });

  let hasStorePassword = opts.hasStorePassword;
  if (form.passwordProtected && typed) {
    hasStorePassword = (await api.store.setPassword(typed)).hasStorePassword;
  } else if (!form.passwordProtected && opts.hasStorePassword) {
    hasStorePassword = (await api.store.setPassword(null)).hasStorePassword;
  }

  const { storePassword: _p, ...cache } = form;
  await cacheStorefrontLocally(s => { s.settings = { ...s.settings, ...cache, storeUrl: slug }; }).catch(() => {});
  return { slug, hasStorePassword };
}
