/**
 * Payout controls for connected accounts (BT-468 / BT-471).
 *
 * New-account payout delay
 *   Every new seller or manufacturer Connect account gets its payouts delayed
 *   by NEW_ACCOUNT_PAYOUT_DELAY_DAYS (Stripe settings.payouts.schedule
 *   .delay_days) for its first NEW_ACCOUNT_REVIEW_DAYS. Charges made in that
 *   window reach the bank a week later, which leaves time to catch a seller
 *   who ships nothing before the money is gone (Express negative balances are
 *   the platform's liability). The payout-review job steps the delay down to
 *   Stripe's minimum once the window ends; an admin can release it earlier.
 *
 * Admin hold
 *   Sets the account's schedule to `manual` (Stripe stops automatic payouts)
 *   and remembers the previous schedule; release restores it. While held the
 *   seller can't request a payout or change their schedule (routes/finance.ts).
 *
 * Every admin change is written to the admin audit log in the same
 * transaction as the payout_controls row. Hold/release are idempotent: a
 * second hold of a held account (or release of a released one) changes
 * nothing and makes no Stripe call.
 */
import { and, eq, inArray, lte, sql } from "drizzle-orm";
import type Stripe from "stripe";
import { db, manufacturers, payoutControls, users, type PayoutPartyType } from "@workspace/db";
import { stripe as defaultStripe } from "../stripe";
import { recordAdminAction, type AdminActor } from "./audit";
import { logger } from "../logger";

/** Payout delay for a brand-new connected account. */
export const NEW_ACCOUNT_PAYOUT_DELAY_DAYS = 7;
/** How long the new-account delay lasts before stepping down to Stripe's minimum. */
export const NEW_ACCOUNT_REVIEW_DAYS = 30;
/** Connected-account balances shown on the payout review list are cached this long. */
export const BALANCE_CACHE_MS = 60_000;

type StripeLike = Pick<Stripe, "accounts" | "balance">;
type Log = { warn(obj: object, msg: string): void; info?(obj: object, msg: string): void };

export class PayoutControlError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) { super(message); }
}

export function isPayoutPartyType(v: unknown): v is PayoutPartyType {
  return v === "seller" || v === "manufacturer";
}

async function resolveParty(partyType: PayoutPartyType, partyId: string): Promise<{ stripeAccountId: string | null; name: string } | null> {
  if (partyType === "seller") {
    const [u] = await db.select({ acct: users.stripeAccountId, name: users.name, brandName: users.brandName, displayName: users.displayName })
      .from(users).where(eq(users.clerkId, partyId)).limit(1);
    return u ? { stripeAccountId: u.acct, name: u.brandName || u.displayName || u.name } : null;
  }
  if (!/^[0-9a-f-]{36}$/i.test(partyId)) return null;
  const [m] = await db.select({ acct: manufacturers.stripeAccountId, name: manufacturers.businessName })
    .from(manufacturers).where(eq(manufacturers.id, partyId)).limit(1);
  return m ? { stripeAccountId: m.acct, name: m.name } : null;
}

/**
 * Called right after a Connect account is created. Never throws: onboarding
 * must not fail because the delay couldn't be set (it's logged and the row
 * records delayDays = null so the review list shows it).
 */
export async function applyNewAccountPayoutDelay(input: {
  partyType: PayoutPartyType; partyId: string; stripeAccountId: string; client?: StripeLike | null; log?: Log; now?: Date;
}): Promise<boolean> {
  const client = input.client === undefined ? defaultStripe : input.client;
  const now = input.now ?? new Date();
  let applied = false;
  if (client) {
    try {
      await client.accounts.update(input.stripeAccountId, {
        settings: { payouts: { schedule: { delay_days: NEW_ACCOUNT_PAYOUT_DELAY_DAYS } } },
      });
      applied = true;
    } catch (err) {
      (input.log ?? logger).warn({ err, partyType: input.partyType, partyId: input.partyId }, "Could not set the new-account payout delay");
    }
  }
  try {
    await db.insert(payoutControls).values({
      partyType: input.partyType,
      partyId: input.partyId,
      stripeAccountId: input.stripeAccountId,
      state: "new_account_delay",
      delayDays: applied ? NEW_ACCOUNT_PAYOUT_DELAY_DAYS : null,
      delayUntil: new Date(now.getTime() + NEW_ACCOUNT_REVIEW_DAYS * 86_400_000),
    }).onConflictDoNothing();
  } catch (err) {
    (input.log ?? logger).warn({ err, partyType: input.partyType, partyId: input.partyId }, "Could not record the new-account payout delay");
  }
  return applied;
}

/** True while an admin hold is in force (the seller can't pay out or change schedule). */
export async function isPayoutHeld(partyType: PayoutPartyType, partyId: string): Promise<boolean> {
  const [row] = await db.select({ state: payoutControls.state }).from(payoutControls)
    .where(and(eq(payoutControls.partyType, partyType), eq(payoutControls.partyId, partyId))).limit(1);
  return row?.state === "held";
}

function scheduleSnapshot(account: any): Record<string, unknown> | null {
  const s = account?.settings?.payouts?.schedule;
  if (!s) return null;
  return { interval: s.interval ?? null, weekly_anchor: s.weekly_anchor ?? null, monthly_anchor: s.monthly_anchor ?? null, delay_days: s.delay_days ?? null };
}

/** The Stripe schedule params that put `snapshot` back. */
export function restoreScheduleParams(snapshot: Record<string, unknown> | null): Stripe.AccountUpdateParams.Settings.Payouts.Schedule {
  const interval = (snapshot?.interval as string | null) ?? "daily";
  const out: Stripe.AccountUpdateParams.Settings.Payouts.Schedule = { interval: interval as any };
  if (interval === "weekly" && snapshot?.weekly_anchor) out.weekly_anchor = snapshot.weekly_anchor as any;
  if (interval === "monthly" && snapshot?.monthly_anchor) out.monthly_anchor = Number(snapshot.monthly_anchor);
  if (typeof snapshot?.delay_days === "number") out.delay_days = snapshot.delay_days;
  return out;
}

type ActionResult = { ok: true; duplicate: boolean; state: string };

async function lockRow(tx: any, partyType: PayoutPartyType, partyId: string, stripeAccountId: string) {
  await tx.insert(payoutControls).values({ partyType, partyId, stripeAccountId, state: "released" }).onConflictDoNothing();
  const [row] = await tx.select().from(payoutControls)
    .where(and(eq(payoutControls.partyType, partyType), eq(payoutControls.partyId, partyId))).for("update").limit(1);
  return row as typeof payoutControls.$inferSelect;
}

export async function holdPayouts(input: {
  partyType: PayoutPartyType; partyId: string; reason: string; actor: AdminActor; client?: StripeLike | null;
}): Promise<ActionResult> {
  const client = input.client === undefined ? defaultStripe : input.client;
  const party = await resolveParty(input.partyType, input.partyId);
  if (!party) throw new PayoutControlError("Account not found", 404, "NOT_FOUND");
  if (!party.stripeAccountId) throw new PayoutControlError("This account hasn't connected Stripe payouts yet.", 409, "NO_CONNECT_ACCOUNT");
  if (!client) throw new PayoutControlError("Stripe is unavailable", 503, "STRIPE_UNAVAILABLE");
  const acct = party.stripeAccountId;
  return db.transaction(async (tx) => {
    const row = await lockRow(tx, input.partyType, input.partyId, acct);
    if (row.state === "held") return { ok: true as const, duplicate: true, state: "held" };
    const account = await client.accounts.retrieve(acct);
    const previous = scheduleSnapshot(account);
    await client.accounts.update(acct, { settings: { payouts: { schedule: { interval: "manual" } } } });
    const now = new Date();
    await tx.update(payoutControls).set({
      state: "held", previousSchedule: previous, reason: input.reason, heldBy: input.actor.clerkId, heldAt: now,
      stripeAccountId: acct, updatedAt: now,
    }).where(eq(payoutControls.id, row.id));
    await recordAdminAction(input.actor, {
      action: "payouts.hold", targetType: input.partyType, targetId: input.partyId,
      summary: `Held payouts for ${party.name}: ${input.reason}`,
      metadata: { stripeAccountId: acct, previousSchedule: previous, previousState: row.state },
    }, tx);
    return { ok: true as const, duplicate: false, state: "held" };
  });
}

export async function releasePayouts(input: {
  partyType: PayoutPartyType; partyId: string; reason: string; actor: AdminActor; client?: StripeLike | null; now?: Date;
}): Promise<ActionResult> {
  const client = input.client === undefined ? defaultStripe : input.client;
  const party = await resolveParty(input.partyType, input.partyId);
  if (!party) throw new PayoutControlError("Account not found", 404, "NOT_FOUND");
  if (!party.stripeAccountId) throw new PayoutControlError("This account hasn't connected Stripe payouts yet.", 409, "NO_CONNECT_ACCOUNT");
  if (!client) throw new PayoutControlError("Stripe is unavailable", 503, "STRIPE_UNAVAILABLE");
  const acct = party.stripeAccountId;
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const row = await lockRow(tx, input.partyType, input.partyId, acct);
    if (row.state === "released") return { ok: true as const, duplicate: true, state: "released" };
    // A held account goes back to exactly what it had; releasing a new-account
    // delay early drops it to Stripe's minimum.
    const schedule = row.state === "held"
      ? restoreScheduleParams(row.previousSchedule ?? null)
      : { delay_days: "minimum" as const };
    if (row.state === "held" && row.previousSchedule == null) schedule.delay_days = "minimum";
    await client.accounts.update(acct, { settings: { payouts: { schedule } } });
    const stillInNewWindow = row.state === "held" && typeof schedule.delay_days === "number"
      && row.delayUntil != null && row.delayUntil > now && row.delayDays != null;
    const nextState = stillInNewWindow ? "new_account_delay" : "released";
    await tx.update(payoutControls).set({
      state: nextState, releasedBy: input.actor.clerkId, releasedAt: now, reason: input.reason || row.reason, updatedAt: now,
    }).where(eq(payoutControls.id, row.id));
    await recordAdminAction(input.actor, {
      action: "payouts.release", targetType: input.partyType, targetId: input.partyId,
      summary: `Released payouts for ${party.name}${input.reason ? `: ${input.reason}` : ""}`,
      metadata: { stripeAccountId: acct, previousState: row.state, restoredSchedule: schedule, nextState },
    }, tx);
    return { ok: true as const, duplicate: false, state: nextState };
  });
}

/**
 * Payout-review job step: new-account delays whose window ended go down to
 * Stripe's minimum. Guarded by a transaction-scoped advisory try-lock so
 * overlapping runs (or several API instances) never process the same rows.
 */
export async function stepDownExpiredPayoutDelays(now = new Date(), client: StripeLike | null = defaultStripe): Promise<number> {
  if (!client) return 0;
  return db.transaction(async (tx) => {
    const lock = await tx.execute(sql`SELECT pg_try_advisory_xact_lock(hashtext('job:payout-review')) AS ok`);
    if (!(lock as any).rows?.[0]?.ok) return 0;
    const due = await tx.select().from(payoutControls)
      .where(and(eq(payoutControls.state, "new_account_delay"), lte(payoutControls.delayUntil, now))).limit(200);
    let done = 0;
    for (const row of due) {
      if (!row.stripeAccountId) continue;
      try {
        await client.accounts.update(row.stripeAccountId, { settings: { payouts: { schedule: { delay_days: "minimum" } } } });
      } catch (err) {
        logger.warn({ err, partyId: row.partyId }, "Payout review: could not lift the new-account delay");
        continue;
      }
      await tx.update(payoutControls).set({ state: "released", releasedBy: "system:payout-review", releasedAt: now, updatedAt: now })
        .where(and(eq(payoutControls.id, row.id), eq(payoutControls.state, "new_account_delay")));
      done += 1;
    }
    return done;
  });
}

// ─── Payout review list ──────────────────────────────────────────────────────

const balanceCache = new Map<string, { at: number; value: { availableCents: number; pendingCents: number } | null }>();

export function clearBalanceCache(): void { balanceCache.clear(); }

async function connectedBalance(client: StripeLike | null, acct: string, nowMs: number) {
  const hit = balanceCache.get(acct);
  if (hit && nowMs - hit.at < BALANCE_CACHE_MS) return hit.value;
  let value: { availableCents: number; pendingCents: number } | null = null;
  if (client) {
    try {
      const b = await client.balance.retrieve({}, { stripeAccount: acct });
      const usd = (list: Array<{ amount: number; currency: string }> | undefined) =>
        (list ?? []).filter((x) => x.currency === "usd").reduce((s, x) => s + x.amount, 0);
      value = { availableCents: usd(b.available as any), pendingCents: usd(b.pending as any) };
    } catch {
      value = null;
    }
  }
  balanceCache.set(acct, { at: nowMs, value });
  return value;
}

export async function payoutReviewList(opts: { state?: "review" | "held" | "all"; client?: StripeLike | null; now?: Date } = {}) {
  const client = opts.client === undefined ? defaultStripe : opts.client;
  const now = opts.now ?? new Date();
  const states = opts.state === "held" ? ["held"] : opts.state === "all" ? ["new_account_delay", "held", "released"] : ["new_account_delay", "held"];
  const rows = await db.select().from(payoutControls)
    .where(inArray(payoutControls.state, states as any)).orderBy(sql`${payoutControls.state} = 'held' DESC, ${payoutControls.createdAt} DESC`).limit(200);
  const sellerIds = rows.filter((r) => r.partyType === "seller").map((r) => r.partyId);
  const mfrIds = rows.filter((r) => r.partyType === "manufacturer").map((r) => r.partyId);
  const [sellers, mfrs, sales] = await Promise.all([
    sellerIds.length ? db.select({ id: users.clerkId, name: users.name, brandName: users.brandName, displayName: users.displayName, createdAt: users.createdAt, suspendedAt: users.suspendedAt })
      .from(users).where(inArray(users.clerkId, sellerIds)) : [],
    mfrIds.length ? db.select({ id: manufacturers.id, name: manufacturers.businessName, createdAt: manufacturers.createdAt })
      .from(manufacturers).where(inArray(manufacturers.id, mfrIds)) : [],
    sellerIds.length ? db.execute(sql`SELECT owner_id, COALESCE(sum(total_cents), 0) AS gmv, count(*) AS n FROM orders
      WHERE owner_id IN (${sql.join(sellerIds.map((id) => sql`${id}`), sql`, `)}) AND paid_at IS NOT NULL GROUP BY owner_id`) : { rows: [] },
  ]);
  const sellerById = new Map(sellers.map((s) => [s.id, s]));
  const mfrById = new Map(mfrs.map((m) => [String(m.id), m]));
  const gmvById = new Map(((sales as any).rows ?? []).map((r: any) => [r.owner_id, { gmvCents: Number(r.gmv), orders: Number(r.n) }]));
  const items = await Promise.all(rows.map(async (r) => {
    const s = r.partyType === "seller" ? sellerById.get(r.partyId) : undefined;
    const m = r.partyType === "manufacturer" ? mfrById.get(r.partyId) : undefined;
    const balance = r.stripeAccountId ? await connectedBalance(client, r.stripeAccountId, now.getTime()) : null;
    return {
      id: r.id,
      partyType: r.partyType,
      partyId: r.partyId,
      name: s ? (s.brandName || s.displayName || s.name) : m ? m.name : "Unknown",
      suspended: s?.suspendedAt != null,
      accountCreatedAt: (s?.createdAt ?? m?.createdAt ?? r.createdAt).toISOString(),
      state: r.state,
      delayDays: r.delayDays,
      delayUntil: r.delayUntil?.toISOString() ?? null,
      reason: r.reason,
      heldAt: r.heldAt?.toISOString() ?? null,
      sales: (gmvById.get(r.partyId) as { gmvCents: number; orders: number } | undefined) ?? { gmvCents: 0, orders: 0 },
      balance,
    };
  }));
  return { items };
}
