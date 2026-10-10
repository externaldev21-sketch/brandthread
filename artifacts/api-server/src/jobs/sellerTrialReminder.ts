/**
 * Day-four seller trial reminder.
 *
 * Event creation is deliberately separate from delivery draining. Creation is
 * strict day four only; a leased event can still be drained on day five after
 * a late-day provider failure, while every drain rechecks the live trial.
 */
import { and, eq, gte, isNull, lte, or, sql, count } from "drizzle-orm";
import {
  db,
  notificationsFeed,
  orders,
  products,
  sellerTrialReminderEvents,
  users,
} from "@workspace/db";
import { logger } from "../lib/logger";
import { sendPushToUser, stableNotificationId } from "../lib/push";
import { PLAN_CATALOGUE, type SellerPlanId } from "../lib/planCatalogue";

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

function entitledFeatures(plan: string | null): string[] {
  const planId = (plan && plan in PLAN_CATALOGUE ? plan : "starter") as SellerPlanId;
  if (planId === "pro") return ["your storefront", "unlimited products", "advanced analytics", "priority support"];
  if (planId === "growth") return ["your storefront", "unlimited products", "AI Design Studio", "manufacturer tools"];
  return ["your storefront", "up to 25 products", "AI store builder", "standard checkout"];
}

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
  const entitled = entitledFeatures(input.plan ?? null);
  const ends = input.trialEndsAt.toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
  const body = usedFeatures.length
    ? `You’ve already built ${usedFeatures.join(" and ")}. Keep ${usedFeatures.join(" and ")} plus ${entitled.slice(0, 2).join(" and ")} when your free trial ends on ${ends}.`
    : `Keep ${entitled.join(", ")} when your free trial ends on ${ends}. Start selling before your trial converts to paid access.`;
  return { title: `Your free trial ends on ${ends}`, body, usedFeatures, entitledFeatures: entitled };
}

/** A Stripe 5-day trial's fourth 24-hour day, strictly. */
export function isDayFourOfFive(start: Date, end: Date, now: Date): boolean {
  const elapsed = now.getTime() - start.getTime();
  return end.getTime() - start.getTime() === 5 * DAY_MS
    && elapsed >= 3 * DAY_MS && elapsed < 4 * DAY_MS;
}

/** The event may be drained during day four or the still-valid day five. */
export function isReminderWindowOpen(start: Date, end: Date, now: Date): boolean {
  const elapsed = now.getTime() - start.getTime();
  return end.getTime() - start.getTime() === 5 * DAY_MS
    && elapsed >= 3 * DAY_MS && elapsed < 5 * DAY_MS;
}

export function isPendingTrialReminderDeliverable(input: {
  sellerStatus: string | null;
  currentTrialStartedAt: Date | null;
  currentTrialEndsAt: Date | null;
  eventTrialEndsAt: Date;
  subscriptionPreference: boolean | undefined;
  now: Date;
}): boolean {
  return input.sellerStatus === "trialing"
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
    lte(users.subscriptionTrialStartedAt, now),
    gte(users.subscriptionTrialEndsAt, now),
  ));
  for (const seller of eligible) {
    if (!seller.trialStartedAt || !seller.trialEndsAt || !isDayFourOfFive(seller.trialStartedAt, seller.trialEndsAt, now)) continue;
    await db.insert(sellerTrialReminderEvents).values({
      sellerId: seller.clerkId,
      trialEndAt: seller.trialEndsAt,
    }).onConflictDoNothing();
  }
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
    sellerStatus: users.subscriptionStatus,
    currentTrialStartedAt: users.subscriptionTrialStartedAt,
    currentTrialEndsAt: users.subscriptionTrialEndsAt,
    plan: users.subscriptionPlanId,
    preferences: users.notificationPreferences,
    digest: users.notificationDigest,
  }).from(sellerTrialReminderEvents)
    .leftJoin(users, eq(users.clerkId, sellerTrialReminderEvents.sellerId))
    .where(and(retryDue(now), isNull(sellerTrialReminderEvents.sentAt)));

  for (const event of events) {
    // This validation happens immediately before claiming, not only when the
    // event was created. Cancellations, changed trial dates, and opt-outs
    // therefore suppress a pending delivery.
    if (!isPendingTrialReminderDeliverable({
      sellerStatus: event.sellerStatus,
      currentTrialStartedAt: event.currentTrialStartedAt,
      currentTrialEndsAt: event.currentTrialEndsAt,
      eventTrialEndsAt: event.trialEndAt,
      subscriptionPreference: event.preferences?.subscription_trial,
      now,
    })) {
      const cancelled = event.sellerStatus !== "trialing"
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
            trialEndsAt: event.trialEndAt.toISOString(),
          },
        }, "subscription");
        if (!delivered) throw new Error("Immediate trial reminder push was not delivered");
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