/**
 * Seller-issued refunds (POST /api/orders/:id/refund). The server owns the
 * money maths and the limits; this file turns what the seller typed into a
 * request and gives each attempt a stable id so a retry never refunds twice.
 */
import { formatCents, parseDecimalToCents } from '@/lib/money';

export const SELLER_REFUND_REASONS = [
  { key: 'item_damaged', label: 'Item damaged' },
  { key: 'item_missing', label: 'Item missing' },
  { key: 'wrong_item', label: 'Wrong item sent' },
  { key: 'shipping_delay', label: 'Shipping delay' },
  { key: 'price_adjustment', label: 'Price adjustment' },
  { key: 'goodwill', label: 'Goodwill' },
  { key: 'other', label: 'Other' },
] as const;

export type SellerRefundReason = (typeof SELLER_REFUND_REASONS)[number]['key'];

export interface SellerRefundRequest {
  amountCents: number;
  reason: SellerRefundReason;
  note?: string;
  requestId: string;
}

export interface SellerRefundResponse {
  refund: { refundId: string; amountCents: number; duplicate: boolean };
  refundedCents: number;
  refundableCents: number;
}

export interface OrderRefundRow {
  id: string;
  amountCents: number;
  reason: string;
  state: 'processing' | 'succeeded' | 'failed' | string;
  createdAt: string;
  succeededAt: string | null;
}

export interface OrderRefundsResponse {
  refundedCents: number;
  refundableCents: number;
  refunds: OrderRefundRow[];
}

/** A fresh id per refund attempt; reused for retries of that same attempt. */
export function newRefundRequestId(now: number = Date.now(), rand: () => number = Math.random): string {
  const r = Math.floor(rand() * 0xffffffff).toString(36);
  return `rf-${now.toString(36)}-${r}`.slice(0, 64);
}

/**
 * Parse the typed amount. Returns the cents, or an error to show under the
 * field. Amounts over what is left to refund are refused here too, so the
 * seller sees the limit before tapping Refund.
 */
export function parseRefundAmount(input: string, refundableCents: number):
  | { ok: true; cents: number }
  | { ok: false; error: string } {
  const text = input.trim().replace(/^\$/, '');
  if (!text) return { ok: false, error: 'Enter an amount' };
  const cents = parseDecimalToCents(text);
  if (cents === null || cents <= 0) return { ok: false, error: 'Enter an amount above $0' };
  if (cents > refundableCents) return { ok: false, error: `You can refund up to ${formatCents(refundableCents)}` };
  return { ok: true, cents };
}

export function refundReasonLabel(reason: string): string {
  if (reason === 'seller_refund') return 'Refund';
  if (reason === 'seller_cancelled' || reason === 'buyer_cancelled') return 'Cancellation refund';
  if (reason === 'return_approved') return 'Return refund';
  if (reason === 'not_delivered') return 'Not delivered';
  return SELLER_REFUND_REASONS.find((r) => r.key === reason)?.label ?? 'Refund';
}

/** Human message for a failed refund request. */
export function refundErrorMessage(err: unknown): string {
  const raw = (err as { body?: unknown })?.body;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as { error?: unknown };
      if (typeof parsed.error === 'string') return parsed.error;
    } catch { /* not JSON */ }
  }
  return "The refund couldn't be processed. Nothing was charged back. Try again.";
}
