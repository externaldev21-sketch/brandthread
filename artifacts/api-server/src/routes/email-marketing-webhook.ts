/**
 * Resend delivery-event webhook for seller campaigns (Svix-signed).
 * POST /api/webhooks/resend-marketing — requires RESEND_WEBHOOK_SECRET; without it the
 * endpoint answers 503 and the app reports delivery/open/click tracking as unavailable.
 * Only what Resend reports is recorded. Hard bounces and complaints suppress the address.
 */
import { Router } from "express";
import crypto from "node:crypto";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const router = Router();
const TOLERANCE_SECONDS = 5 * 60;

export function verifySvixSignature(opts: {
  secret: string; id: string; timestamp: string; signatureHeader: string; body: string; nowMs?: number;
}): boolean {
  const ts = Number(opts.timestamp);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs((opts.nowMs ?? Date.now()) / 1000 - ts) > TOLERANCE_SECONDS) return false;
  const key = Buffer.from(opts.secret.replace(/^whsec_/, ""), "base64");
  const expected = crypto.createHmac("sha256", key).update(`${opts.id}.${opts.timestamp}.${opts.body}`).digest();
  for (const part of opts.signatureHeader.split(" ")) {
    const [version, sig] = part.split(",");
    if (version !== "v1" || !sig) continue;
    const got = Buffer.from(sig, "base64");
    if (got.length === expected.length && crypto.timingSafeEqual(got, expected)) return true;
  }
  return false;
}

router.post("/", async (req, res): Promise<void> => {
  const secret = process.env.RESEND_WEBHOOK_SECRET?.trim();
  if (!secret) { res.status(503).json({ error: "Webhook not configured" }); return; }
  const body = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "";
  const ok = verifySvixSignature({
    secret, body,
    id: String(req.header("svix-id") ?? ""),
    timestamp: String(req.header("svix-timestamp") ?? ""),
    signatureHeader: String(req.header("svix-signature") ?? ""),
  });
  if (!ok) { res.status(400).json({ error: "Invalid signature" }); return; }

  let event: { type?: string; data?: { email_id?: string; bounce?: { type?: string } } };
  try { event = JSON.parse(body); } catch { res.status(400).json({ error: "Invalid body" }); return; }
  const messageId = event.data?.email_id;
  if (!messageId || !event.type) { res.json({ ok: true }); return; }

  switch (event.type) {
    case "email.delivered":
      await db.execute(sql`UPDATE email_campaign_sends SET delivered_at = COALESCE(delivered_at, now()) WHERE provider_message_id = ${messageId}`);
      break;
    case "email.opened":
      await db.execute(sql`UPDATE email_campaign_sends SET opened_at = COALESCE(opened_at, now()) WHERE provider_message_id = ${messageId}`);
      break;
    case "email.clicked":
      await db.execute(sql`UPDATE email_campaign_sends SET clicked_at = COALESCE(clicked_at, now()) WHERE provider_message_id = ${messageId}`);
      break;
    case "email.bounced": {
      await db.execute(sql`UPDATE email_campaign_sends SET bounced_at = COALESCE(bounced_at, now()) WHERE provider_message_id = ${messageId}`);
      if (event.data?.bounce?.type !== "Transient") {
        await suppress(messageId, "bounced");
      }
      break;
    }
    case "email.complained":
      await suppress(messageId, "complained");
      break;
  }
  res.json({ ok: true });
});

async function suppress(messageId: string, status: "bounced" | "complained"): Promise<void> {
  await db.execute(sql`
    UPDATE email_subscribers SET status = ${status}, updated_at = now()
    WHERE id IN (SELECT subscriber_id FROM email_campaign_sends WHERE provider_message_id = ${messageId})
  `);
}

export default router;
