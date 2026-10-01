import crypto from "node:crypto";

/**
 * Click privacy helpers. A click row keeps ONLY a coarse country code (taken
 * from a CDN/proxy header, never from a geo-IP lookup of a stored address) and
 * the referrer HOST. The client IP is used transiently to derive a salted,
 * day-rotating dedupe hash for the rate-limit bucket and is never persisted.
 */

const COUNTRY_HEADERS = ["cf-ipcountry", "cloudfront-viewer-country", "x-vercel-ip-country", "x-country-code", "x-appengine-country"];

export function countryFromHeaders(headers: Record<string, string | string[] | undefined>): string | null {
  for (const name of COUNTRY_HEADERS) {
    const raw = headers[name];
    const v = (Array.isArray(raw) ? raw[0] : raw)?.trim().toUpperCase();
    if (v && /^[A-Z]{2}$/.test(v) && v !== "XX" && v !== "T1" && v !== "ZZ") return v;
  }
  return null;
}

/** Host of the referrer (no path / query), without a leading www.; null if unusable or own-host. */
export function referrerHost(referer: string | undefined | null, ownHosts: string[] = []): string | null {
  if (!referer) return null;
  try {
    const host = new URL(referer).hostname.toLowerCase().replace(/^www\./, "");
    if (!host || host.length > 100) return null;
    if (ownHosts.some((h) => h.toLowerCase().replace(/^www\./, "") === host)) return null;
    return host;
  } catch {
    return null;
  }
}

/** Salted, per-day, non-reversible key used only as a transient rate-limit bucket id. */
export function clickDedupeKey(secret: string, ip: string, userAgent: string, scope: string, now = new Date()): string {
  const day = now.toISOString().slice(0, 10);
  return crypto.createHmac("sha256", secret).update(`${day}|${scope}|${ip}|${userAgent}`).digest("hex").slice(0, 32);
}
