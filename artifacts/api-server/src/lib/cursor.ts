/**
 * Keyset ("cursor") pagination helpers.
 *
 * OFFSET pagination makes Postgres read and discard every skipped row, so page
 * N costs O(N) and gets slower the deeper a user scrolls. A cursor names the
 * last row seen, `(timestamp, id)`, and the next page is an index range scan.
 *
 * The timestamp is carried as the exact text Postgres produced
 * (`created_at::text`, microsecond precision), never round-tripped through a JS
 * Date, which truncates to milliseconds and would skip or repeat rows that share
 * a millisecond.
 */
const TS_PATTERN = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d{1,6})?$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type KeysetCursor = { ts: string; id: string };

export function encodeCursor(cursor: KeysetCursor): string {
  return Buffer.from(JSON.stringify([cursor.ts, cursor.id]), "utf8").toString("base64url");
}

/** Returns null for anything that is not a cursor this module produced. */
export function decodeCursor(value: unknown): KeysetCursor | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 200) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!Array.isArray(parsed) || parsed.length !== 2) return null;
    const [ts, id] = parsed;
    if (typeof ts !== "string" || typeof id !== "string") return null;
    if (!TS_PATTERN.test(ts) || !UUID_PATTERN.test(id)) return null;
    return { ts, id };
  } catch {
    return null;
  }
}
