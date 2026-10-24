/**
 * Why a buyer order screen (return / refund request) couldn't load its
 * order, so a bad link never reads as "Check your connection":
 *
 *  - no id, or an id that can't be an order (orders.id is a UUID) → 'invalid_link'
 *  - the server answered 404 / 403 (not this buyer's order) → 'not_found'
 *  - anything else → 'error', with friendlyError copy (the network message
 *    only for a real network failure).
 *
 * Pure, unit-tested in tests/order-load-error.test.ts.
 */
import { friendlyError } from '@/lib/friendlyError';
import { isMissingParam } from '@/lib/navigation/isMissingParam';

export type OrderLoadFailure =
  | { kind: 'invalid_link' }
  | { kind: 'not_found' }
  | { kind: 'error'; message: string };

export const ORDER_LOAD_FALLBACK = 'We couldn’t load this order. Try again.';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * True when the id can't name a real order. `allowNonUuid` keeps dev-preview
 * fixture ids ("preview-order-1") working.
 */
export function isInvalidOrderId(id: unknown, allowNonUuid = false): boolean {
  if (isMissingParam(id as string | string[] | undefined)) return true;
  if (typeof id !== 'string') return true;
  return !allowNonUuid && !UUID.test(id.trim());
}

function statusOf(err: unknown): number | null {
  const status = (err as { status?: unknown } | null)?.status;
  if (typeof status === 'number') return status;
  const match = /^API (\d{3}):/.exec((err as { message?: unknown } | null)?.message as string ?? '');
  return match ? Number(match[1]) : null;
}

export function classifyOrderLoadError(err: unknown, fallback = ORDER_LOAD_FALLBACK): OrderLoadFailure {
  const status = statusOf(err);
  if (status === 404 || status === 403) return { kind: 'not_found' };
  return { kind: 'error', message: friendlyError(err, fallback) };
}
