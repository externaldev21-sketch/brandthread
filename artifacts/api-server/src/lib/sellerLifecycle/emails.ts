/**
 * Seller emails: new order, new review, payout failed, checkout blocked,
 * activation nudges and the weekly summary. Pure renderers (subject + html)
 * so tests can check the copy without sending; delivery goes through the
 * shared Resend sender in brandthreadEmail.ts.
 */
import { renderBrandthreadEmail } from "../brandthreadEmail";
import { getWebOrigin } from "../webOrigin";

export type RenderedEmail = { subject: string; html: string };

function esc(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

export function money(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Math.max(0, cents) / 100);
}

function link(path: string): string {
  return `${getWebOrigin()}${path}`;
}

function rows(pairs: Array<[string, string]>): string {
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">${pairs.map(([k, v], i) =>
    `<tr><td style="padding:12px 0;${i < pairs.length - 1 ? "border-bottom:1px solid #eeeeee;" : ""}color:#666666;">${esc(k)}</td><td align="right" style="padding:12px 0;${i < pairs.length - 1 ? "border-bottom:1px solid #eeeeee;" : ""}font-weight:700;">${esc(v)}</td></tr>`,
  ).join("")}</table>`;
}

/** Same button as the shared template, placed inline so the "stop" note can sit under it. */
function button(label: string, url: string): string {
  return `<table role="presentation" border="0" cellspacing="0" cellpadding="0" style="margin:28px 0 4px;"><tr><td style="border-radius:999px;background:#111111;"><a href="${esc(url)}" style="display:inline-block;padding:13px 22px;border:1px solid #111111;border-radius:999px;color:#ffffff;font-size:14px;font-weight:700;line-height:20px;text-decoration:none;">${esc(label)}</a></td></tr></table>`;
}

function footerNote(unsubscribeUrl?: string | null): string {
  const off = unsubscribeUrl
    ? `<a href="${esc(unsubscribeUrl)}" style="color:#666666;">Stop these emails</a>`
    : "Turn these emails off in Settings → Notifications.";
  return `<p style="margin:24px 0 0;color:#888888;font-size:12px;">${off}</p>`;
}

export function newOrderEmail(input: { orderNumber: string; totalCents: number; itemCount: number; orderId: string }): RenderedEmail {
  const total = money(input.totalCents);
  return {
    subject: `New order #${input.orderNumber} for ${total}`,
    html: renderBrandthreadEmail({
      preheader: `Order #${input.orderNumber} for ${total} is ready to ship.`,
      eyebrow: "New order",
      title: "You have a new order",
      subtitle: `Order #${input.orderNumber} is paid and ready to ship.`,
      bodyHtml: rows([["Order", `#${input.orderNumber}`], ["Items", String(input.itemCount)], ["Total", total]])
        + button("View order", link(`/order-detail?id=${encodeURIComponent(input.orderId)}`)) + footerNote(),
    }),
  };
}

export function newReviewEmail(input: { rating: number | null; productName: string | null; body: string | null }): RenderedEmail {
  const stars = input.rating ? `${input.rating} out of 5` : null;
  const about = input.productName ? ` on ${input.productName}` : "";
  return {
    subject: stars ? `New ${input.rating}-star review${about}` : `New review${about}`,
    html: renderBrandthreadEmail({
      preheader: `A buyer left a review${about}.`,
      eyebrow: "New review",
      title: "A buyer left a review",
      subtitle: stars ? `${stars}${about}.` : `${input.productName ?? "Your store"} has a new review.`,
      bodyHtml: (input.body ? `<p style="margin:0;padding:16px;border-left:3px solid #111111;background:#f6f6f6;">${esc(input.body.slice(0, 500))}</p>` : "")
        + `<p style="margin:${input.body ? "16px" : "0"} 0 0;color:#666666;">Replying shows future buyers you're there.</p>` + button("Reply to review", link("/seller-reviews")) + footerNote(),
    }),
  };
}

export function payoutFailedEmail(input: { amountCents: number | null; detail: string | null }): RenderedEmail {
  const amount = input.amountCents ? money(input.amountCents) : "Your payout";
  return {
    subject: "Your Brandthread payout failed",
    html: renderBrandthreadEmail({
      preheader: `${amount} couldn't be sent to your bank.`,
      eyebrow: "Payout failed",
      title: "Your payout didn't go through",
      subtitle: `${amount} couldn't be sent to your bank account.`,
      bodyHtml: `<p style="margin:0;color:#666666;">${esc(input.detail || "The money stays in your balance. Check your bank details in Payouts.")}</p>`,
      cta: { label: "Update payout details", url: link("/payout-setup") },
    }),
  };
}

export function checkoutBlockedEmail(): RenderedEmail {
  return {
    subject: "A buyer couldn't pay you",
    html: renderBrandthreadEmail({
      preheader: "Set up payouts so buyers can check out.",
      eyebrow: "Missed sale",
      title: "A buyer tried to check out",
      subtitle: "They couldn't pay because payouts aren't set up on your store yet.",
      bodyHtml: `<p style="margin:0;color:#666666;">Setting up payouts takes a few minutes. Buyers can pay as soon as it's done.</p>`,
      cta: { label: "Set up payouts", url: link("/payouts") },
    }),
  };
}

export type NudgeKind = "no_product" | "no_payouts" | "not_published" | "onboarding_abandoned";

export const NUDGE_COPY: Record<NudgeKind, { title: string; body: string; cta: string; route: string }> = {
  no_product: {
    title: "Add your first product",
    body: "Your store is ready. Add a product so buyers have something to buy.",
    cta: "Add a product",
    route: "/add-product",
  },
  no_payouts: {
    title: "Set up payouts",
    body: "Buyers can't check out until payouts are set up. It takes a few minutes.",
    cta: "Set up payouts",
    route: "/payouts",
  },
  not_published: {
    title: "Publish your store",
    body: "Your products are ready. Publish your store so buyers can find it.",
    cta: "Publish store",
    route: "/launch-publish",
  },
  onboarding_abandoned: {
    title: "Finish setting up your store",
    body: "You're a few steps from your own store on Brandthread. Pick up where you left off.",
    cta: "Finish setup",
    route: "/onboarding",
  },
};

export function nudgeEmail(kind: NudgeKind, unsubscribeUrl: string | null): RenderedEmail {
  const copy = NUDGE_COPY[kind];
  return {
    subject: copy.title,
    html: renderBrandthreadEmail({
      preheader: copy.body,
      title: copy.title,
      subtitle: copy.body,
      bodyHtml: button(copy.cta, link(copy.route)) + footerNote(unsubscribeUrl),
    }),
  };
}

export type WeeklySummary = {
  salesCents: number;
  orderCount: number;
  toShipCount: number;
  visits: number;
  topProduct: { name: string; units: number } | null;
  activeProducts: number;
};

export function weeklySummaryEmail(summary: WeeklySummary, weekLabel: string, unsubscribeUrl: string | null): RenderedEmail {
  if (summary.orderCount === 0) {
    const tips = [
      summary.activeProducts < 5 ? "Add a few more products. Stores with 5 or more sell more often." : null,
      "Share your store link in your Instagram or TikTok bio.",
      "Post a photo or video of a product to your feed.",
      "Go live to show your products and answer questions.",
    ].filter(Boolean).slice(0, 3) as string[];
    return {
      subject: `Your week on Brandthread: 3 things to try`,
      html: renderBrandthreadEmail({
        preheader: `${summary.visits} store visit${summary.visits === 1 ? "" : "s"} this week. Here's how to get your next sale.`,
        eyebrow: weekLabel,
        title: "No sales this week",
        subtitle: `${summary.visits} store visit${summary.visits === 1 ? "" : "s"}. Try these to get your next sale.`,
        bodyHtml: `<ol style="margin:0;padding-left:20px;color:#252525;">${tips.map((t) => `<li style="margin:0 0 8px;">${esc(t)}</li>`).join("")}</ol>` + button("Share your store", link("/share-store")) + footerNote(unsubscribeUrl),
      }),
    };
  }
  const pairs: Array<[string, string]> = [
    ["Sales", money(summary.salesCents)],
    ["Orders", String(summary.orderCount)],
    ["Store visits", String(summary.visits)],
  ];
  if (summary.topProduct) pairs.push(["Top product", `${summary.topProduct.name} (${summary.topProduct.units} sold)`]);
  if (summary.toShipCount > 0) pairs.push(["Orders to ship", String(summary.toShipCount)]);
  return {
    subject: `Your week on Brandthread: ${money(summary.salesCents)} in sales`,
    html: renderBrandthreadEmail({
      preheader: `${summary.orderCount} order${summary.orderCount === 1 ? "" : "s"} and ${money(summary.salesCents)} in sales this week.`,
      eyebrow: weekLabel,
      title: `${money(summary.salesCents)} in sales`,
      subtitle: `${summary.orderCount} order${summary.orderCount === 1 ? "" : "s"} this week.`,
      bodyHtml: rows(pairs)
        + (summary.toShipCount > 0 ? button("Ship orders", link("/orders")) : button("View analytics", link("/analytics")))
        + footerNote(unsubscribeUrl),
    }),
  };
}
