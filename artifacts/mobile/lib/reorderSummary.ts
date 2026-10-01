/**
 * Pure helpers for the order-history "Reorder" flow: the wire types returned by
 * POST /api/buyer/orders/:id/reorder and the wording shown after a reorder.
 * No React, no I/O — unit-tested in lib/__tests__/reorderSummary.test.ts.
 */
import { formatCents } from '@/lib/money';

export type ReorderUnavailableReason = 'out_of_stock' | 'discontinued' | 'variant_removed';

export interface ReorderAddable {
  productId: string;
  variantId: string;
  quantity: number;
  requestedQuantity?: number;
  quantityClamped?: boolean;
  currentPriceCents: number;
  priceChanged: boolean;
  previousPriceCents: number;
}

export interface ReorderUnavailable {
  productId: string | null;
  title: string;
  reason: ReorderUnavailableReason;
}

export interface ReorderResolution {
  addable: ReorderAddable[];
  unavailable: ReorderUnavailable[];
}

/** What actually happened once the addable lines were put in the cart. */
export interface ReorderOutcome {
  /** Units put in the cart (sum of quantities). */
  addedUnits: number;
  addedLines: number;
  unavailable: ReorderUnavailable[];
  priceChanges: Array<{ title: string; previousPriceCents: number; currentPriceCents: number }>;
  /** Lines whose quantity was lowered to what is in stock. */
  reducedQuantityTitles: string[];
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "3 items added · 1 unavailable" */
export function summarizeReorder(outcome: Pick<ReorderOutcome, 'addedUnits' | 'unavailable'>): string {
  const unavailableCount = outcome.unavailable.length;
  if (outcome.addedUnits <= 0) {
    return unavailableCount > 0
      ? `Nothing to reorder · ${unavailableCount} unavailable`
      : 'Nothing to reorder';
  }
  const added = `${plural(outcome.addedUnits, 'item', 'items')} added`;
  return unavailableCount > 0 ? `${added} · ${unavailableCount} unavailable` : added;
}

/** Sheet-row reason copy. */
export function unavailableReasonLabel(reason: ReorderUnavailableReason): string {
  switch (reason) {
    case 'out_of_stock': return 'Out of stock';
    case 'discontinued': return 'No longer sold';
    case 'variant_removed': return 'This size or colour is no longer offered';
    default: return 'Unavailable';
  }
}

/** "Price is now $45.00 (was $40.00)" */
export function priceChangeNote(change: { previousPriceCents: number; currentPriceCents: number }): string {
  return `Now ${formatCents(change.currentPriceCents)} (was ${formatCents(change.previousPriceCents)})`;
}

/** Whether the partial-availability sheet has anything to tell the buyer. */
export function reorderNeedsReview(outcome: ReorderOutcome): boolean {
  return outcome.unavailable.length > 0 || outcome.priceChanges.length > 0 || outcome.reducedQuantityTitles.length > 0;
}

/** Only delivered orders offer Reorder (mobile status vocabulary). */
export function canReorderStatus(status: string): boolean {
  return status === 'delivered';
}
