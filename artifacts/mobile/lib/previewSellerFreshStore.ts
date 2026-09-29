/**
 * In-memory, module-scoped mutation store for the seller fresh-preview
 * session (?bt_preview=seller, no `demo=1` — lib/devPreview.ts's
 * isPreviewFreshMode()).
 *
 * Fresh preview has no real account and no token, so mutations that would
 * normally hit the API (create a discount, go live, edit the storefront)
 * have nowhere real to land. Products already have a working local-first
 * store for this (services/productService.ts is AsyncStorage-backed and
 * starts empty regardless of account — see its own header comment), so it
 * isn't duplicated here. This module covers the handful of seller actions
 * that don't have an existing local-first store: discounts, going live, and
 * storefront copy — so a fresh-preview seller who adds one of these sees it
 * reflected immediately, on every screen that reads it, for the rest of the
 * session, without inventing a second per-feature mechanism.
 *
 * Deliberately plain in-memory state (not AsyncStorage): the task only
 * requires mutations to persist "within the preview session" — surviving an
 * app reload is explicitly not required, and staying in-memory keeps this
 * preview-only scaffolding from ever leaking into a real device's storage.
 * Never imported by non-preview code paths.
 */

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

type Listener = () => void;
const listeners = new Set<Listener>();
function notify(): void {
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
