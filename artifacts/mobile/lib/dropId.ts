/**
 * Drop ids are database uuids (lib/db schema `drops.id`). Anything else —
 * e.g. a hand-typed /drops/demo link — can never resolve, so screens treat it
 * as "not found" up front instead of asking the API (which rejects a non-uuid
 * id as a server error, not a 404).
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isWellFormedDropId(id: string | null | undefined): boolean {
  return typeof id === 'string' && UUID_RE.test(id.trim());
}
