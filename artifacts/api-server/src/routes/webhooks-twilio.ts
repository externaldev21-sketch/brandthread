/**
 * Twilio inbound SMS webhook, mounted (before auth) at /api/webhooks/twilio.
 *   POST /sms   urlencoded Twilio request, X-Twilio-Signature verified
 *
 * STOP / STOPALL / UNSUBSCRIBE / CANCEL / END / QUIT  → opt the number out
 * START / UNSTOP                                      → clear the opt-out
 * Replies with empty TwiML: the Messaging Service's own opt-out handling
 * sends the carrier-required confirmation text.
 *
 * Configure in Twilio: Messaging Service → Integration → "Send a webhook",
 * Request URL https://brandthread.app/api/webhooks/twilio/sms (HTTP POST).
 */
import { Router, type Request } from "express";
import { handleInboundSms, twiml } from "../lib/sms";
import { applyInboundKeyword } from "../lib/dropSmsWaitlist";
import { getSmsConfig, isValidTwilioSignature, normalizePhone } from "../lib/sms";
import { CANONICAL_WEB_ORIGIN, getWebOrigin } from "../lib/webOrigin";
import { logger } from "../lib/logger";

const router = Router();
const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

/** Every URL Twilio may have signed for this request (public domain or forwarded host). */
export function signatureUrlCandidates(req: Request): string[] {
  const path = req.originalUrl;
  const urls = new Set<string>([`${CANONICAL_WEB_ORIGIN}${path}`, `${getWebOrigin()}${path}`]);
  if (process.env.PUBLIC_API_URL?.trim()) urls.add(`${process.env.PUBLIC_API_URL.trim().replace(/\/+$/, "")}${path}`);
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
  if (host) urls.add(`${req.protocol}://${host}${path}`);
  return [...urls];
}

router.post("/sms", async (req, res): Promise<void> => {
  const config = getSmsConfig();
  if (!config) { res.status(503).json({ error: "SMS is not configured", code: "SMS_NOT_CONFIGURED" }); return; }

  const params = (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body))
    ? req.body as Record<string, unknown>
    : {};
  if (!isValidTwilioSignature(config.authToken, req.headers["x-twilio-signature"], signatureUrlCandidates(req), params)) {
    res.status(403).json({ error: "Invalid signature", code: "INVALID_SIGNATURE" });
    return;
  }

  const from = normalizePhone(typeof params.From === "string" ? params.From : "");
  const body = typeof params.Body === "string" ? params.Body : "";
  if (from && body) {
    try {
      const outcome = await applyInboundKeyword(from, body);
      const { reply } = await handleInboundSms(from, body);
      if (reply) { res.type("text/xml").send(twiml(reply)); return; }
      if (outcome) logger.info({ outcome }, "Drop SMS waitlist keyword applied");
    } catch (err) {
      logger.error({ err }, "Failed to apply inbound SMS keyword");
      res.status(500).json({ error: "Could not process message" });
      return;
    }
  }
  res.type("text/xml").send(EMPTY_TWIML);
});

export default router;
