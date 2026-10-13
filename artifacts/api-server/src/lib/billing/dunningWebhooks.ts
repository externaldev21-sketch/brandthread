/**
 * Webhook side effects for subscription dunning (item 115). The decisions are
 * pure (./dunning.ts); this file persists them, talks to Stripe and notifies
 * the seller (in-app feed + push + email).
 *
 * Events (add them to the Stripe webhook endpoint):
 *   invoice.payment_failed → applyDunningOnPaymentFailed (retry notice / pause)
 *   invoice.paid           → applyDunningOnInvoicePaid   (resume / clear)
 *   customer.updated       → applyDunningOnPaymentMethodUpdated
 *                             (new default card while paused → pay the open invoice)
 *
 * Idempotency: each step first claims the seller_subscription_dunning row with
 * a conditional upsert; only the claimant notifies or calls Stripe. If a
 * Stripe call fails the claim is rolled back and the error rethrown so the
 * webhook ledger fails the delivery and Stripe redelivers it.
 */
import { and, eq, sql } from "drizzle-orm";
import { db, notificationsFeed, sellerSubscriptionDunning, users } from "@workspace/db";
import { stripe as defaultStripe } from "../stripe";
import { logger } from "../logger";
import { sendPushToUser } from "../push";
import { renderBrandthreadEmail, sendBrandthreadEmail } from "../brandthreadEmail";
import { PLAN_CATALOGUE, isSellerPlanId } from "../planCatalogue";
import {
  DUNNING_PAUSED_METADATA_KEY,
  decidePaymentFailed,
  decidePaymentRecovered,
  dunningMaxRetries,
  pausedNoticeCopy,
  resumedNoticeCopy,
  retryNoticeCopy,
  dunningSummary,
  type DunningCopy,
  type DunningRecord,
  type DunningSummary,
} from "./dunning";

type StripeLike = {
  subscriptions: { update: (id: string, params: any, options?: any) => Promise<any> };
  invoices: { pay: (id: string, params?: any, options?: any) => Promise<any> };
};
let stripeOverride: StripeLike | null | undefined;
/** Test seam. */
export function setDunningStripe(client: StripeLike | null | undefined): void { stripeOverride = client; }
const stripeClient = (): StripeLike | null => (stripeOverride === undefined ? (defaultStripe as unknown as StripeLike | null) : stripeOverride);

const SUBSCRIPTION_URL = "https://brandthread.app/subscription";

type Seller = { clerkId: string; email: string | null; planId: string | null };

/** "Growth" from "Brandthread Growth Plan". */
function planLabel(planId: string | null): string {
  return isSellerPlanId(planId) ? PLAN_CATALOGUE[planId].name.replace(/^Brandthread\s+/, "").replace(/\s+Plan$/, "") : "seller";
}

async function loadRecord(clerkId: string): Promise<(DunningRecord & { subscriptionId: string }) | null> {
  const [row] = await db.select({
    invoiceId: sellerSubscriptionDunning.invoiceId,
    lastAttempt: sellerSubscriptionDunning.lastAttempt,
    pausedAt: sellerSubscriptionDunning.pausedAt,
    subscriptionId: sellerSubscriptionDunning.subscriptionId,
  }).from(sellerSubscriptionDunning).where(eq(sellerSubscriptionDunning.clerkUserId, clerkId)).limit(1);
  return row ?? null;
}

/**
 * Atomically move the row to (invoiceId, attempt) only when that is newer
 * than what is stored. Returns false when another delivery already did.
 */
async function claimAttempt(input: {
  clerkId: string; subscriptionId: string; invoiceId: string; attempt: number;
  maxRetries: number; nextRetryAt: Date | null; pause: boolean;
}): Promise<boolean> {
  const now = new Date();
  const t = sellerSubscriptionDunning;
  const values = {
    clerkUserId: input.clerkId,
    subscriptionId: input.subscriptionId,
    invoiceId: input.invoiceId,
    lastAttempt: input.attempt,
    maxRetries: input.maxRetries,
    nextRetryAt: input.pause ? null : input.nextRetryAt,
    pausedAt: input.pause ? now : null,
    resumedAt: null,
    updatedAt: now,
  };
  const rows = await db.insert(t).values(values).onConflictDoUpdate({
    target: t.clerkUserId,
    set: values,
    setWhere: sql`${t.invoiceId} IS DISTINCT FROM ${input.invoiceId}
      OR (${t.pausedAt} IS NULL AND ${t.lastAttempt} < ${input.attempt})`,
  }).returning({ clerkUserId: t.clerkUserId });
  return rows.length > 0;
}

async function restoreRecord(clerkId: string, previous: (DunningRecord & { subscriptionId: string }) | null): Promise<void> {
  const t = sellerSubscriptionDunning;
  if (!previous) {
    await db.delete(t).where(eq(t.clerkUserId, clerkId));
    return;
  }
  await db.update(t).set({
    invoiceId: previous.invoiceId, lastAttempt: previous.lastAttempt, pausedAt: previous.pausedAt, updatedAt: new Date(),
  }).where(eq(t.clerkUserId, clerkId));
}

async function notifySeller(seller: Seller, input: {
  type: string; targetId: string; copy: DunningCopy; cta: string; emailKey: string;
}): Promise<void> {
  const [notification] = await db.insert(notificationsFeed).values({
    userId: seller.clerkId,
    category: "system",
    type: input.type,
    title: input.copy.title,
    body: input.copy.body,
    targetId: input.targetId,
    targetType: "subscription_invoice",
    cta: input.cta,
  }).onConflictDoNothing().returning({ id: notificationsFeed.id });
  if (!notification) return;

  await sendPushToUser(seller.clerkId, {
    title: input.copy.title,
    body: input.copy.push,
    data: { notificationId: notification.id, type: input.type, route: "/subscription" },
  });

  // Billing email is transactional: always sent when Resend is configured
  // (sendBrandthreadEmail logs and returns false otherwise — never throws).
  if (seller.email) {
    const html = renderBrandthreadEmail({
      preheader: input.copy.push,
      eyebrow: "Billing",
      title: input.copy.title,
      bodyHtml: `<p>${input.copy.body.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</p>`,
      cta: { label: input.cta, url: SUBSCRIPTION_URL },
    });
    await sendBrandthreadEmail({ to: seller.email, subject: input.copy.emailSubject, html, idempotencyKey: input.emailKey });
  }
}

/**
 * Called by handleInvoicePaymentFailed once the invoice is confirmed to
 * belong to this seller's platform subscription.
 */
export async function applyDunningOnPaymentFailed(invoice: any, seller: Seller, subscriptionId: string): Promise<void> {
  const invoiceId = String(invoice.id);
  const maxRetries = dunningMaxRetries();
  const record = await loadRecord(seller.clerkId);
  const decision = decidePaymentFailed({
    invoiceId,
    attemptCount: invoice.attempt_count,
    nextPaymentAttempt: invoice.next_payment_attempt,
    maxRetries,
    record,
  });
  if (decision.kind === "ignore") {
    logger.info({ invoiceId, clerkId: seller.clerkId, reason: decision.reason }, "Dunning: failed invoice already handled");
    return;
  }

  const claimed = await claimAttempt({
    clerkId: seller.clerkId, subscriptionId, invoiceId, attempt: decision.attempt, maxRetries,
    nextRetryAt: decision.kind === "notify" ? decision.nextRetryAt : null, pause: decision.kind === "pause",
  });
  if (!claimed) {
    logger.info({ invoiceId, clerkId: seller.clerkId }, "Dunning: concurrent delivery already claimed this attempt");
    return;
  }

  const label = planLabel(seller.planId);
  if (decision.kind === "notify") {
    try {
      await notifySeller(seller, {
        type: "subscription_payment_failed",
        // Attempt 1 keeps the bare invoice id (one row per invoice, as before).
        targetId: decision.attempt === 1 ? invoiceId : `${invoiceId}:${decision.attempt}`,
        copy: retryNoticeCopy({ ...decision, planLabel: label }),
        cta: "Update card",
        emailKey: `dunning/${invoiceId}/${decision.attempt}`,
      });
    } catch (err) {
      await restoreRecord(seller.clerkId, record).catch(() => undefined);
      throw err;
    }
    logger.info({ invoiceId, clerkId: seller.clerkId, retry: decision.retryNumber, maxRetries }, "Dunning: retry notice sent");
    return;
  }

  // Pause: the last retry failed.
  const client = stripeClient();
  try {
    if (!client) throw new Error("Stripe is not configured; cannot pause subscription");
    await client.subscriptions.update(subscriptionId, {
      pause_collection: { behavior: "void" },
      // Stripe merges metadata keys, so #835's lastPausedAt is kept.
      metadata: { [DUNNING_PAUSED_METADATA_KEY]: new Date().toISOString() },
    }, { idempotencyKey: `dunning-pause/${invoiceId}` });
  } catch (err) {
    await restoreRecord(seller.clerkId, record).catch(() => undefined);
    throw err;
  }
  await db.update(users).set({ subscriptionStatus: "paused", updatedAt: new Date() })
    .where(eq(users.clerkId, seller.clerkId));
  try {
    await notifySeller(seller, {
      type: "subscription_plan_paused",
      targetId: invoiceId,
      copy: pausedNoticeCopy({ maxRetries, planLabel: label }),
      cta: "Update card",
      emailKey: `dunning-paused/${invoiceId}`,
    });
  } catch (err) {
    // The pause itself succeeded; a redelivery would be ignored as already
    // paused, so don't fail the webhook over the notice.
    logger.error({ err, invoiceId, clerkId: seller.clerkId }, "Dunning: plan paused but the notice failed");
  }
  logger.warn({ invoiceId, clerkId: seller.clerkId, subscriptionId, attempt: decision.attempt }, "Dunning: plan paused after final retry");
}

async function sellerByCustomer(customerId: string): Promise<(Seller & { subscriptionId: string | null }) | null> {
  const [row] = await db.select({
    clerkId: users.clerkId, email: users.email, planId: users.subscriptionPlanId, subscriptionId: users.subscriptionId,
  }).from(users).where(eq(users.stripeCustomerId, customerId)).limit(1);
  return row ?? null;
}

const idOf = (ref: unknown): string | undefined =>
  typeof ref === "string" ? ref : (ref as { id?: string } | null | undefined)?.id;

/**
 * The subscription an invoice bills. Webhook endpoints on API versions
 * before 2025-03-31 send invoice.subscription; newer ones send
 * invoice.parent.subscription_details.subscription.
 */
export function invoiceSubscriptionId(invoice: any): string | undefined {
  return idOf(invoice?.subscription) ?? idOf(invoice?.parent?.subscription_details?.subscription);
}

/** invoice.paid: resume a dunning-paused plan, or clear a retry sequence that recovered. */
export async function applyDunningOnInvoicePaid(invoice: any): Promise<void> {
  const customerId = idOf(invoice.customer);
  const subscriptionId = invoiceSubscriptionId(invoice);
  if (!customerId || !subscriptionId) return;
  const seller = await sellerByCustomer(customerId);
  if (!seller || seller.subscriptionId !== subscriptionId) return;
  const record = await loadRecord(seller.clerkId);
  const decision = decidePaymentRecovered({ record, subscriptionMetadata: invoice.parent?.subscription_details?.metadata ?? invoice.subscription_details?.metadata ?? null });
  if (decision.kind === "noop") return;

  const t = sellerSubscriptionDunning;
  // Claim the reset: only one delivery resumes and notifies.
  const reset = await db.update(t).set({
    invoiceId: null, lastAttempt: 0, nextRetryAt: null, pausedAt: null,
    resumedAt: decision.kind === "resume" ? new Date() : null, updatedAt: new Date(),
  }).where(and(eq(t.clerkUserId, seller.clerkId), sql`(${t.pausedAt} IS NOT NULL OR ${t.lastAttempt} > 0)`))
    .returning({ clerkUserId: t.clerkUserId });

  if (decision.kind === "clear") return;
  const client = stripeClient();
  try {
    if (!client) throw new Error("Stripe is not configured; cannot resume subscription");
    await client.subscriptions.update(subscriptionId, {
      pause_collection: "",
      metadata: { [DUNNING_PAUSED_METADATA_KEY]: "" },
    }, { idempotencyKey: `dunning-resume/${invoice.id}` });
  } catch (err) {
    if (reset.length > 0 && record) await restoreRecord(seller.clerkId, record).catch(() => undefined);
    throw err;
  }
  // customer.subscription.updated re-syncs the authoritative status; set it
  // now so features come back the moment the payment lands.
  await db.update(users).set({ subscriptionStatus: "active", updatedAt: new Date() })
    .where(and(eq(users.clerkId, seller.clerkId), eq(users.subscriptionStatus, "paused")));
  if (reset.length > 0) {
    await notifySeller(seller, {
      type: "subscription_plan_resumed",
      targetId: String(invoice.id),
      copy: resumedNoticeCopy(planLabel(seller.planId)),
      cta: "View plan",
      emailKey: `dunning-resumed/${invoice.id}`,
    }).catch((err) => logger.error({ err, invoiceId: invoice.id }, "Dunning: plan resumed but the notice failed"));
  }
  logger.info({ invoiceId: invoice.id, clerkId: seller.clerkId, subscriptionId }, "Dunning: plan resumed after payment");
}

/**
 * customer.updated: when a paused seller sets a new default payment method
 * (e.g. in the billing portal), charge the open invoice right away instead
 * of waiting — Stripe stops retrying after the last retry. Success arrives as
 * invoice.paid (→ resume); failure as another invoice.payment_failed, which
 * the state machine ignores for an already-paused invoice.
 */
export async function applyDunningOnPaymentMethodUpdated(customer: any, previousAttributes: Record<string, unknown> | null | undefined): Promise<void> {
  if (!previousAttributes || !("invoice_settings" in previousAttributes || "default_source" in previousAttributes)) return;
  const customerId = idOf(customer);
  if (!customerId) return;
  const seller = await sellerByCustomer(customerId);
  if (!seller) return;
  const record = await loadRecord(seller.clerkId);
  if (!record?.pausedAt || !record.invoiceId) return;
  const client = stripeClient();
  if (!client) return;
  try {
    await client.invoices.pay(record.invoiceId, {}, { idempotencyKey: `dunning-pay/${record.invoiceId}/${customer.invoice_settings?.default_payment_method ?? customer.default_source ?? "default"}` });
  } catch (err: any) {
    // Declined again, or already paid by the portal: both are reported by
    // their own invoice events, so this delivery is done.
    logger.info({ err: err?.message, clerkId: seller.clerkId, invoiceId: record.invoiceId }, "Dunning: paying open invoice after card update did not succeed");
  }
}

/** `dunning` for GET /api/seller/subscription/status (Stripe subscriptions). */
export async function loadDunningSummary(clerkId: string, subscriptionStatus: string | null | undefined): Promise<DunningSummary> {
  const [row] = await db.select({
    lastAttempt: sellerSubscriptionDunning.lastAttempt,
    maxRetries: sellerSubscriptionDunning.maxRetries,
    nextRetryAt: sellerSubscriptionDunning.nextRetryAt,
    pausedAt: sellerSubscriptionDunning.pausedAt,
  }).from(sellerSubscriptionDunning).where(eq(sellerSubscriptionDunning.clerkUserId, clerkId)).limit(1);
  return dunningSummary(row, subscriptionStatus);
}
