/**
 * Seller trial reminder, sent TRIAL_REMINDER_DAYS_BEFORE days before the
 * first charge (lib/planCatalogue.ts: a 7-day trial reminds on day 5).
 *
 * Goes out by push (or the in-app feed for daily-digest sellers) AND email,
 * each with a link straight to manage / cancel. Covers Stripe trials and
 * App Store / Play trials (RevenueCat); a trial the seller already cancelled
 * gets no reminder, since it won't be charged.
 *
 * Event creation is deliberately separate from delivery draining. Creation is
 * strict to the reminder day only; a leased event can still be drained until
 * the trial ends after a late-day provider failure, while every drain
 * rechecks the live trial.
 */
import { and, eq, gte, isNull, lte, or, sql, count } from "drizzle-orm";
import {
  db,
  notificationsFeed,
  orders,
  products,
  sellerSubscriptionEntitlements,
  sellerTrialReminderEvents,
  users,
} from "@workspace/db";
import { logger } from "../lib/logger";
import { sendPushToUser, stableNotificationId } from "../lib/push";
import { PLAN_CATALOGUE, TRIAL_DAYS, TRIAL_REMINDER_DAYS_BEFORE, type SellerPlanId } from "../lib/planCatalogue";
import { manageUrlFor, nativeSubscriptionDetails } from "../lib/sellerTrial";
import { sendTrialReminderEmail } from "../lib/brandthreadEmail";

const DAY_MS = 24 * 60 * 60 * 1000;
const INTERVAL_MS = 60 * 60 * 1000;
const CLAIM_LEASE_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;

export type TrialReminderMessage = {
  title: string;
  body: string;
  usedFeatures: string[];
  entitledFeatures: string[];
};

function planOf(plan: string | null | undefined): SellerPlanId {
  return (plan && plan in PLAN_CATALOGUE ? plan : "starter") as SellerPlanId;
}

/** What the plan includes, from the plan config, so the copy always matches the plan. */
function entitledFeatures(plan: string | null): string[] {
  const p = PLAN_CATALOGUE[planOf(plan)];
  const cap = p.limits.products;
  return [
    "your storefront",
    cap === null ? "unlimited products" : `up to ${cap} live products`,
    ...(p.features.liveSelling ? ["live selling"] : []),
    ...(p.features.prioritySupport ? ["priority support"] : []),
  ];
}

export function formatPlanAmount(cents: number): string {
  return `$${(cents / 100).toFixed(2).replace(/\.00$/, "")}`;
}

/**
 * Dev's reminder: what is charged, when, and that cancelling before then
 * costs nothing (copy matches behaviour, App Store 3.1.2).
 */
export function buildTrialReminderMessage(input: {
  productsUsed?: number;
  ordersUsed?: number;
  plan?: string | null;
  trialEndsAt: Date;
}): TrialReminderMessage {
  const usedFeatures: string[] = [];
  if (typeof input.productsUsed === "number" && input.productsUsed > 0) {
    usedFeatures.push(`${input.productsUsed} product${input.productsUsed === 1 ? "" : "s"}`);
  }
  if (typeof input.ordersUsed === "number" && input.ordersUsed > 0) {
    usedFeatures.push(`${input.ordersUsed} order${input.ordersUsed === 1 ? "" : "s"}`);
  }
  const plan = PLAN_CATALOGUE[planOf(input.plan)];
  const ends = input.trialEndsAt.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const charge = `Your ${plan.label} plan starts on ${ends} at ${formatPlanAmount(plan.amountCents)}/month. Cancel anytime before then and you won't be charged.`;
  const body = usedFeatures.length
    ? `You've built ${usedFeatures.join(" and ")} so far. ${charge}`
    : charge;
  return { title: `Your free trial ends ${ends}`, body, usedFeatures, entitledFeatures: entitledFeatures(input.plan ?? null) };
}

/** Whole days in a trial, or null when the window isn't a whole number of days. */
function trialLengthDays(start: Date, end: Date): number | null {
  const days = (end.getTime() - start.getTime()) / DAY_MS;
  return Number.isInteger(days) && days > TRIAL_REMINDER_DAYS_BEFORE ? days : null;
}

/**
 * The reminder day, strictly: the 24-hour day that ends `reminderDaysBefore`
 * days before the charge (day 5 of a 7-day trial with the default 2).
 */
export function isTrialReminderDay(start: Date, end: Date, now: Date, reminderDaysBefore = TRIAL_REMINDER_DAYS_BEFORE): boolean {
  const days = trialLengthDays(start, end);
  if (days === null || days <= reminderDaysBefore) return false;
  const elapsed = now.getTime() - start.getTime();
  const day = days - reminderDaysBefore; // 1-indexed day of the trial
  return elapsed >= (day - 1) * DAY_MS && elapsed < day * DAY_MS;
}

/** Kept for existing callers (routes/subscription.ts trial banner). */
export const isDayFourOfFive = isTrialReminderDay;

/** The event may be drained from the reminder day until the trial ends. */
export function isReminderWindowOpen(start: Date, end: Date, now: Date, reminderDaysBefore = TRIAL_REMINDER_DAYS_BEFORE): boolean {
  const days = trialLengthDays(start, end);
  if (days === null || days <= reminderDaysBefore) return false;
  const elapsed = now.getTime() - start.getTime();
  return elapsed >= (days - reminderDaysBefore - 1) * DAY_MS && elapsed < days * DAY_MS;
}

export function isPendingTrialReminderDeliverable(input: {
  sellerStatus: string | null;
  /** The seller cancelled the trial: it won't be charged, so no reminder. */
  cancelAtPeriodEnd?: boolean;
  currentTrialStartedAt: Date | null;
  currentTrialEndsAt: Date | null;
  eventTrialEndsAt: Date;
  subscriptionPreference: boolean | undefined;
  now: Date;
}): boolean {
  return input.sellerStatus === "trialing"
    && input.cancelAtPeriodEnd !== true
    && input.subscriptionPreference !== false
    && !!input.currentTrialStartedAt
    && !!input.currentTrialEndsAt
    && input.currentTrialEndsAt.getTime() === input.eventTrialEndsAt.getTime()
    && isReminderWindowOpen(input.currentTrialStartedAt, input.currentTrialEndsAt, input.now);
}

function retryDue(now: Date) {
  return and(
    lte(sellerTrialReminderEvents.nextAttemptAt, now),
    isNull(sellerTrialReminderEvents.sentAt),
    sql`${sellerTrialReminderEvents.attemptCount} < ${MAX_ATTEMPTS}`,
    or(
      eq(sellerTrialReminderEvents.status, "pending"),
      and(
        eq(sellerTrialReminderEvents.status, "sending"),
        lte(sellerTrialReminderEvents.leaseExpiresAt, now),
      ),
    ),
  );
}

async function createEligibleEvents(now: Date): Promise<void> {
  const eligible = await db.select({
    clerkId: users.clerkId,
    trialStartedAt: users.subscriptionTrialStartedAt,
    trialEndsAt: users.subscriptionTrialEndsAt,
  }).from(users).where(and(
    eq(users.accountType, "seller"),
    eq(users.subscriptionStatus, "trialing"),
    eq(users.subscriptionCancelAtPeriodEnd, false),
    lte(users.subscriptionTrialStartedAt, now),
    gte(users.subscriptionTrialEndsAt, now),
  ));
  for (const seller of eligible) {
    if (!seller.trialStartedAt || !seller.trialEndsAt || !isDayFourOfFive(seller.trialStartedAt, seller.trialEndsAt, now)) continue;
    await db.insert(sellerTrialReminderEvents).values({
      sellerId: seller.clerkId,
      trialEndAt: seller.trialEndsAt,
      // Due now, so this same run delivers it (the column default is the
      // database clock, a moment after `now`, which pushed it to the next hour).
      nextAttemptAt: now,
    }).onConflictDoNothing();
  }

  // App Store / Play trials (RevenueCat).
  const nativeTrials = await db.select({
    clerkId: sellerSubscriptionEntitlements.clerkUserId,
    trialEndsAt: sellerSubscriptionEntitlements.trialEndsAt,
    expiresAt: sellerSubscriptionEntitlements.expiresAt,
  }).from(sellerSubscriptionEntitlements).where(and(
    eq(sellerSubscriptionEntitlements.provider, "revenuecat"),
    eq(sellerSubscriptionEntitlements.status, "trial"),
    gte(sellerSubscriptionEntitlements.expiresAt, now),
  ));
  for (const trial of nativeTrials) {
    const window = nativeTrialWindow(trial);
    if (!window || !isTrialReminderDay(window.start, window.end, now)) continue;
    await db.insert(sellerTrialReminderEvents).values({
      sellerId: trial.clerkId,
      trialEndAt: window.end,
      // Due now, so this same run delivers it (the column default is the
      // database clock, a moment after `now`, which pushed it to the next hour).
      nextAttemptAt: now,
    }).onConflictDoNothing();
  }
}

/**
 * A native trial's window. RevenueCat reports when it ends; the store trial
 * is TRIAL_DAYS long (the 1-week introductory offer), so it started then.
 */
export function nativeTrialWindow(row: { trialEndsAt: Date | null; expiresAt: Date | null }): { start: Date; end: Date } | null {
  const end = row.trialEndsAt ?? row.expiresAt;
  if (!end) return null;
  return { start: new Date(end.getTime() - TRIAL_DAYS * DAY_MS), end };
}

type CurrentTrial = {
  status: string | null;
  start: Date | null;
  end: Date | null;
  cancelAtPeriodEnd: boolean;
  manageUrl: string;
};

/** The seller's live trial on whichever rail it runs, for the drain's recheck. */
export function currentTrialOf(input: {
  stripeStatus: string | null;
  stripeTrialStartedAt: Date | null;
  stripeTrialEndsAt: Date | null;
  stripeCancelAtPeriodEnd: boolean | null;
  native: { status: string; trialEndsAt: Date | null; expiresAt: Date | null; providerData?: unknown } | null;
}): CurrentTrial {
  if (input.stripeStatus === "trialing") {
    return {
      status: "trialing",
      start: input.stripeTrialStartedAt,
      end: input.stripeTrialEndsAt,
      cancelAtPeriodEnd: input.stripeCancelAtPeriodEnd === true,
      manageUrl: manageUrlFor("stripe"),
    };
  }
  if (input.native?.status === "trial") {
    const window = nativeTrialWindow(input.native);
    const details = nativeSubscriptionDetails(input.native);
    return {
      status: "trialing",
      start: window?.start ?? null,
      end: window?.end ?? null,
      cancelAtPeriodEnd: details.willRenew === false,
      manageUrl: manageUrlFor("revenuecat", details),
    };
  }
  return { status: input.stripeStatus, start: null, end: null, cancelAtPeriodEnd: false, manageUrl: manageUrlFor("stripe") };
}

async function markTerminal(eventId: string, status: string, error: string): Promise<void> {
  await db.update(sellerTrialReminderEvents).set({
    status,
    lastError: error,
    claimedAt: null,
    leaseExpiresAt: null,
  }).where(eq(sellerTrialReminderEvents.id, eventId));
}

async function drainEvents(now: Date): Promise<void> {
  const events = await db.select({
    eventId: sellerTrialReminderEvents.id,
    sellerId: sellerTrialReminderEvents.sellerId,
    trialEndAt: sellerTrialReminderEvents.trialEndAt,
    attemptCount: sellerTrialReminderEvents.attemptCount,
    stripeStatus: users.subscriptionStatus,
    stripeTrialStartedAt: users.subscriptionTrialStartedAt,
    stripeTrialEndsAt: users.subscriptionTrialEndsAt,
    stripeCancelAtPeriodEnd: users.subscriptionCancelAtPeriodEnd,
    stripePlan: users.subscriptionPlanId,
    email: users.email,
    preferences: users.notificationPreferences,
    digest: users.notificationDigest,
    native: sellerSubscriptionEntitlements,
  }).from(sellerTrialReminderEvents)
    .leftJoin(users, eq(users.clerkId, sellerTrialReminderEvents.sellerId))
    .leftJoin(sellerSubscriptionEntitlements, and(
      eq(sellerSubscriptionEntitlements.clerkUserId, sellerTrialReminderEvents.sellerId),
      eq(sellerSubscriptionEntitlements.provider, "revenuecat"),
    ))
    .where(and(retryDue(now), isNull(sellerTrialReminderEvents.sentAt)));

  for (const row of events) {
    const trial = currentTrialOf(row);
    const event = {
      ...row,
      sellerStatus: trial.status,
      currentTrialStartedAt: trial.start,
      currentTrialEndsAt: trial.end,
      plan: row.stripeStatus === "trialing" ? row.stripePlan : row.native?.planId ?? row.stripePlan,
    };
    // This validation happens immediately before claiming, not only when the
    // event was created. Cancellations, changed trial dates, and opt-outs
    // therefore suppress a pending delivery.
    if (!isPendingTrialReminderDeliverable({
      sellerStatus: event.sellerStatus,
      cancelAtPeriodEnd: trial.cancelAtPeriodEnd,
      currentTrialStartedAt: event.currentTrialStartedAt,
      currentTrialEndsAt: event.currentTrialEndsAt,
      eventTrialEndsAt: event.trialEndAt,
      subscriptionPreference: event.preferences?.subscription_trial,
      now,
    })) {
      const cancelled = event.sellerStatus !== "trialing"
        || trial.cancelAtPeriodEnd
        || !event.currentTrialStartedAt
        || !event.currentTrialEndsAt
        || event.currentTrialEndsAt.getTime() !== event.trialEndAt.getTime();
      await markTerminal(
        event.eventId,
        cancelled
          ? "cancelled"
          : event.preferences?.subscription_trial === false ? "suppressed" : "expired",
        cancelled
          ? "Seller trial is no longer active"
          : event.preferences?.subscription_trial === false
            ? "Seller disabled subscription trial reminders"
            : now.getTime() >= event.trialEndAt.getTime()
              ? "Trial ended before reminder delivery"
              : "Reminder was not in the strict five-day trial window",
      );
      continue;
    }

    const [claimed] = await db.update(sellerTrialReminderEvents).set({
      status: "sending",
      claimedAt: now,
      leaseExpiresAt: new Date(now.getTime() + CLAIM_LEASE_MS),
      attemptCount: sql`${sellerTrialReminderEvents.attemptCount} + 1`,
    }).where(and(
      eq(sellerTrialReminderEvents.id, event.eventId),
      retryDue(now),
    )).returning({ id: sellerTrialReminderEvents.id });
    if (!claimed) continue;

    try {
      const [[{ value: productsUsed }], [{ value: ordersUsed }]] = await Promise.all([
        db.select({ value: count() }).from(products).where(eq(products.ownerId, event.sellerId)),
        db.select({ value: count() }).from(orders).where(eq(orders.ownerId, event.sellerId)),
      ]);
      const message = buildTrialReminderMessage({
        productsUsed: Number(productsUsed ?? 0),
        ordersUsed: Number(ordersUsed ?? 0),
        plan: event.plan,
        trialEndsAt: event.trialEndAt,
      });
      const notificationId = stableNotificationId(
        "seller-trial-day-4", event.sellerId, event.trialEndAt.toISOString(),
      );

      const plan = PLAN_CATALOGUE[planOf(event.plan)];
      // Email goes out alongside push / the feed; the reminder counts as sent
      // when at least one channel delivered it.
      const emailed = event.email
        ? await sendTrialReminderEmail({
            to: event.email,
            planLabel: plan.label,
            amount: formatPlanAmount(plan.amountCents),
            trialEndsAt: event.trialEndAt,
            manageUrl: trial.manageUrl,
            idempotencyKey: `trial-reminder/${event.eventId}`,
          }).catch(() => false)
        : false;

      if (event.digest === "daily") {
        await db.insert(notificationsFeed).values({
          userId: event.sellerId,
          category: "subscription",
          type: "subscription_trial_day_4",
          title: message.title,
          body: message.body,
          targetId: event.trialEndAt.toISOString(),
          targetType: "subscription",
          cta: "Manage subscription",
        }).onConflictDoNothing();
      } else {
        const delivered = await sendPushToUser(event.sellerId, {
          title: message.title,
          body: message.body,
          data: {
            notificationId,
            type: "subscription_trial_day_4",
            route: "/subscription",
            manageUrl: trial.manageUrl,
            trialEndsAt: event.trialEndAt.toISOString(),
          },
        }, "subscription");
        if (!delivered && !emailed) throw new Error("Trial reminder was not delivered by push or email");
      }

      await db.update(sellerTrialReminderEvents).set({
        status: "sent",
        sentAt: new Date(),
        claimedAt: null,
        leaseExpiresAt: null,
        lastError: null,
      }).where(eq(sellerTrialReminderEvents.id, event.eventId));
    } catch (err) {
      const attemptCount = event.attemptCount + 1;
      const retry = attemptCount < MAX_ATTEMPTS;
      const error = err instanceof Error ? err.message.slice(0, 500) : "Trial reminder delivery failed";
      await db.update(sellerTrialReminderEvents).set({
        status: retry ? "pending" : "failed",
        nextAttemptAt: new Date(now.getTime() + (
          retry ? Math.min(30 * 60 * 1000, 5 * 60 * 1000 * 2 ** Math.max(0, attemptCount - 1)) : 0
        )),
        lastError: error,
        claimedAt: null,
        leaseExpiresAt: null,
      }).where(eq(sellerTrialReminderEvents.id, event.eventId));
    }
  }
}

export async function runSellerTrialReminder(now = new Date()): Promise<void> {
  try {
    await createEligibleEvents(now);
    await drainEvents(now);
  } catch (err) {
    logger.error({ err, job: "sellerTrialReminder" }, "Seller trial reminder job failed");
  }
}

export function startSellerTrialReminderJob(): void {
  setTimeout(() => { void runSellerTrialReminder(); }, 5 * 60 * 1000);
  setInterval(() => { void runSellerTrialReminder(); }, INTERVAL_MS);
  logger.info({ job: "sellerTrialReminder", intervalMs: INTERVAL_MS }, "Seller trial reminder job scheduled");
}