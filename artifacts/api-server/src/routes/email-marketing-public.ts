/**
 * Public (no auth) email-marketing endpoints, mounted under /api/public:
 *   POST /stores/:slug/subscribe        store signup form (rate limited, honeypot, idempotent)
 *   GET  /email/unsubscribe/:token      confirmation page (link scanners cannot unsubscribe anyone)
 *   POST /email/unsubscribe/:token      one-click unsubscribe (RFC 8058) and the page's button
 *   GET  /email/confirm/:token          double opt-in confirmation
 * Responses never reveal whether an address was already on a list.
 */
import { Router, type Request } from "express";
import { db, storefronts } from "@workspace/db";
import { eq } from "drizzle-orm";
import { rateLimit, consumeRateLimitBucket, normalizeClientIp, type RateLimitPolicy } from "../middlewares/rateLimit";
import { parseSubscribeBody } from "../lib/emailMarketing/validation";
import { hashIp, signToken, verifyToken, tokenSecret } from "../lib/emailMarketing/tokens";
import {
  confirmByRawToken, findByRawToken, subscribeEmail, unsubscribeByRawToken,
} from "../lib/emailMarketing/subscribers";
import { getEmailProvider } from "../lib/emailMarketing/provider";
import { loadSenderContext } from "../lib/emailMarketing/sender";
import { escapeHtml } from "../lib/emailMarketing/render";
import { getWebOrigin } from "../lib/webOrigin";
import { logger } from "../lib/logger";
import crypto from "node:crypto";

const router = Router();

/** Same address from the same connection can only be submitted a few times per hour. */
const PER_EMAIL_POLICY: RateLimitPolicy = {
  id: "email-subscribe",
  limit: 3,
  windowMs: 60 * 60_000,
  message: "That address was just submitted. Please try again later.",
};

function page(title: string, message: string, form?: { action: string; label: string }): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>body{margin:0;background:#fff;color:#000;font-family:Inter,-apple-system,Segoe UI,Helvetica,Arial,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px}
.c{max-width:380px;text-align:center}h1{font-size:22px;margin:0 0 12px}p{color:#555;line-height:1.6;margin:0 0 24px}
button{background:#000;color:#fff;border:0;padding:14px 28px;font:600 15px Inter,sans-serif;cursor:pointer}</style></head>
<body><div class="c"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p>
${form ? `<form method="post" action="${escapeHtml(form.action)}"><button type="submit">${escapeHtml(form.label)}</button></form>` : ""}
</div></body></html>`;
}

function clientIp(req: Request): string {
  return normalizeClientIp(req.ip || req.socket.remoteAddress);
}

router.post("/stores/:slug/subscribe", rateLimit("email-subscribe"), async (req, res): Promise<void> => {
  const parsed = parseSubscribeBody(req.body);
  if (!parsed.ok) { res.status(400).json({ error: parsed.error }); return; }

  // Honeypot: bots fill the hidden field. Answer exactly like a success and store nothing.
  if (parsed.value.honeypot) { res.json({ ok: true, status: "subscribed" }); return; }

  const [sf] = await db.select({ ownerId: storefronts.ownerId, status: storefronts.status })
    .from(storefronts).where(eq(storefronts.slug, String(req.params.slug))).limit(1);
  if (!sf || sf.status !== "published") { res.status(404).json({ error: "Store not found" }); return; }

  const ip = clientIp(req);
  const emailKey = crypto.createHash("sha256").update(parsed.value.email).digest("hex").slice(0, 24);
  const counter = await consumeRateLimitBucket(`email-subscribe:${sf.ownerId}:${ip}:${emailKey}`, PER_EMAIL_POLICY);
  if (counter.count > PER_EMAIL_POLICY.limit) {
    res.status(429).json({ error: PER_EMAIL_POLICY.message, code: "RATE_LIMITED" });
    return;
  }

  const ctx = await loadSenderContext(sf.ownerId);
  const outcome = await subscribeEmail({
    sellerId: sf.ownerId,
    email: parsed.value.email,
    source: "store_site",
    ipHash: hashIp(ip),
    doubleOptIn: ctx.settings?.doubleOptIn === true,
  });

  if (outcome.needsConfirmation) {
    const provider = getEmailProvider();
    if (provider.isConfigured() && tokenSecret()) {
      const link = `${getWebOrigin()}/api/public/email/confirm/${signToken("confirm", outcome.rawToken)}`;
      const r = await provider.send({
        to: parsed.value.email,
        subject: `Confirm your subscription to ${ctx.storeName}`,
        html: page(`Confirm your subscription`, `Confirm that you want emails from ${ctx.storeName}.`)
          .replace("</div></body>", `<p><a href="${escapeHtml(link)}" style="color:#000">Confirm subscription</a></p></div></body>`),
        text: `Confirm your subscription to ${ctx.storeName}: ${link}\n\nIf you did not ask for this, ignore this email.`,
        fromName: ctx.fromName,
        replyTo: ctx.replyTo,
      });
      if (!r.ok) logger.warn({ err: r.error }, "Double opt-in confirmation email failed");
    }
  }
  res.json({ ok: true, status: outcome.status === "pending" ? "pending" : "subscribed" });
});

router.get("/email/unsubscribe/:token", async (req, res): Promise<void> => {
  res.set("Cache-Control", "no-store");
  const raw = verifyToken("unsub", req.params.token);
  const sub = raw ? await findByRawToken(raw) : null;
  if (!sub) { res.status(404).type("html").send(page("Link not valid", "This unsubscribe link is invalid or has expired.")); return; }
  if (sub.status === "unsubscribed") {
    res.type("html").send(page("You are unsubscribed", "You will not receive more emails from this store."));
    return;
  }
  res.type("html").send(page("Unsubscribe", "Stop receiving emails from this store?", {
    action: `${getWebOrigin()}/api/public/email/unsubscribe/${encodeURIComponent(String(req.params.token))}`,
    label: "Unsubscribe",
  }));
});

router.post("/email/unsubscribe/:token", async (req, res): Promise<void> => {
  res.set("Cache-Control", "no-store");
  const raw = verifyToken("unsub", req.params.token);
  if (!raw || !(await unsubscribeByRawToken(raw))) {
    res.status(404).type("html").send(page("Link not valid", "This unsubscribe link is invalid or has expired."));
    return;
  }
  res.type("html").send(page("You are unsubscribed", "You will not receive more emails from this store."));
});

router.get("/email/confirm/:token", async (req, res): Promise<void> => {
  res.set("Cache-Control", "no-store");
  const raw = verifyToken("confirm", req.params.token);
  const sub = raw ? await findByRawToken(raw) : null;
  if (!raw || !sub) { res.status(404).type("html").send(page("Link not valid", "This confirmation link is invalid or has expired.")); return; }
  if (sub.status === "pending") await confirmByRawToken(raw, hashIp(clientIp(req)));
  res.type("html").send(page("You are subscribed", "Thanks for confirming your email."));
});

export default router;
