/**
 * Pure bag-sync rules behind services/cartService.ts (no storage, no network,
 * so each rule is unit-tested on its own — see services/__tests__/cartSync.test.ts).
 *
 * Model: when signed in, the server bag (GET /api/buyer/cart) is the source of
 * truth and AsyncStorage is a cache. The one exception is a local edit that
 * never reached the server (the `dirty` flag): that local bag wins and is
 * pushed first, so an offline edit is never thrown away by a stale server copy.
 */
import type { Cart, CartItem, SavedCartItem } from './cartTypes';

/** Same prefix as lib/previewProducts.isPreviewProductId — inlined so this
 *  module stays free of React Native imports (and testable as plain TS). */
const isPreviewProductId = (id: unknown): boolean => typeof id === 'string' && id.startsWith('preview-product-');

/** Catalog fields the server adds to each line on read (never stored). */
export interface CartLiveFields {
  priceCents: number;
  compareAtPriceCents: number | null;
  stock: number;
  available: boolean;
  reason: 'out_of_stock' | 'unavailable' | null;
  priceChanged: boolean;
}

/** `null` = never tracked (a bag cached before this flag existed). */
export type CartDirtyState = '1' | '0' | null;

export const OUT_OF_STOCK_REASON = 'Out of stock — remove or save for later';
export const NO_LONGER_AVAILABLE_REASON = 'No longer available — remove or save for later';

const isCents = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v);

function readLive(raw: unknown): CartLiveFields | null {
  if (!raw || typeof raw !== 'object') return null;
  const l = raw as Partial<CartLiveFields>;
  if (!isCents(l.priceCents) || typeof l.stock !== 'number' || typeof l.available !== 'boolean') return null;
  return {
    priceCents: l.priceCents,
    compareAtPriceCents: isCents(l.compareAtPriceCents) ? l.compareAtPriceCents : null,
    stock: Math.max(0, Math.floor(l.stock)),
    available: l.available,
    reason: l.reason === 'out_of_stock' || l.reason === 'unavailable' ? l.reason : null,
    priceChanged: l.priceChanged === true,
  };
}

/**
 * Apply the server's live catalog fields onto one bag line and drop `live`.
 * - available → isAvailable (+ the reason the bag's warning shows)
 * - stock → maxQuantity (the bag's "Only N left" / stepper cap)
 * - current price (sale included) → priceCents / compareAtPriceCents
 * A line without `live` (older server, catalog read failed) and a dev-web
 * preview product are returned untouched apart from dropping `live`.
 */
export function applyLiveFields<T extends CartItem | SavedCartItem>(line: T & { live?: unknown }): T {
  const { live: rawLive, ...rest } = line;
  const item = rest as unknown as T;
  const live = readLive(rawLive);
  if (!live || isPreviewProductId(item.productId)) return item;
  const productGone = !live.available && live.reason === 'unavailable';
  const next: T = {
    ...item,
    isAvailable: live.available,
    unavailableReason: live.available
      ? undefined
      : productGone ? NO_LONGER_AVAILABLE_REASON : OUT_OF_STOCK_REASON,
  };
  if (live.stock > 0) next.maxQuantity = live.stock;
  if (!productGone) {
    next.priceCents = live.priceCents;
    next.compareAtPriceCents = live.compareAtPriceCents ?? undefined;
  }
  return next;
}

/** Copy live fields from server lines onto local lines with the same variant. */
function applyServerLiveByVariant<T extends CartItem | SavedCartItem>(local: T[], server: unknown[]): T[] {
  const liveByVariant = new Map<string, unknown>();
  for (const s of server) {
    const v = (s as { variantId?: unknown })?.variantId;
    const live = (s as { live?: unknown })?.live;
    if (typeof v === 'string' && live) liveByVariant.set(v, live);
  }
  return local.map(item => {
    const live = liveByVariant.get(item.variantId);
    return live ? applyLiveFields({ ...item, live }) : item;
  });
}

function validLines<T>(lines: unknown): T[] {
  return (Array.isArray(lines) ? lines : []).filter(
    (l): l is T => !!l && typeof l === 'object' && isCents((l as { priceCents?: unknown }).priceCents),
  );
}

export interface CartLoadDecision {
  cart: Cart;
  /** The local bag holds edits the server lacks: push it now. */
  push: boolean;
  /** The server answered, so the bag shown is confirmed. */
  remoteConfirmed: boolean;
}

/**
 * Decide which bag to show after a load.
 * - server unreachable (`server` null): the local cache, unconfirmed
 * - local dirty: the local bag (with any live fields the server knows), push it
 * - never tracked, server empty, local not: an older build's bag the server
 *   never got — keep and push it instead of wiping it
 * - otherwise: the server bag, even when empty (emptied on another device)
 */
export function reconcileCartLoad(input: {
  local: Cart;
  dirty: CartDirtyState;
  server: { items: unknown; savedItems: unknown } | null;
}): CartLoadDecision {
  const { local, dirty, server } = input;
  if (!server) return { cart: local, push: false, remoteConfirmed: false };
  const serverItems = validLines<CartItem & { live?: unknown }>(server.items);
  const serverSaved = validLines<SavedCartItem & { live?: unknown }>(server.savedItems);
  const localHasLines = local.items.length > 0 || local.savedItems.length > 0;
  const serverEmpty = serverItems.length === 0 && serverSaved.length === 0;

  if (dirty === '1' || (dirty === null && serverEmpty && localHasLines)) {
    return {
      cart: {
        ...local,
        items: applyServerLiveByVariant(local.items, serverItems),
        savedItems: applyServerLiveByVariant(local.savedItems, serverSaved),
      },
      push: true,
      remoteConfirmed: true,
    };
  }
  return {
    cart: {
      ...local,
      items: serverItems.map(i => applyLiveFields<CartItem>(i)),
      savedItems: serverSaved.map(i => applyLiveFields<SavedCartItem>(i)),
    },
    push: false,
    remoteConfirmed: true,
  };
}

/**
 * Fold a signed-out (guest) bag into the signed-in bag: a variant already in
 * the bag keeps the higher quantity (never double-counted), new variants are
 * appended; saved-for-later lines merge the same way.
 */
export function mergeGuestLines(cart: Cart, guest: Cart): Cart {
  const items = cart.items.map(i => ({ ...i }));
  for (const g of guest.items) {
    const idx = items.findIndex(i => i.variantId === g.variantId);
    if (idx >= 0) {
      if (g.quantity > items[idx].quantity) items[idx] = { ...items[idx], quantity: g.quantity };
    } else {
      items.push({ ...g });
    }
  }
  const savedItems = cart.savedItems.map(i => ({ ...i }));
  for (const g of guest.savedItems) {
    if (items.some(i => i.variantId === g.variantId)) continue;
    if (savedItems.some(i => i.variantId === g.variantId)) continue;
    savedItems.push({ ...g });
  }
  return { ...cart, items, savedItems };
}

/**
 * Serialized full-replace sync: at most one request in flight; payloads
 * scheduled meanwhile collapse into one trailing send of the latest bag, so
 * an older bag can never land after a newer one. Resolves true when the
 * latest payload reached the server, false when a send failed (the caller
 * keeps the bag dirty and retries on the next load / foreground).
 */
export function createSerialSync<P>(send: (payload: P) => Promise<void>) {
  let inFlight: Promise<boolean> | null = null;
  let pending: { payload: P } | null = null;

  async function drain(): Promise<boolean> {
    let ok = true;
    while (pending) {
      const { payload } = pending;
      pending = null;
      try {
        await send(payload);
        ok = true;
      } catch {
        ok = false;
        // Anything scheduled during the failed send is newer: still try it.
      }
    }
    return ok;
  }

  return {
    schedule(payload: P): Promise<boolean> {
      pending = { payload };
      if (!inFlight) {
        inFlight = drain().finally(() => { inFlight = null; });
      }
      return inFlight;
    },
    /** For tests / callers that must wait for the queue to settle. */
    idle(): Promise<boolean> {
      return inFlight ?? Promise.resolve(true);
    },
  };
}
