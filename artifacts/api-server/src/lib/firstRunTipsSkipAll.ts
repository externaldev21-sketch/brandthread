/**
 * Parses the optional POST /skip-all body. Missing/empty body keeps the
 * original "turn on" behaviour for older clients.
 */
export function parseSkipAllBody(body: unknown): { ok: true; skipAll: boolean } | { ok: false; error: string } {
  if (body == null || typeof body !== "object") return { ok: true, skipAll: true };
  const value = (body as { skipAll?: unknown }).skipAll;
  if (value === undefined) return { ok: true, skipAll: true };
  if (typeof value !== "boolean") return { ok: false, error: "skipAll must be a boolean" };
  return { ok: true, skipAll: value };
}
