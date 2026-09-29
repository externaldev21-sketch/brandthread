/**
 * Module-scoped mutation store for the seller fresh-preview session
 * (?bt_preview=seller, with or without `demo=1` — lib/devPreview.ts's
 * isSellerDevPreview()).
 *
 * Fresh preview has no real account and no token, so mutations that would
 * normally hit the API (create a discount, go live, edit the storefront)
 * have nowhere real to land. Products already have a working local-first
 * store for this (services/productService.ts is AsyncStorage-backed and
 * starts empty regardless of account — see its own header comment); this
 * module follows the same AsyncStorage-backed, local-first pattern for the
 * handful of seller actions that don't have their own store: discounts,
 * going live, and storefront copy — so a preview seller who adds one of
 * these sees it reflected immediately, on every screen that reads it, and
 * it survives a reload the same way a real seller's data would, instead of
 * silently vanishing the moment the tab refreshes.
 *
 * The in-memory `state` stays as the synchronous read path every existing
 * call site (`getPreviewDiscounts()` etc.) already relies on; `hydrate()`
 * loads it from AsyncStorage once at module init (best-effort, notifies
 * listeners when it resolves) and every mutation persists back to
 * AsyncStorage (fire-and-forget — never blocks the caller). Scoped to one
 * shared key: preview sessions have no real account to key by, and this
 * data is explicitly throwaway scaffolding, never real user data, so it's
 * fine for a fresh `?bt_preview=seller` session on the same device to pick
 * up where a previous one left off. Never imported by non-preview code
 * paths.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface PreviewDiscount {
  id: string;
  code: string;
  type: 'percentage' | 'fixed' | 'free_shipping' | 'free_item';
  value: number;
  minOrderCents: number;
  appliesTo: 'entire_store' | 'specific_products';
  productIds: string[];
  maxUses: number | null;
  usesCount: number;
  oneUsePerCustomer: boolean;
  startsAt: string | null;
  expiresAt: string | null;
  active: boolean;
  status: 'active' | 'scheduled' | 'paused' | 'expired' | 'exhausted';
  createdAt: string;
}

export interface PreviewLiveSession {
  id: string;
  title: string;
  startedAt: string;
  endedAt: string | null;
  peakViewers: number;
}

export interface PreviewStorefront {
  headline: string | null;
  bio: string | null;
  updatedAt: string | null;
}

interface PreviewSellerFreshState {
  discounts: PreviewDiscount[];
  liveSessions: PreviewLiveSession[];
  storefront: PreviewStorefront;
}

function initialState(): PreviewSellerFreshState {
  return { discounts: [], liveSessions: [], storefront: { headline: null, bio: null, updatedAt: null } };
}

let state: PreviewSellerFreshState = initialState();

const STORAGE_KEY = 'bt_preview_seller_fresh_store_v1';

function persist(): void {
  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state)).catch(() => { /* non-fatal — stays in memory for this session */ });
}

// Best-effort hydrate from a previous session on this device. Fire-and-forget
// at module load; every call site already reads the synchronous in-memory
// `state`, so this only matters for whichever renders happen to occur after
// it resolves (typically well before the user reaches a preview screen).
AsyncStorage.getItem(STORAGE_KEY)
  .then((raw) => {
    if (!raw) return;
    const parsed = JSON.parse(raw) as Partial<PreviewSellerFreshState>;
    state = {
      discounts: Array.isArray(parsed.discounts) ? parsed.discounts : [],
      liveSessions: Array.isArray(parsed.liveSessions) ? parsed.liveSessions : [],
      storefront: parsed.storefront ?? { headline: null, bio: null, updatedAt: null },
    };
    notify();
  })
  .catch(() => { /* non-fatal — starts from initialState() */ });

type Listener = () => void;
const listeners = new Set<Listener>();
function notify(): void {
  persist();
  listeners.forEach((l) => l());
}

/** Subscribe to any change in the preview seller store; returns an unsubscribe fn. */
export function subscribePreviewSellerFreshStore(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// ─── Discounts ──────────────────────────────────────────────────────────────

export function getPreviewDiscounts(): PreviewDiscount[] {
  return state.discounts;
}

export function addPreviewDiscount(discount: PreviewDiscount): void {
  state = { ...state, discounts: [discount, ...state.discounts] };
  notify();
}

export function updatePreviewDiscount(id: string, patch: Partial<PreviewDiscount>): PreviewDiscount | null {
  let updated: PreviewDiscount | null = null;
  state = {
    ...state,
    discounts: state.discounts.map((d) => {
      if (d.id !== id) return d;
      updated = { ...d, ...patch };
      return updated;
    }),
  };
  notify();
  return updated;
}

export function deletePreviewDiscount(id: string): void {
  state = { ...state, discounts: state.discounts.filter((d) => d.id !== id) };
  notify();
}

// ─── Live sessions ──────────────────────────────────────────────────────────

export function getPreviewLiveSessions(): PreviewLiveSession[] {
  return state.liveSessions;
}

export function startPreviewLiveSession(title: string): PreviewLiveSession {
  const session: PreviewLiveSession = {
    id: 'preview_live_' + Math.random().toString(36).slice(2, 11),
    title,
    startedAt: new Date().toISOString(),
    endedAt: null,
    peakViewers: 0,
  };
  state = { ...state, liveSessions: [session, ...state.liveSessions] };
  notify();
  return session;
}

export function endPreviewLiveSession(id: string): void {
  state = {
    ...state,
    liveSessions: state.liveSessions.map((s) => (s.id === id ? { ...s, endedAt: new Date().toISOString() } : s)),
  };
  notify();
}

// ─── Storefront ─────────────────────────────────────────────────────────────

export function getPreviewStorefront(): PreviewStorefront {
  return state.storefront;
}

export function setPreviewStorefront(patch: Partial<Omit<PreviewStorefront, 'updatedAt'>>): void {
  state = { ...state, storefront: { ...state.storefront, ...patch, updatedAt: new Date().toISOString() } };
  notify();
}

/** Test-only: reset every preview seller mutation back to a clean session. */
export function resetPreviewSellerFreshStore(): void {
  state = initialState();
  notify();
}
