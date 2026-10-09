import helmet from "helmet";
import type { RequestHandler } from "express";

/** Deny-everything policy for JSON bodies: they never run scripts or load sub-resources. */
export const JSON_CSP =
  "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

/**
 * Baseline security headers for every response. CSP is left to the
 * server-rendered HTML pages (profile landing, bio, giveaway, IP notice each
 * send their own policy); JSON responses get JSON_CSP unless a route set one.
 */
export function securityHeaders(
  env: string | undefined = process.env.NODE_ENV,
): RequestHandler[] {
  return [
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
      // Leaves window.opener intact for OAuth/Stripe popups opened from our pages.
      crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
      crossOriginResourcePolicy: { policy: "same-site" },
      frameguard: { action: "deny" },
      referrerPolicy: { policy: "strict-origin-when-cross-origin" },
      strictTransportSecurity:
        env === "production"
          ? { maxAge: 63072000, includeSubDomains: true, preload: true }
          : false,
    }),
    (_req, res, next) => {
      res.setHeader("Permissions-Policy", "geolocation=(), camera=(), microphone=()");
      const json = res.json.bind(res);
      res.json = (body?: unknown) => {
        if (!res.headersSent && !res.getHeader("Content-Security-Policy")) {
          res.setHeader("Content-Security-Policy", JSON_CSP);
        }
        return json(body);
      };
      next();
    },
  ];
}
