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