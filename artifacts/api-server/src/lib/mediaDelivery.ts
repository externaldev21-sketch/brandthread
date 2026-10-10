/**
 * Public media without proxying bytes through Express (BT-473).
 *
 * The public media routes (post videos/images, product videos, profile cover
 * and avatar videos) used to pipe every byte from object storage through the
 * API. They still do every visibility and ACL check exactly as before, then:
 *
 *   redirect  302 to a short-lived V4 signed URL for the object
 *             (MEDIA_SIGNED_URL_TTL_SEC, default 15 min). With CDN_BASE_URL
 *             set, objectStorage rewrites that URL to the CDN host, so the
 *             CDN (Cloudflare in front of GCS, docs/scale/MEDIA_CDN.md)
 *             serves it. Range requests go straight to the signed URL.
 *   stream    the previous behavior: bytes through Express.
 *
 * MEDIA_DELIVERY=redirect|stream picks one. Unset: redirect in production or
 * when a CDN is configured, stream otherwise (local dev). If signing fails
 * (no object-storage sidecar), the route streams, so nothing breaks.
 *
 * The same signed URL is handed out for an object for most of its lifetime,
 * so viewers within that window share one URL and the CDN cache stays warm.
 * Only public media goes through here; DM and other private media keep their
 * own per-viewer signing (lib/dmMedia.ts in #752, routes/conversations.ts).
 */
import type { Response } from "express";
import { resolveCdnBase } from "./cdnUrl";
import { logger } from "./logger";

type Env = Record<string, string | undefined>;

export type MediaDeliveryMode = "redirect" | "stream";

export function mediaDeliveryMode(env: Env = process.env): MediaDeliveryMode {
  const raw = (env.MEDIA_DELIVERY ?? "").trim().toLowerCase();
  if (raw === "redirect" || raw === "stream") return raw;
  if (resolveCdnBase(env)) return "redirect";
  return env.NODE_ENV === "production" ? "redirect" : "stream";
}

export function signedUrlTtlSec(env: Env = process.env): number {
  const n = Number(env.MEDIA_SIGNED_URL_TTL_SEC);
  // GCS V4 signatures are valid for at most 7 days; keep it short anyway.
  return Number.isInteger(n) && n >= 120 && n <= 7 * 24 * 3600 ? n : 15 * 60;
}

/** Re-sign once less than this share of the TTL is left. */
const MIN_REMAINING_SHARE = 1 / 3;
/** Browsers/CDNs may reuse the redirect for at most this long. */
const MAX_REDIRECT_CACHE_SEC = 300;

export type MediaDecision =
  | { kind: "redirect"; url: string; cacheControl: string }
  | { kind: "stream" };

/** Pure: given the mode and (maybe) a signed URL with its expiry, what to send. */
export function decideMediaDelivery(input: {
  mode: MediaDeliveryMode;
  signed: { url: string; expiresAt: number } | null;
  now: number;
}): MediaDecision {
  if (input.mode !== "redirect" || !input.signed) return { kind: "stream" };
  const remainingSec = Math.floor((input.signed.expiresAt - input.now) / 1000);
  // Never let a cached redirect outlive the signature (60 s safety margin).
  const maxAge = Math.max(0, Math.min(MAX_REDIRECT_CACHE_SEC, remainingSec - 60));
  if (remainingSec <= 0) return { kind: "stream" };
  return {
    kind: "redirect",
    url: input.signed.url,
    cacheControl: maxAge > 0 ? `public, max-age=${maxAge}` : "no-store",
  };
}

export type Signer = (objectPath: string, ttlSec: number) => Promise<string>;

type CacheEntry = { url: string; expiresAt: number };

export class SignedMediaUrls {
  private readonly cache = new Map<string, CacheEntry>();
  private failingUntil = 0;
  private warned = false;

  constructor(private readonly opts: {
    sign: Signer;
    ttlSec?: number;
    max?: number;
    now?: () => number;
    /** After a signing failure, stream (do not retry signing) for this long. */
    cooldownMs?: number;
  }) {}

  /** A signed URL with at least a third of its life left, or null when signing is unavailable. */
  async get(objectPath: string): Promise<CacheEntry | null> {
    const now = (this.opts.now ?? Date.now)();
    const ttlMs = (this.opts.ttlSec ?? signedUrlTtlSec()) * 1000;
    const hit = this.cache.get(objectPath);
    if (hit && hit.expiresAt - now > ttlMs * MIN_REMAINING_SHARE) return hit;
    if (now < this.failingUntil) return null;
    try {
      const url = await this.opts.sign(objectPath, ttlMs / 1000);
      const entry = { url, expiresAt: now + ttlMs };
      this.cache.delete(objectPath);
      this.cache.set(objectPath, entry);
      while (this.cache.size > (this.opts.max ?? 5_000)) {
        const oldest = this.cache.keys().next().value;
        if (oldest === undefined) break;
        this.cache.delete(oldest);
      }
      this.warned = false;
      return entry;
    } catch (err) {
      this.failingUntil = now + (this.opts.cooldownMs ?? 60_000);
      if (!this.warned) {
        this.warned = true;
        logger.warn({ err: err instanceof Error ? err.message : String(err) }, "Media URL signing unavailable; streaming through the API");
      }
      return null;
    }
  }

  /** Drop a cached URL (e.g. the object was deleted or made private). */
  forget(objectPath: string): void {
    this.cache.delete(objectPath);
  }
}

let shared: SignedMediaUrls | null = null;

function sharedSigner(): SignedMediaUrls {
  if (!shared) {
    shared = new SignedMediaUrls({
      sign: async (objectPath, ttlSec) => {
        const { ObjectStorageService } = await import("./objectStorage");
        // Signs a V4 GET URL; rewritten to CDN_BASE_URL when one is set.
        return new ObjectStorageService().getObjectEntityDownloadURL(objectPath, ttlSec);
      },
    });
  }
  return shared;
}

/**
 * Call after the route's own visibility/ACL checks. Sends a 302 and returns
 * true, or returns false so the route streams as before.
 */
export async function redirectToPublicMedia(
  res: Response,
  objectPath: string,
  opts: { env?: Env; signer?: SignedMediaUrls; now?: number } = {},
): Promise<boolean> {
  const mode = mediaDeliveryMode(opts.env);
  if (mode !== "redirect") return false;
  const signed = await (opts.signer ?? sharedSigner()).get(objectPath);
  const decision = decideMediaDelivery({ mode, signed, now: opts.now ?? Date.now() });
  if (decision.kind !== "redirect") return false;
  res.setHeader("Cache-Control", decision.cacheControl);
  res.redirect(302, decision.url);
  return true;
}
