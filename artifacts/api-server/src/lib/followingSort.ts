/**
 * Pure mapping from the Following list's `?sort=` query param to a follow
 * direction — kept in its own dependency-free module so it's unit-testable
 * without a database connection (GET /api/social/following pulls in
 * `@workspace/db` at import time, which throws without DATABASE_URL — see
 * src/testUtils/dbFileScan.ts). "default" and "latest" are the same order
 * (most recently followed first); "earliest" reverses it.
 */
export function followingSortDirection(sortParam: unknown): "asc" | "desc" {
  return sortParam === "earliest" ? "asc" : "desc";
}
