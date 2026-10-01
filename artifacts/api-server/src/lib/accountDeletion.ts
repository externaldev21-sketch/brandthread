import crypto from "node:crypto";
import { clerkClient } from "@clerk/express";
import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { accountDeletionCodes, db, users } from "@workspace/db";
import { isMailerConfigured, sendAccountDeletionCodeEmail } from "./mailer";

/** The destructive endpoint deliberately accepts no aliases or whitespace. */
export function hasDeletionConfirmation(body: unknown): boolean {
  return !!body && typeof body === "object" && (body as { confirmation?: unknown }).confirmation === "DELETE";
}

/**
 * Something that must be settled before an account can be deleted without
 * hurting another person: a buyer waiting for an order, money still held for
 * a drop, an open dispute. Each blocker tells the user exactly what to do.
 */
export interface DeletionBlocker {
  code:
    | "seller_open_orders"
    | "seller_held_funds"
    | "seller_reserved_label_funds"
    | "seller_open_returns"
    | "seller_open_disputes"
    | "seller_payout_in_flight"
    | "buyer_orders_awaiting_shipment";
  title: string;
  detail: string;
  count: number;
  amountCents: number | null;
  /** In-app route that resolves the blocker. */
  actionRoute: string;
  actionLabel: string;
}

/** Shipped orders stop blocking deletion after this long without delivery. */
export const SHIPPED_ORDER_SETTLEMENT_DAYS = 30;

async function first<T extends Record<string, unknown>>(query: ReturnType<typeof sql>): Promise<T> {
  const result = await db.execute(query);
  return (((result as any).rows?.[0]) ?? {}) as T;
}

function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

function money(cents: number) {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Every reason `clerkUserId` cannot delete their account right now. An empty
 * array means deletion may proceed. Checks both seller and buyer obligations
 * because an account's history can include both.
 */
export async function getDeletionBlockers(clerkUserId: string): Promise<DeletionBlocker[]> {
  const blockers: DeletionBlocker[] = [];

  const [sellerOrders, heldFunds, labelFunds, sellerReturns, sellerDisputes, payouts, buyerOrders] = await Promise.all([
    // Paid orders the seller still owes a buyer. Shipped orders count until
    // delivery, or until they have been in transit for 30 days.
    first<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM orders
      WHERE owner_id = ${clerkUserId}
        AND paid_at IS NOT NULL
        AND status NOT IN ('delivered', 'cancelled', 'refunded', 'returned')
        AND NOT (
          status IN ('shipped', 'fulfilled')
          AND COALESCE(shipped_at, updated_at) < NOW() - (${SHIPPED_ORDER_SETTLEMENT_DAYS} * INTERVAL '1 day')
        )`),
    // Preorder / drop money collected but not yet released per order.
    first<{ n: number; cents: number }>(sql`
      SELECT count(*)::int AS n,
             COALESCE(SUM(GREATEST(balance_cents - released_cents, 0)), 0)::int AS cents
      FROM drop_wallets
      WHERE seller_id = ${clerkUserId} AND balance_cents - released_cents > 0`),
    first<{ n: number; cents: number }>(sql`
      SELECT count(*)::int AS n, COALESCE(SUM(amount_cents), 0)::int AS cents
      FROM order_fund_reservations
      WHERE owner_id = ${clerkUserId} AND status = 'reserved'`),
    first<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM returns
      WHERE seller_id = ${clerkUserId} AND status IN ('pending', 'approved')`),
    first<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM disputes
      WHERE seller_id = ${clerkUserId} AND status NOT IN ('won', 'lost', 'closed')`),
    first<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM seller_cashout_attempts
      WHERE owner_id = ${clerkUserId} AND status = 'processing'`),
    // A buyer's paid order that has not shipped yet: the seller still needs
    // the shipping address, which deletion would erase.
    first<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM orders
      WHERE buyer_id = ${clerkUserId}
        AND paid_at IS NOT NULL
        AND status IN ('pending', 'processing', 'label_purchasing')`),
  ]);

  const n = (value: unknown) => Number(value ?? 0);

  if (n(sellerOrders.n) > 0) {
    blockers.push({
      code: "seller_open_orders",
      title: `${plural(n(sellerOrders.n), "open order")} to fulfill`,
      detail: "Ship or cancel and refund these orders. Shipped orders settle once they're delivered.",
      count: n(sellerOrders.n),
      amountCents: null,
      actionRoute: "/(tabs)/orders",
      actionLabel: "Review orders",
    });
  }
  if (n(heldFunds.n) > 0) {
    blockers.push({
      code: "seller_held_funds",
      title: `${money(n(heldFunds.cents))} held for preorders and drops`,
      detail: "Buyer money for your drops is released per order when tracking is added, or refunded if a drop is cancelled. Settle each drop first.",
      count: n(heldFunds.n),
      amountCents: n(heldFunds.cents),
      actionRoute: "/finance",
      actionLabel: "Open finance",
    });
  }
  if (n(labelFunds.n) > 0) {
    blockers.push({
      code: "seller_reserved_label_funds",
      title: `${money(n(labelFunds.cents))} reserved for shipping labels`,
      detail: "Finish or void the shipping labels that are still being purchased.",
      count: n(labelFunds.n),
      amountCents: n(labelFunds.cents),
      actionRoute: "/(tabs)/orders",
      actionLabel: "Review labels",
    });
  }
  if (n(sellerReturns.n) > 0) {
    blockers.push({
      code: "seller_open_returns",
      title: `${plural(n(sellerReturns.n), "return request")} to resolve`,
      detail: "Approve, refund or deny open return requests so buyers aren't left waiting.",
      count: n(sellerReturns.n),
      amountCents: null,
      actionRoute: "/(tabs)/orders",
      actionLabel: "Review returns",
    });
  }
  if (n(sellerDisputes.n) > 0) {
    blockers.push({
      code: "seller_open_disputes",
      title: `${plural(n(sellerDisputes.n), "payment dispute")} open`,
      detail: "Card disputes must be closed before the account can be removed.",
      count: n(sellerDisputes.n),
      amountCents: null,
      actionRoute: "/finance",
      actionLabel: "View disputes",
    });
  }
  if (n(payouts.n) > 0) {
    blockers.push({
      code: "seller_payout_in_flight",
      title: "A payout is on its way to your bank",
      detail: "Wait for the payout in progress to finish. This usually takes 1–2 business days.",
      count: n(payouts.n),
      amountCents: null,
      actionRoute: "/payouts",
      actionLabel: "View payouts",
    });
  }
  if (n(buyerOrders.n) > 0) {
    blockers.push({
      code: "buyer_orders_awaiting_shipment",
      title: `${plural(n(buyerOrders.n), "order")} waiting to ship`,
      detail: "The seller still needs your shipping address. Cancel the order or wait until it ships.",
      count: n(buyerOrders.n),
      amountCents: null,
      actionRoute: "/(buyer)/orders",
      actionLabel: "View orders",
    });
  }

  return blockers;
}

/** Days the "deletion cancelled" notice stays visible after signing back in. */
export const DELETION_CANCELLED_NOTICE_DAYS = 7;
/** Days the account stays hidden but cancellable (by signing back in) before it is purged. */
export const DELETION_GRACE_DAYS = 30;
/** How far a due purge is pushed back when new obligations have appeared. */
export const DELETION_POSTPONE_DAYS = 7;
export const DELETION_CODE_TTL_MS = 15 * 60_000;
export const DELETION_CODE_RESEND_MS = 60_000;

export function addDays(from: Date, days: number): Date {
  return new Date(from.getTime() + days * 86_400_000);
}

export function hashDeletionCode(code: string): string {
  return crypto.createHash("sha256").update(code).digest("hex");
}

export function generateDeletionCode(): string {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export function deletionCodeMatches(code: string, codeHash: string): boolean {
  const a = Buffer.from(hashDeletionCode(code), "hex");
  const b = Buffer.from(codeHash, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** An account inside its grace window: hidden everywhere, restorable. */
export function isPendingDeletion(row: { deletedAt?: Date | null; deletionRequestedAt?: Date | null }): boolean {
  return !row.deletedAt && !!row.deletionRequestedAt;
}

/**
 * Erase an account's personal data. Financial/tax records are kept but
 * stripped of direct personal data. The user row is deliberately kept as a
 * tombstone (clerk_id + deleted_at) so an old app cannot re-create it with
 * /auth/sync. Does NOT touch Clerk; the caller removes the sign-in afterwards.
 * Returns false when there is no such user row.
 */
export async function purgeAccount(clerkUserId: string): Promise<boolean> {
  const [account] = await db.select({ id: users.id }).from(users).where(eq(users.clerkId, clerkUserId)).limit(1);
  if (!account) return false;
  await db.transaction(async (tx) => {
    const deletedSubject = `deleted:${account.id}`;
    // Private, device, social, preference and draft data.
    await tx.execute(sql`DELETE FROM push_tokens WHERE user_id = ${clerkUserId}`);
    await tx.execute(sql`DELETE FROM buyer_addresses WHERE buyer_id = ${clerkUserId}`);
    await tx.execute(sql`DELETE FROM cart_items WHERE user_id = ${clerkUserId}`);
    await tx.execute(sql`DELETE FROM saved_items WHERE user_id = ${clerkUserId}`);
    await tx.execute(sql`DELETE FROM notifications_feed WHERE user_id = ${clerkUserId}`);
    await tx.execute(sql`DELETE FROM blocks WHERE blocker_id = ${clerkUserId} OR blocked_id = ${clerkUserId}`);
    await tx.execute(sql`DELETE FROM follows WHERE follower_id = ${clerkUserId} OR following_id = ${clerkUserId}`);
    await tx.execute(sql`DELETE FROM story_likes WHERE user_id = ${clerkUserId}`);
    await tx.execute(sql`DELETE FROM story_views WHERE user_id = ${clerkUserId}`);
    await tx.execute(sql`DELETE FROM interactions WHERE user_id = ${clerkUserId}`);
    await tx.execute(sql`DELETE FROM posts WHERE user_id = ${clerkUserId}`);
    await tx.execute(sql`DELETE FROM stories WHERE author_id = ${clerkUserId}`);
    await tx.execute(sql`DELETE FROM story_highlights WHERE user_id = ${clerkUserId}`);
    await tx.execute(sql`DELETE FROM story_archive WHERE author_id = ${clerkUserId}`);
    await tx.execute(sql`DELETE FROM close_friends WHERE owner_id = ${clerkUserId} OR friend_id = ${clerkUserId}`);
    await tx.execute(sql`DELETE FROM product_reserves WHERE user_id = ${clerkUserId}`);
    await tx.execute(sql`DELETE FROM waitlist_entries WHERE user_id = ${clerkUserId}`);
    await tx.execute(sql`DELETE FROM drop_alert_subscriptions WHERE user_id = ${clerkUserId}`);
    await tx.execute(sql`DELETE FROM checkout_sessions WHERE buyer_id = ${clerkUserId}`);
    await tx.execute(sql`DELETE FROM loyalty_points WHERE buyer_id = ${clerkUserId}`);
    await tx.execute(sql`DELETE FROM referrals WHERE inviter_id = ${clerkUserId} OR invitee_id = ${clerkUserId}`);
    await tx.execute(sql`DELETE FROM klaviyo_integrations WHERE owner_id = ${clerkUserId}`);
    await tx.execute(sql`DELETE FROM seller_subscription_entitlements WHERE clerk_user_id = ${clerkUserId}`);
    await tx.execute(sql`DELETE FROM post_comment_likes WHERE user_id = ${clerkUserId}`);
    await tx.execute(sql`DELETE FROM post_comments WHERE author_id = ${clerkUserId}`);
    await tx.execute(sql`DELETE FROM muted_words WHERE user_id = ${clerkUserId}`);
    await tx.execute(sql`DELETE FROM buyer_preferences WHERE user_id = ${clerkUserId}`);
    await tx.execute(sql`DELETE FROM user_contact_hashes WHERE user_id = ${clerkUserId}`);
    // Reports the person filed stay in the moderation record without
    // their identity; reports about their content keep the snapshot.
    await tx.execute(sql`UPDATE reports SET reporter_id = ${deletedSubject} WHERE reporter_id = ${clerkUserId}`);
    await tx.execute(sql`UPDATE reports SET target_owner_id = ${deletedSubject} WHERE target_owner_id = ${clerkUserId}`);

    // Conversations are private content. Preserve a counterpart's thread,
    // but remove the deleted person's messages, participant profile, and
    // cached message preview.
    await tx.execute(sql`UPDATE conversations SET last_message = NULL
      WHERE id IN (SELECT conversation_id FROM conversation_participants WHERE user_id = ${clerkUserId})`);
    await tx.execute(sql`DELETE FROM messages WHERE sender_id = ${clerkUserId}`);
    await tx.execute(sql`DELETE FROM conversation_participants WHERE user_id = ${clerkUserId}`);

    // Retained commerce records keep amounts/statuses/payment references for
    // legal and accounting purposes while removing customer-facing PII.
    await tx.execute(sql`UPDATE orders SET buyer_id = NULL, guest_email = NULL,
      shipping_address = NULL, notes = NULL, updated_at = NOW()
      WHERE buyer_id = ${clerkUserId}`);
    await tx.execute(sql`UPDATE orders SET owner_id = ${deletedSubject}, updated_at = NOW()
      WHERE owner_id = ${clerkUserId}`);
    await tx.execute(sql`UPDATE customers SET owner_id = ${deletedSubject},
      email = 'deleted@deleted.brandthread.invalid', name = 'Deleted customer',
      phone = NULL, address = NULL, updated_at = NOW() WHERE owner_id = ${clerkUserId}`);
    await tx.execute(sql`UPDATE returns SET notes = NULL, seller_response = NULL, evidence_urls = '[]'::json
      WHERE buyer_id = ${clerkUserId} OR seller_id = ${clerkUserId}`);
    await tx.execute(sql`UPDATE returns SET buyer_id = ${deletedSubject} WHERE buyer_id = ${clerkUserId}`);
    await tx.execute(sql`UPDATE returns SET seller_id = ${deletedSubject} WHERE seller_id = ${clerkUserId}`);
    await tx.execute(sql`UPDATE disputes SET seller_id = ${deletedSubject}, customer_claim = '', evidence_json = '[]'::json,
      stripe_evidence_details = '{}'::json, updated_at = NOW() WHERE seller_id = ${clerkUserId}`);
    await tx.execute(sql`UPDATE reviews SET buyer_id = 'deleted', body = NULL WHERE buyer_id = ${clerkUserId}`);
    await tx.execute(sql`UPDATE reviews SET seller_id = ${deletedSubject} WHERE seller_id = ${clerkUserId}`);

    // Seller catalog/profile content is no longer public. Products are
    // archived rather than deleted because historical order line items can
    // reference their variants.
    await tx.execute(sql`UPDATE products SET status = 'archived', images = '[]'::json,
      description = NULL, updated_at = NOW() WHERE owner_id = ${clerkUserId}`);
    await tx.execute(sql`DELETE FROM storefronts WHERE owner_id = ${clerkUserId}`);
    await tx.execute(sql`DELETE FROM seller_quote_requests WHERE seller_id = ${clerkUserId}`);
    await tx.execute(sql`DELETE FROM seller_tax_config WHERE seller_id = ${clerkUserId}`);
    await tx.execute(sql`DELETE FROM shipping_rates WHERE seller_id = ${clerkUserId}`);
    await tx.execute(sql`UPDATE discount_codes SET active = false WHERE seller_id = ${clerkUserId}`);

    // Remove all direct identity, auth/billing linkage and public profile
    // details. clerk_id remains solely as the non-reusable tombstone key.
    await tx.update(users).set({
      email: `deleted+${account.id}@deleted.brandthread.invalid`,
      name: "Deleted user", displayName: "Deleted user", avatarUrl: null,
      bio: null, profileImageUrl: null, username: null, brandName: null,
      brandType: null, brandStage: null, sellModel: null, website: null,
      stripeCustomerId: null, stripeAccountId: null, subscriptionId: null,
      stripeVerificationSessionId: null, notificationPreferences: {},
      termsAcceptedAt: null, termsVersion: null,
      deletedAt: new Date(), updatedAt: new Date(),
    }).where(eq(users.clerkId, clerkUserId));
  });
  return true;
}

// ─── Re-authentication ──────────────────────────────────────────────────────

export type ReauthMethod = "password" | "email_code";

export type ReauthFailure = { ok: false; status: number; code: string; error: string };
export type ReauthResult = { ok: true } | ReauthFailure;

function fail(status: number, code: string, error: string): ReauthFailure {
  return { ok: false, status, code, error };
}

/** Password accounts re-enter their password; OAuth-only accounts get an email code. */
export async function getReauthMethod(clerkUserId: string): Promise<ReauthMethod> {
  const clerkUser = await clerkClient.users.getUser(clerkUserId);
  return clerkUser.passwordEnabled ? "password" : "email_code";
}

function isClerkRejection(err: unknown): boolean {
  const status = (err as { status?: number })?.status;
  return status === 400 || status === 403 || status === 404 || status === 422;
}

/**
 * Fresh proof that the person at the keyboard owns the account, required on
 * the delete request itself. The password is only ever checked by Clerk.
 */
export async function verifyDeletionReauth(
  clerkUserId: string,
  body: { password?: unknown; code?: unknown },
): Promise<ReauthResult> {
  const method = await getReauthMethod(clerkUserId);

  if (method === "password") {
    const password = typeof body.password === "string" ? body.password : "";
    if (!password) return fail(401, "REAUTH_REQUIRED", "Enter your password to delete your account.");
    try {
      const result = await clerkClient.users.verifyPassword({ userId: clerkUserId, password });
      if (!result?.verified) return fail(403, "INVALID_PASSWORD", "That password isn't right.");
      return { ok: true };
    } catch (err) {
      if (isClerkRejection(err)) return fail(403, "INVALID_PASSWORD", "That password isn't right.");
      throw err;
    }
  }

  const code = typeof body.code === "string" ? body.code.trim() : "";
  if (!code) return fail(401, "REAUTH_REQUIRED", "Enter the 6-digit code we emailed you.");
  if (!/^\d{6}$/.test(code)) return fail(403, "INVALID_CODE", "Enter the 6-digit code.");

  const [latest] = await db.select().from(accountDeletionCodes)
    .where(eq(accountDeletionCodes.clerkId, clerkUserId))
    .orderBy(desc(accountDeletionCodes.createdAt))
    .limit(1);
  if (!latest || latest.usedAt) return fail(403, "INVALID_CODE", "That code isn't valid. Request a new one.");
  if (latest.expiresAt.getTime() < Date.now()) return fail(403, "CODE_EXPIRED", "That code has expired. Request a new one.");
  if (!deletionCodeMatches(code, latest.codeHash)) return fail(403, "INVALID_CODE", "That code isn't right. Check your email and try again.");

  // Single use: a concurrent retry of the same code cannot also succeed.
  const claimed = await db.update(accountDeletionCodes)
    .set({ usedAt: new Date() })
    .where(and(eq(accountDeletionCodes.id, latest.id), isNull(accountDeletionCodes.usedAt)))
    .returning({ id: accountDeletionCodes.id });
  if (claimed.length === 0) return fail(403, "INVALID_CODE", "That code isn't valid. Request a new one.");
  return { ok: true };
}

/** Email a fresh single-use code to an account that has no password. */
export async function issueDeletionCode(
  clerkUserId: string,
  email: string,
  now = new Date(),
): Promise<{ ok: true } | ReauthFailure> {
  if ((await getReauthMethod(clerkUserId)) !== "email_code") {
    return fail(400, "PASSWORD_REAUTH", "Enter your password to delete your account.");
  }
  if (!isMailerConfigured()) {
    return fail(422, "MAIL_NOT_CONFIGURED", "We can't send emails right now. Please try again shortly or contact support.");
  }
  const [recent] = await db.select({ createdAt: accountDeletionCodes.createdAt }).from(accountDeletionCodes)
    .where(eq(accountDeletionCodes.clerkId, clerkUserId))
    .orderBy(desc(accountDeletionCodes.createdAt))
    .limit(1);
  if (recent && now.getTime() - recent.createdAt.getTime() < DELETION_CODE_RESEND_MS) {
    return fail(429, "CODE_RECENTLY_SENT", "We just sent a code. Check your email, or wait a minute to request another.");
  }
  const code = generateDeletionCode();
  await db.insert(accountDeletionCodes).values({
    clerkId: clerkUserId,
    codeHash: hashDeletionCode(code),
    expiresAt: new Date(now.getTime() + DELETION_CODE_TTL_MS),
  });
  const sent = await sendAccountDeletionCodeEmail({ to: email, code });
  if (!sent) return fail(502, "MAIL_SEND_FAILED", "We couldn't send the code. Try again in a moment.");
  return { ok: true };
}

// ─── Soft delete (30-day grace) ─────────────────────────────────────────────

/** Mark the account for deletion and hide it. Returns the purge date, or null if nothing changed. */
export async function scheduleAccountDeletion(clerkUserId: string, now = new Date()): Promise<Date | null> {
  const scheduledFor = addDays(now, DELETION_GRACE_DAYS);
  const rows = await db.update(users)
    .set({ deletionRequestedAt: now, deletionScheduledFor: scheduledFor, deletionCancelledAt: null, updatedAt: now })
    .where(and(eq(users.clerkId, clerkUserId), isNull(users.deletedAt), isNull(users.deletionRequestedAt)))
    .returning({ id: users.id });
  return rows.length > 0 ? scheduledFor : null;
}

/** Cancel a pending deletion (signing back in does this via /auth/sync). False when not pending or already purged. */
export async function restoreAccount(clerkUserId: string, now = new Date()): Promise<boolean> {
  const rows = await db.update(users)
    .set({ deletionRequestedAt: null, deletionScheduledFor: null, deletionCancelledAt: now, updatedAt: now })
    .where(and(eq(users.clerkId, clerkUserId), isNull(users.deletedAt), isNotNull(users.deletionRequestedAt)))
    .returning({ id: users.id });
  return rows.length > 0;
}

/** Sign the person out everywhere. Clerk sign-in itself stays valid so they can restore. */
export async function revokeAllSessions(clerkUserId: string): Promise<number> {
  const list = await clerkClient.sessions.getSessionList({ userId: clerkUserId, status: "active", limit: 100 });
  await Promise.all(list.data.map((session) => clerkClient.sessions.revokeSession(session.id)));
  return list.data.length;
}

/**
 * Profile updates applied by /auth/sync. Signing back in during the grace
 * period cancels the pending deletion; any other account is left untouched.
 */
export function graceSyncUpdates(
  existing: { deletedAt?: Date | null; deletionRequestedAt?: Date | null },
  now = new Date(),
): { deletionRequestedAt: null; deletionScheduledFor: null; deletionCancelledAt: Date } | null {
  if (!isPendingDeletion(existing)) return null;
  return { deletionRequestedAt: null, deletionScheduledFor: null, deletionCancelledAt: now };
}

/** When a deletion was cancelled by signing back in, if recent enough to tell the person. */
export function recentDeletionCancellation(cancelledAt: Date | null | undefined, now = new Date()): string | null {
  if (!cancelledAt) return null;
  return now.getTime() - cancelledAt.getTime() <= DELETION_CANCELLED_NOTICE_DAYS * 86_400_000
    ? cancelledAt.toISOString()
    : null;
}
