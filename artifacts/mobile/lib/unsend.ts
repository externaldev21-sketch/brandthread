/**
 * Unsend (polish #166), Instagram's long-press "Unsend": your own message,
 * taken back for everyone, within 10 minutes of sending. The server enforces
 * the same window (DELETE /api/conversations/:id/messages/:messageId).
 */
export const UNSEND_WINDOW_MS = 10 * 60_000;
const SERVER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function canUnsend(
  msg: { id: string; ts?: number; status?: string } | null | undefined,
  isOwn: boolean,
  now = Date.now(),
): boolean {
  if (!msg || !isOwn || !SERVER_ID.test(msg.id)) return false;
  if (msg.status === 'failed' || msg.status === 'sending') return false;
  return typeof msg.ts === 'number' && now - msg.ts < UNSEND_WINDOW_MS;
}
