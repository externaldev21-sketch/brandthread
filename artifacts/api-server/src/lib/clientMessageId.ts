/**
 * Client message ids make POST /api/conversations/:id/messages idempotent.
 *
 * The mobile offline outbox gives every outgoing message an id before the
 * first attempt and reuses it on every retry. When a retry reaches the server
 * after an earlier attempt was already stored (the response was lost on a
 * dropped connection), the route returns that stored row instead of inserting
 * a second copy. Uniqueness is per (conversation, sender, id), enforced by the
 * partial unique index from migration 263.
 *
 * Anything that isn't a short opaque token is ignored (treated as "no id"),
 * so a malformed value can never fail a send.
 */
const CLIENT_MESSAGE_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

export function parseClientMessageId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  return CLIENT_MESSAGE_ID_PATTERN.test(raw) ? raw : null;
}
