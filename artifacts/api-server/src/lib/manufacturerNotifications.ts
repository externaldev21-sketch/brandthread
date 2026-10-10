/**
 * Manufacturer email (and in-app) notifications.
 *
 * Manufacturers work in the web portal and usually have no push token, so
 * new RFQs / quote requests, new seller messages (throttled per thread) and
 * paid order cards are also emailed to the manufacturer's contact email.
 * Email goes through the existing Brandthread email provider; with no email
 * key configured sendBrandthreadEmail() is a logged no-op, never an error.
 */
import { clerkClient } from "@clerk/express";
import { db, manufacturerThreads, manufacturers, sampleOrders, users } from "@workspace/db";
import { and, eq, isNull, lt, or } from "drizzle-orm";
import { escapeHtml, formatCents, renderBrandthreadEmail, sendBrandthreadEmail } from "./brandthreadEmail";
import { getWebOrigin } from "./webOrigin";
import { logger } from "./logger";
import { publishNotification } from "../routes/notifications-feed";

/** At most one "new message" email per thread in this window. */
export const MESSAGE_EMAIL_THROTTLE_MS = 30 * 60 * 1000;

function portalUrl(path: string) {
  return `${getWebOrigin()}/manufacturers${path}`;
}

type ManufacturerRecipient = { id: string; clerkId: string | null; businessName: string; contactEmail: string | null };

async function loadManufacturer(manufacturerId: string): Promise<ManufacturerRecipient | null> {
  const [row] = await db.select({
    id: manufacturers.id,
    clerkId: manufacturers.clerkId,
    businessName: manufacturers.businessName,
    contactEmail: manufacturers.contactEmail,
  }).from(manufacturers).where(eq(manufacturers.id, manufacturerId)).limit(1);
  return row ?? null;
}

async function recipientEmail(mfr: ManufacturerRecipient): Promise<string | null> {
  const email = mfr.contactEmail?.trim();
  if (email) return email;
  if (!mfr.clerkId) return null;
  try {
    const user = await clerkClient.users.getUser(mfr.clerkId);
    return user?.primaryEmailAddress?.emailAddress ?? user?.emailAddresses?.[0]?.emailAddress ?? null;
  } catch (err) {
    logger.warn({ err, manufacturerId: mfr.id }, "Unable to resolve manufacturer email");
    return null;
  }
}

/** Same display name the manufacturer sees in their inbox. */
export async function sellerNameFor(sellerId: string): Promise<string> {
  const [seller] = await db.select({ brandName: users.brandName, displayName: users.displayName, name: users.name })
    .from(users).where(eq(users.clerkId, sellerId)).limit(1);
  return seller?.brandName?.trim() || seller?.displayName?.trim() || seller?.name?.trim() || "A Brandthread seller";
}

/** Run a notification without blocking or failing the request that triggered it. */
export function inBackground(task: Promise<unknown>, context: Record<string, unknown>) {
  void task.catch((err) => logger.error({ err, ...context }, "Manufacturer notification failed"));
}

// ─── New RFQ / quote / sample request ─────────────────────────────────────────

export async function notifyManufacturerOfRequest(input: {
  manufacturerId: string;
  requestId: string;
  kind: "rfq" | "quote" | "sample";
  sellerName: string;
  productName: string;
  quantity?: number | null;
}): Promise<{ emailed: boolean }> {
  const mfr = await loadManufacturer(input.manufacturerId);
  if (!mfr) return { emailed: false };
  const label = input.kind === "sample" ? "sample request" : input.kind === "rfq" ? "request for quote" : "quote request";
  const qty = input.quantity ? ` · ${input.quantity.toLocaleString("en-US")} pcs` : "";
  if (mfr.clerkId) {
    await publishNotification({
      userId: mfr.clerkId,
      category: "production",
      type: "manufacturer_quote_request",
      title: `New ${label} from ${input.sellerName}`,
      body: `${input.productName}${qty}`,
      actorName: input.sellerName,
      targetId: input.requestId,
      targetType: "quote_request",
      cta: "/manufacturers/quote-requests",
    }).catch((err) => logger.error({ err, manufacturerId: mfr.id }, "Manufacturer request notification failed"));
  }
  const to = await recipientEmail(mfr);
  if (!to) return { emailed: false };
  const html = renderBrandthreadEmail({
    preheader: `${input.sellerName} sent you a ${label}.`,
    eyebrow: "Manufacturer Hub",
    title: `New ${label}`,
    subtitle: `${input.sellerName} · ${input.productName}${qty}`,
    bodyHtml: `<p>${escapeHtml(input.sellerName)} wants a price for <strong>${escapeHtml(input.productName)}</strong>${escapeHtml(qty)}. Reply in Brandthread so your quote and payment stay protected.</p>`,
    cta: { label: "Open quote requests", url: portalUrl("/quote-requests") },
  });
  const emailed = await sendBrandthreadEmail({
    to,
    subject: `New ${label} from ${input.sellerName}`,
    html,
    idempotencyKey: `manufacturer-request/${input.requestId}`,
  });
  return { emailed };
}

// ─── New seller message (throttled per thread) ───────────────────────────────

/**
 * Emails the manufacturer about a new seller message unless one was emailed
 * for this thread in the last 30 minutes. The throttle is claimed atomically,
 * so concurrent messages send one email.
 */
export async function emailManufacturerNewMessage(input: {
  threadId: string;
  manufacturerId: string;
  sellerName: string;
  preview: string;
  now?: Date;
}): Promise<{ emailed: boolean; throttled: boolean }> {
  const now = input.now ?? new Date();
  const cutoff = new Date(now.getTime() - MESSAGE_EMAIL_THROTTLE_MS);
  const [claimed] = await db.update(manufacturerThreads)
    .set({ manufacturerEmailedAt: now })
    .where(and(
      eq(manufacturerThreads.id, input.threadId),
      or(isNull(manufacturerThreads.manufacturerEmailedAt), lt(manufacturerThreads.manufacturerEmailedAt, cutoff)),
    ))
    .returning({ id: manufacturerThreads.id });
  if (!claimed) return { emailed: false, throttled: true };
  const mfr = await loadManufacturer(input.manufacturerId);
  if (!mfr) return { emailed: false, throttled: false };
  const to = await recipientEmail(mfr);
  if (!to) return { emailed: false, throttled: false };
  const preview = input.preview.trim() ? input.preview.trim().slice(0, 280) : "Sent an attachment";
  const html = renderBrandthreadEmail({
    preheader: `${input.sellerName}: ${preview}`,
    eyebrow: "Manufacturer Hub",
    title: `New message from ${input.sellerName}`,
    bodyHtml: `<p style="white-space:pre-wrap;">${escapeHtml(preview)}</p>`,
    cta: { label: "Reply in Brandthread", url: portalUrl(`/messages/${input.threadId}`) },
  });
  const emailed = await sendBrandthreadEmail({
    to,
    subject: `New message from ${input.sellerName}`,
    html,
    idempotencyKey: `manufacturer-message/${input.threadId}/${now.getTime()}`,
  });
  return { emailed, throttled: false };
}

// ─── Order card paid ──────────────────────────────────────────────────────────

export async function emailManufacturerOrderPaid(orderId: string): Promise<{ emailed: boolean }> {
  const [order] = await db.select({
    id: sampleOrders.id,
    title: sampleOrders.title,
    orderType: sampleOrders.orderType,
    priceCents: sampleOrders.priceCents,
    platformFeeCents: sampleOrders.platformFeeCents,
    quantity: sampleOrders.quantity,
    manufacturerId: sampleOrders.manufacturerId,
  }).from(sampleOrders).where(eq(sampleOrders.id, orderId)).limit(1);
  if (!order) return { emailed: false };
  const mfr = await loadManufacturer(order.manufacturerId);
  if (!mfr) return { emailed: false };
  const to = await recipientEmail(mfr);
  if (!to) return { emailed: false };
  const label = order.orderType === "bulk" ? "Bulk order" : "Sample";
  const html = renderBrandthreadEmail({
    preheader: `${order.title} is paid and ready for production.`,
    eyebrow: "Payment received",
    title: `${label} paid`,
    subtitle: `${order.title} · ${order.quantity.toLocaleString("en-US")} pcs · ${formatCents(order.priceCents)}`,
    bodyHtml: "<p>The seller paid this order card. Start production and post each stage in Brandthread so the payout is released on time.</p>",
    cta: { label: "Open the order", url: portalUrl(`/orders/${order.id}`) },
  });
  const emailed = await sendBrandthreadEmail({
    to,
    subject: `${label} paid: ${order.title}`,
    html,
    idempotencyKey: `manufacturer-order-paid/${order.id}`,
  });
  return { emailed };
}

