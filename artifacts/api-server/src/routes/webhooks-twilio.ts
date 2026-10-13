/**
 * Twilio inbound SMS webhook — POST /api/webhooks/twilio/sms
 *
 * Set this URL as the "A message comes in" webhook on the Twilio number (or
 * the Messaging Service's Integration > Incoming messages). Every request is
 * authenticated with X-Twilio-Signature (HMAC-SHA1 of the public URL + sorted
 * form params, keyed with TWILIO_AUTH_TOKEN). The public URL is
 * PUBLIC_API_URL + the request path when PUBLIC_API_URL is set, otherwise it
 * is rebuilt from the request (trust proxy is on, so X-Forwarded-Proto/Host
 * are honoured).
 *
 * STOP/STOPALL/UNSUBSCRIBE/CANCEL/END/QUIT (and OPTOUT/REVOKE) clear consent;
 * START/UNSTOP/YES restore it for accounts that opted in before; HELP/INFO
 * gets a help reply. Twilio itself sends the standard STOP/START replies, so
 * those get an empty TwiML response here (no double text).
 */
import { Router, type Request } from "express";
import { handleInboundSms, smsEnabled, twilioAuthToken, twiml, validateTwilioSignature } from "../lib/sms";
import { logger } from "../lib/logger";

const router = Router();

export function publicWebhookUrl(req: Request): string {
  const base = process.env.PUBLIC_API_URL?.trim().replace(/\/+$/, "");
  if (base) return `${base}${req.originalUrl}`;
  return `${req.protocol}://${req.get("host")}${req.originalUrl}`;
}

router.post("/sms", async (req, res) => {
  const token = twilioAuthToken();
  if (!smsEnabled() || !token) { res.status(404).end(); return; }
  const params = (req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>;
  const signature = req.get("X-Twilio-Signature");
  if (!validateTwilioSignature(token, signature, publicWebhookUrl(req), params)) {
    logger.warn({ path: req.originalUrl }, "Twilio webhook signature rejected");
    res.status(403).end();
    return;
  }
  try {
    const from = typeof params.From === "string" ? params.From : "";
    const { keyword, reply } = await handleInboundSms(from, params.Body);
    if (keyword) logger.info({ keyword }, "Twilio inbound keyword handled");
    res.type("text/xml").send(twiml(reply));
  } catch (err) {
    logger.error({ err }, "Twilio inbound SMS handling failed");
    // 500 makes Twilio retry; consent changes must not be lost.
    res.status(500).type("text/xml").send(twiml(null));
  }
});

export default router;
