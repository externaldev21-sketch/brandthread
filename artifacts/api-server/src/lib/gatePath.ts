/**
 * Express routing is case-insensitive and non-strict by default, so
 * `/logo/generate`, `/Logo/Generate`, `/logo/generate/` and `/logo//generate`
 * all reach the same handler. Every gate that decides by path (AI credits,
 * rate-limit policies, body limits) must match the same canonical form, or a
 * variant spelling walks past the gate and still runs the paid handler.
 *
 * Canonical form: lowercase, repeated slashes collapsed, trailing slashes
 * stripped (the root stays "/"). The query string is never part of it.
 */
export function normalizeGatePath(path: string): string {
  const withoutQuery = path.split("?")[0] ?? "";
  const collapsed = withoutQuery.toLowerCase().replace(/\/{2,}/g, "/");
  const trimmed = collapsed.replace(/\/+$/, "");
  if (!trimmed) return "/";
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}
