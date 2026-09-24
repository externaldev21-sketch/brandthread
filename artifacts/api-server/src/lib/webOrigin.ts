/** Public browser origin used by links and hosted-flow callbacks. */
export const CANONICAL_WEB_ORIGIN = "https://brandthread.app";

/**
 * Keep local/preview flows on their active Replit domain, but make published
 * flows independent of whichever generated deployment hostname Replit exposes.
 */
export function getWebOrigin(localFallback = CANONICAL_WEB_ORIGIN): string {
  const isPublished =
    process.env.NODE_ENV === "production" ||
    Boolean(process.env.REPLIT_DEPLOYMENT_DOMAIN || process.env.REPLIT_INTERNAL_APP_DOMAIN);
  if (isPublished) return CANONICAL_WEB_ORIGIN;

  const domain = process.env.REPLIT_DEV_DOMAIN?.trim();
  return domain ? `https://${domain}` : localFallback;
}

/**
 * Every browser origin the API should accept credentialed (cookie-bearing)
 * requests from. Every first-party web artifact in this monorepo
 * (brandthread-woven, manufacturer-portal, app-tour, ...) is served under the
 * same host as the API via Replit's path-based routing, so a single origin
 * per environment covers them all. Requests with no Origin header (native
 * mobile clients, curl, server-to-server calls) are not subject to CORS and
 * are handled separately by isAllowedWebOrigin.
 */
export function allowedWebOrigins(): string[] {
  const origins = new Set<string>([CANONICAL_WEB_ORIGIN]);

  const devDomain = process.env.REPLIT_DEV_DOMAIN?.trim();
  if (devDomain) origins.add(`https://${devDomain}`);

  const deploymentDomain = process.env.REPLIT_DEPLOYMENT_DOMAIN?.trim();
  if (deploymentDomain) origins.add(`https://${deploymentDomain}`);

  const internalDomain = process.env.REPLIT_INTERNAL_APP_DOMAIN?.trim();
  if (internalDomain) origins.add(`https://${internalDomain}`);

  if (process.env.NODE_ENV !== "production") {
    // Local dev servers (vite/next) proxy to the API on the same machine.
    origins.add("http://localhost:5000");
    origins.add("http://127.0.0.1:5000");
  }

  return [...origins];
}

/**
 * CORS origin check for credentialed requests. `origin` is `undefined` for
 * requests without an Origin header — non-browser clients (native mobile,
 * curl, server-to-server) are not subject to CORS enforcement in the first
 * place, so those are allowed through; everything else must be an exact
 * match against the known, first-party web origins for this environment.
 */
export function isAllowedWebOrigin(origin: string | undefined | null): boolean {
  if (!origin) return true;
  return allowedWebOrigins().includes(origin);
}