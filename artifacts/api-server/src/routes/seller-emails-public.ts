/**
 * One-click "Stop these emails" for seller tips (activation nudges and the
 * weekly summary). Same shape as the email-marketing unsubscribe:
 *   GET  /api/public/seller-emails/unsubscribe/:token   confirmation page (link scanners can't unsubscribe)
 *   POST /api/public/seller-emails/unsubscribe/:token   turns `email:seller_tips` off (also RFC 8058 one-click)
 * Order, payout and review emails are unaffected.
 */
import express, { Router } from "express";
import { escapeHtml } from "../lib/emailMarketing/render";
import { sellerFromUnsubscribeToken, turnOffSellerTipsEmail } from "../lib/sellerLifecycle/unsubscribe";

const router = Router();

function page(title: string, message: string, form?: { action: string; label: string }): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>body{margin:0;background:#fff;color:#000;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px}
.c{max-width:380px;text-align:center}h1{font-size:22px;margin:0 0 12px}p{color:#555;line-height:1.6;margin:0 0 24px}
button{background:#000;color:#fff;border:0;border-radius:12px;padding:14px 28px;font:600 15px -apple-system,sans-serif;cursor:pointer}</style></head>
<body><div class="c"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p>
${form ? `<form method="post" action="${escapeHtml(form.action)}"><button type="submit">${escapeHtml(form.label)}</button></form>` : ""}</div></body></html>`;
}

router.get("/seller-emails/unsubscribe/:token", (req, res) => {
  res.set("Cache-Control", "no-store");
  if (!sellerFromUnsubscribeToken(req.params.token)) {
    return void res.status(404).type("html").send(page("Link not valid", "This link is invalid or has expired."));
  }
  res.type("html").send(page(
    "Stop store tips?",
    "You won't get setup reminders or the weekly summary by email. Order, payout and review emails still arrive.",
    { action: req.originalUrl, label: "Stop these emails" },
  ));
});

router.post("/seller-emails/unsubscribe/:token", express.urlencoded({ extended: false }), async (req, res) => {
  res.set("Cache-Control", "no-store");
  const sellerId = sellerFromUnsubscribeToken(req.params.token);
  if (!sellerId) return void res.status(404).type("html").send(page("Link not valid", "This link is invalid or has expired."));
  await turnOffSellerTipsEmail(sellerId);
  res.type("html").send(page("Done", "You won't get store tips by email. Turn them back on in Settings → Notifications."));
});

export default router;
