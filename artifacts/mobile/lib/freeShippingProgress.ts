/**
 * Pure math + copy for the bag's free-shipping strip (components/cart/
 * FreeShippingStrip.tsx). The threshold comes from the server
 * (GET /api/shipping-rates/free-shipping); the subtotal is the seller
 * group's own subtotal, since each bag section is one order.
 */
import { formatCents } from './money';

export type FreeShippingProgress = {
  /** Cents still to add before shipping is free; 0 once qualified. */
  remainingCents: number;
  /** 0..1, how far the subtotal is toward the threshold. */
  progress: number;
  qualified: boolean;
};

/** null when the seller has no threshold (no strip). */
export function freeShippingProgress(subtotalCents: number, thresholdCents: number | null | undefined): FreeShippingProgress | null {
  if (typeof thresholdCents !== 'number' || !Number.isFinite(thresholdCents) || thresholdCents <= 0) return null;
  const subtotal = Math.max(0, Math.round(subtotalCents) || 0);
  const remainingCents = Math.max(0, Math.round(thresholdCents) - subtotal);
  return {
    remainingCents,
    progress: Math.min(1, subtotal / thresholdCents),
    qualified: remainingCents === 0,
  };
}

export function freeShippingLine(progress: FreeShippingProgress, sellerName: string): string {
  return progress.qualified
    ? `This order ships free from ${sellerName}`
    : `Spend ${formatCents(progress.remainingCents)} more for free shipping from ${sellerName}`;
}
