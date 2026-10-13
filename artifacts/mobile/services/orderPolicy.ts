import type { OrderStatus } from './orderTypes';

export const BUYER_CANCELLATION_WINDOW_MS = 21 * 24 * 60 * 60 * 1000;
export const BUYER_CANCELLABLE_STATUSES: OrderStatus[] = ['new', 'processing', 'ready_to_ship'];

/**
 * `deadline` is the server's `buyerCancelDeadline` (the seller-set window,
 * item 129). When the server sent it, it wins; older responses fall back to
 * the 21-day default.
 */
export function canBuyerCancel(status: OrderStatus, createdAt: string, nowMs = Date.now(), deadline?: string | null): boolean {
  if (!BUYER_CANCELLABLE_STATUSES.includes(status)) return false;
  const deadlineMs = deadline ? new Date(deadline).getTime() : NaN;
  if (Number.isFinite(deadlineMs)) return nowMs <= deadlineMs;
  return nowMs - new Date(createdAt).getTime() <= BUYER_CANCELLATION_WINDOW_MS;
}
