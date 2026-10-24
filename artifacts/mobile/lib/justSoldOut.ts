/**
 * "Just sold out": a variant another buyer claimed while this buyer was
 * checking out. The server answers every buy path with 409 { code:
 * 'SOLD_OUT', variantId } before any charge (api-server
 * lib/money/stockReservation.ts). Checkout records the variant here, and the
 * PDP and the live Shop sheet read it so they flip to "Just sold out" without
 * waiting for a refetch. In-memory for this app session only: the server's
 * stock is the truth on the next load.
 */
import { useSyncExternalStore } from 'react';
import { ApiError } from '@/lib/networkNotice';

export const JUST_SOLD_OUT_LABEL = 'Just sold out';

export type SoldOutInfo = { variantId: string | null; productName: string | null; message: string };

/** The SOLD_OUT details from an API error, or null when it's any other failure. */
export function soldOutFromError(err: unknown): SoldOutInfo | null {
  if (!(err instanceof ApiError) || err.code !== 'SOLD_OUT') return null;
  let body: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(err.body);
    if (parsed && typeof parsed === 'object') body = parsed as Record<string, unknown>;
  } catch {
    // The code alone is enough to show the state.
  }
  const productName = typeof body.productName === 'string' ? body.productName : null;
  return {
    variantId: typeof body.variantId === 'string' ? body.variantId : null,
    productName,
    message: `${productName ?? 'An item in your order'} just sold out. Someone grabbed the last one first. We took it out of your bag. You haven’t been charged.`,
  };
}

const soldOut = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;

export function markJustSoldOut(variantId: string | null | undefined): void {
  if (!variantId || soldOut.has(variantId)) return;
  soldOut.add(variantId);
  version++;
  listeners.forEach(listener => listener());
}

export function isJustSoldOut(variantId: string | null | undefined): boolean {
  return !!variantId && soldOut.has(variantId);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Re-renders the caller whenever a variant is marked; read with isJustSoldOut. */
export function useJustSoldOutVersion(): number {
  return useSyncExternalStore(subscribe, () => version, () => version);
}

/** Test-only: forget every mark. */
export function resetJustSoldOut(): void {
  soldOut.clear();
  version++;
  listeners.forEach(listener => listener());
}
