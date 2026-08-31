import type { OrderStatus } from './orderTypes';

export const BUYER_CANCELLATION_WINDOW_MS = 21 * 24 * 60 * 60 * 1000;
export const BUYER_CANCELLABLE_STATUSES: OrderStatus[] = ['new', 'processing', 'ready_to_ship'];

export function canBuyerCancel(status: OrderStatus, createdAt: string, nowMs = Date.now()): boolean {
  return BUYER_CANCELLABLE_STATUSES.includes(status)
    && nowMs - new Date(createdAt).getTime() <= BUYER_CANCELLATION_WINDOW_MS;
}