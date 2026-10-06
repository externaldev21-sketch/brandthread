import crypto from "node:crypto";
import type { Request } from "express";
import { consumeRateLimitBucket } from "../../middlewares/rateLimit";
import { getWebOrigin } from "../webOrigin";
import { isBotRequest } from "./botFilter";
import { clickDedupeKey, countryFromHeaders, referrerHost } from "./clickPrivacy";

// Process-local fallback so a missing SESSION_SECRET never crashes a redirect.
const FALLBACK_SECRET = crypto.randomBytes(16).toString("hex");

export type ClickContext = { country: string | null; referrerHost: string | null };

/**
 * Decide whether this request is a countable human click and, if so, return the
 * coarse context to store. The IP is only fed into a salted HMAC used as a
 * transient rate-limit bucket id (same visitor + same scope: at most `max`
 * counted per window). Returns null for bots / prefetches / repeats.
 */
export async function countableClick(
  req: Request,
  scope: string,
  opts: { max?: number; windowMs?: number } = {},
): Promise<ClickContext | null> {
  if (isBotRequest({ method: req.method, userAgent: req.get("user-agent"), headers: req.headers })) return null;
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  const key = `growth-click:${clickDedupeKey(process.env.SESSION_SECRET || FALLBACK_SECRET, ip, req.get("user-agent") ?? "", scope)}`;
  try {
    const counter = await consumeRateLimitBucket(key, {
      id: "public-read",
      limit: opts.max ?? 3,
      windowMs: opts.windowMs ?? 10 * 60_000,
      message: "",
    });
    if (counter.count > (opts.max ?? 3)) return null;
  } catch {
    return null; // fail closed for counting only; the redirect itself still proceeds
  }
  let own: string[] = [];
  try { own = [new URL(getWebOrigin()).hostname]; } catch { /* ignore */ }
  return { country: countryFromHeaders(req.headers), referrerHost: referrerHost(req.get("referer"), own) };
}
