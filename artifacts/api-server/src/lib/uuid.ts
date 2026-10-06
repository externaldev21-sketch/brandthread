/**
 * Postgres `uuid` columns throw "invalid input syntax for type uuid" when a
 * query compares them to anything else, which surfaces as a 500. Public link
 * handlers check the id first so a malformed share link is a plain 404.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}
