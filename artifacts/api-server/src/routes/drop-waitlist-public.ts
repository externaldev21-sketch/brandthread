/**
 * Public (no auth) drop SMS waitlist, mounted at /api/public/drop-waitlist.
 *   GET  /:handle  page data for brandthread.app/@handle/drop
 *   POST /:handle  { phone, countryCode?, consent: true }  join the waitlist
 * No IP address is ever stored; IPs only key short-lived rate-limit buckets.
 */
import crypto from "node:crypto";
import { Router, type Request } from "express";
import { consumeRateLimitBucket, normalizeClientIp, rateLimit, type RateLimitPolicy } from "../middlewares/rateLimit";
import { setPublicCacheHeaders } from "../lib/httpCache";
import { maskPhone, normalizePhone } from "../lib/sms";
import {
  HANDLE_RE, buildConsentText, findWaitlistDrop, joinWaitlist, resolvePublicBrand,
} from "../lib/dropSmsWaitlist";

const router = Router();

/** The same number from the same connection can only be submitted a few times per hour. */
const PER_PHONE_POLICY: RateLimitPolicy = {
  id: "drop-waitlist",
  limit: 3,
  windowMs: 60 * 60_000,
  message: "That number was just submitted. Please try again later.",
};

function clientIp(req: Request): string {
  return normalizeClientIp(req.ip || req.socket.remoteAddress);
}

router.get("/:handle", async (req, res): Promise<void> => {
  const handle = String(req.params.handle ?? "");
  if (!HANDLE_RE.test(handle)) { res.status(404).json({ error: "Brand not found", code: "NOT_FOUND" }); return; }
  const brand = await resolvePublicBrand(handle);
  if (!brand) { res.status(404).json({ error: "Brand not found", code: "NOT_FOUND" }); return; }
  const { state, drop } = await findWaitlistDrop(brand.sellerId);
  setPublicCacheHeaders(res);
  res.json({
    brand: { name: brand.name, handle: brand.handle, avatarUrl: brand.avatarUrl },
    drop,
    state,
    waitlistOpen: state !== "live",
    consentText: buildConsentText(brand.name, state === "upcoming"),
  });
});

router.post("/:handle", rateLimit("drop-waitlist"), async (req, res): Promise<void> => {
  res.set("Cache-Control", "no-store");
  const handle = String(req.params.handle ?? "");
  const body = (req.body ?? {}) as Record<string, unknown>;

  // Honeypot: bots fill the hidden field. Answer like a success and store nothing.
  if (typeof body.company === "string" && body.company.trim()) {
    res.json({ ok: true, phone: null });
    return;
  }
  if (body.consent !== true) {
    res.status(400).json({ error: "Agree to get texts to join.", code: "CONSENT_REQUIRED" });
    return;
  }
  const phone = normalizePhone(body.phone, body.countryCode ?? "1");
  if (!phone) {
    res.status(400).json({ error: "Enter a valid mobile number.", code: "INVALID_PHONE" });
    return;
  }
  const brand = HANDLE_RE.test(handle) ? await resolvePublicBrand(handle) : null;
  if (!brand) { res.status(404).json({ error: "Brand not found", code: "NOT_FOUND" }); return; }

  const { state, drop } = await findWaitlistDrop(brand.sellerId);
  if (state === "live") {
    res.status(409).json({ error: "This drop is live now.", code: "DROP_LIVE", dropId: drop?.id ?? null });
    return;
  }

  const phoneKey = crypto.createHash("sha256").update(phone).digest("hex").slice(0, 24);
  const counter = await consumeRateLimitBucket(`drop-waitlist:${brand.sellerId}:${clientIp(req)}:${phoneKey}`, PER_PHONE_POLICY);
  if (counter.count > PER_PHONE_POLICY.limit) {
    res.status(429).json({ error: PER_PHONE_POLICY.message, code: "RATE_LIMITED" });
    return;
  }

  // Consent copy is rebuilt server-side — never trusted from the client.
  await joinWaitlist({
    sellerId: brand.sellerId,
    dropId: drop?.id ?? null,
    phoneE164: phone,
    consentText: buildConsentText(brand.name, state === "upcoming"),
  });
  res.json({ ok: true, phone: maskPhone(phone) });
});

export default router;
