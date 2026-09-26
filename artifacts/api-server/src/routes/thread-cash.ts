/**
 * Thread Cash — platform-funded buyer reward credit.
 *
 * Thread Cash is NOT money: it can't be cashed out, withdrawn, or converted
 * to money. It is earned via a daily check-in with weekly streaks and spent
 * only toward purchases in the app.
 *
 * GET  /api/thread-cash             — balance, streak state, config, history
 * POST /api/thread-cash/check-in    — DEPRECATED, kept for older clients; claim today's
 *                                      check-in (server-time, tz-aware)
 * POST /api/thread-cash/daily/heartbeat — record ~60s of active foreground time today
 * POST /api/thread-cash/daily/claim     — claim today's reward once 7 cumulative active
 *                                      minutes (and enough heartbeats) have been recorded
 * GET  /api/thread-cash/history     — paginated ledger
 * POST /api/thread-cash/redeem      — reserve balance as a checkout discount token
 *                                      (feature-flagged: 'threadCashCheckoutDiscount')
 * POST /api/thread-cash/send        — send Thread Cash to a friend in chat (mutual-follow required)
 * POST /api/thread-cash/claim       — claim a Thread Cash send
 * POST /api/thread-cash/cancel      — sender cancels a still-pending send
 *                                      (send/claim/cancel feature-flagged: 'threadCashSend')
 */
import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, threadCashStreaks } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { computeCheckIn, localDateString, EMPTY_STREAK_STATE, type StreakState } from "../lib/threadCash/streaks";
import { notifyThreadCashReceived } from "../lib/activityEvents";
import {
  ThreadCashError,
  cancelThreadCash,
  claimThreadCash,
  awardDailyCheckInOnce,
  awardDailyActiveTimeClaimOnce,
  recordThreadCashHeartbeat,
  getBalanceCents,
  getHistory,
  getThreadCashConfig,
  isFeatureEnabled,
  redeemThreadCash,
  sendThreadCash,
} from "../lib/threadCash/wallet";

const router = Router();
router.use(requireAuth);

// Loose shape check only — computeCheckIn/localDateString fall back to UTC
// for anything Intl.DateTimeFormat itself rejects as an unknown zone.
const PLAUSIBLE_TIMEZONE_PATTERN = /^[A-Za-z0-9_+/-]{1,64}$/;

function normalizeTimezone(raw: unknown): string {
  return typeof raw === "string" && PLAUSIBLE_TIMEZONE_PATTERN.test(raw) ? raw : "UTC";
}

async function loadStreakState(buyerId: string): Promise<{ state: StreakState; timezone: string }> {
  const [row] = await db.select().from(threadCashStreaks).where(eq(threadCashStreaks.buyerId, buyerId)).limit(1);
  if (!row) return { state: EMPTY_STREAK_STATE, timezone: "UTC" };
  return {
    state: {
      currentStreak: row.currentStreak,
      longestStreak: row.longestStreak,
      lastCheckInDate: row.lastCheckInDate,
    },
    timezone: row.timezone,
  };
}

// ─── GET /api/thread-cash ───────────────────────────────────────────────────
router.get("/", async (req, res) => {
  const buyerId = (req as any).clerkUserId as string;
  const [balanceCents, config, { state, timezone }] = await Promise.all([
    getBalanceCents(db, buyerId),
    getThreadCashConfig(),
    loadStreakState(buyerId),
  ]);
  const preview = computeCheckIn(state, config, new Date(), timezone);
  res.json({
    balanceCents,
    config,
    streak: {
      currentStreak: state.currentStreak,
      longestStreak: state.longestStreak,
      lastCheckInDate: state.lastCheckInDate,
      timezone,
      alreadyCheckedInToday: preview.alreadyCheckedInToday,
      dayInCycle: preview.dayInCycle,
    },
  });
});

// ─── POST /api/thread-cash/check-in ─────────────────────────────────────────
// Body: { timezone?: string, deviceId?: string }
// "Server time" is authoritative: `now` is this server's clock, never a
// client-supplied timestamp. `timezone` only picks which calendar day the
// buyer is currently in; a spoofed timezone can shift a claim by a few hours
// at a day boundary but can never grant a second check-in for the same day
// twice, since the awarded reference is the exact resulting local date and
// the DB enforces one row per (buyer, date).
router.post("/check-in", async (req, res) => {
  const buyerId = (req as any).clerkUserId as string;
  const timezone = normalizeTimezone(req.body?.timezone);
  const deviceId = typeof req.body?.deviceId === "string" ? req.body.deviceId.slice(0, 128) : null;

  const [config, { state: previousState }] = await Promise.all([
    getThreadCashConfig(),
    loadStreakState(buyerId),
  ]);
  const now = new Date();
  const result = computeCheckIn(previousState, config, now, timezone);

  if (result.alreadyCheckedInToday) {
    res.status(409).json({
      error: "You've already checked in today.",
      code: "THREAD_CASH_ALREADY_CHECKED_IN",
      streak: { ...result.state, timezone, dayInCycle: result.dayInCycle },
    });
    return;
  }

  let created: boolean;
  try {
    ({ created } = await awardDailyCheckInOnce({
      buyerId,
      localDate: result.state.lastCheckInDate!,
      earnedCents: result.earnedCents,
      streakBonusCents: result.streakBonusCents,
      deviceId,
    }));
  } catch (error) {
    if (error instanceof ThreadCashError) {
      res.status(error.status).json({ error: error.message, code: error.code });
      return;
    }
    throw error;
  }

  // A concurrent request may have already claimed this exact local date
  // between the read above and the award; the unique index is the real
  // guard, this just keeps the persisted streak row from double-incrementing.
  if (created) {
    await db.insert(threadCashStreaks).values({
      buyerId,
      timezone,
      currentStreak: result.state.currentStreak,
      longestStreak: result.state.longestStreak,
      lastCheckInDate: result.state.lastCheckInDate,
      lastCheckInAt: now,
      lastDeviceId: deviceId,
    }).onConflictDoUpdate({
      target: threadCashStreaks.buyerId,
      set: {
        timezone,
        currentStreak: result.state.currentStreak,
        longestStreak: result.state.longestStreak,
        lastCheckInDate: result.state.lastCheckInDate,
        lastCheckInAt: now,
        lastDeviceId: deviceId,
        updatedAt: now,
      },
    });
  }

  const balanceCents = await getBalanceCents(db, buyerId);
  res.json({
    ok: true,
    earnedCents: created ? result.earnedCents : 0,
    streakBonusCents: created ? result.streakBonusCents : 0,
    streakBroken: result.streakBroken,
    balanceCents,
    streak: {
      currentStreak: result.state.currentStreak,
      longestStreak: result.state.longestStreak,
      lastCheckInDate: result.state.lastCheckInDate,
      timezone,
      dayInCycle: result.dayInCycle,
      streakBonusDays: config.streakBonusDays,
    },
  });
});

// ─── POST /api/thread-cash/daily/heartbeat ──────────────────────────────────
// Body: { timezone?: string }. Fired roughly every 60s the app is
// foregrounded. Purely additive bookkeeping — never itself pays out
// anything — so it's safe to call liberally; /daily/claim is what actually
// checks the accumulated count against the config gate.
router.post("/daily/heartbeat", async (req, res) => {
  const buyerId = (req as any).clerkUserId as string;
  const timezone = normalizeTimezone(req.body?.timezone);
  const activeSeconds = Math.max(0, Math.floor(Number(req.body?.activeSeconds)) || 0);
  const localDate = localDateString(new Date(), timezone);
  const { heartbeatCount } = await recordThreadCashHeartbeat(buyerId, localDate, activeSeconds);
  res.json({ ok: true, heartbeatCount });
});

// ─── POST /api/thread-cash/daily/claim ──────────────────────────────────────
// Body: { timezone?: string, deviceId?: string, activeSeconds: number }.
// Replaces the button-tap /check-in as the buyer-facing trigger: the client
// calls this once its cumulative foreground time for today reaches 420s.
// "Server time" is still authoritative for which calendar day this is, same
// as /check-in — see that handler's note.
router.post("/daily/claim", async (req, res) => {
  const buyerId = (req as any).clerkUserId as string;
  const timezone = normalizeTimezone(req.body?.timezone);
  const deviceId = typeof req.body?.deviceId === "string" ? req.body.deviceId.slice(0, 128) : null;
  const activeSeconds = Math.max(0, Math.floor(Number(req.body?.activeSeconds)) || 0);

  const [config, { state: previousState }] = await Promise.all([
    getThreadCashConfig(),
    loadStreakState(buyerId),
  ]);
  const now = new Date();
  const result = computeCheckIn(previousState, config, now, timezone);

  if (result.alreadyCheckedInToday) {
    res.status(409).json({
      error: "You've already claimed today's Thread Cash.",
      code: "THREAD_CASH_ALREADY_CHECKED_IN",
      streak: { ...result.state, timezone, dayInCycle: result.dayInCycle },
    });
    return;
  }

  let created: boolean;
  try {
    ({ created } = await awardDailyActiveTimeClaimOnce({
      buyerId,
      localDate: result.state.lastCheckInDate!,
      earnedCents: result.earnedCents,
      streakBonusCents: result.streakBonusCents,
      deviceId,
      activeSeconds,
    }));
  } catch (error) {
    if (error instanceof ThreadCashError) {
      res.status(error.status).json({ error: error.message, code: error.code });
      return;
    }
    throw error;
  }

  if (created) {
    await db.insert(threadCashStreaks).values({
      buyerId,
      timezone,
      currentStreak: result.state.currentStreak,
      longestStreak: result.state.longestStreak,
      lastCheckInDate: result.state.lastCheckInDate,
      lastCheckInAt: now,
      lastDeviceId: deviceId,
    }).onConflictDoUpdate({
      target: threadCashStreaks.buyerId,
      set: {
        timezone,
        currentStreak: result.state.currentStreak,
        longestStreak: result.state.longestStreak,
        lastCheckInDate: result.state.lastCheckInDate,
        lastCheckInAt: now,
        lastDeviceId: deviceId,
        updatedAt: now,
      },
    });
  }

  const balanceCents = await getBalanceCents(db, buyerId);
  res.json({
    ok: true,
    earnedCents: created ? result.earnedCents : 0,
    streakBonusCents: created ? result.streakBonusCents : 0,
    streakBroken: result.streakBroken,
    balanceCents,
    streak: {
      currentStreak: result.state.currentStreak,
      longestStreak: result.state.longestStreak,
      lastCheckInDate: result.state.lastCheckInDate,
      timezone,
      dayInCycle: result.dayInCycle,
      streakBonusDays: config.streakBonusDays,
    },
  });
});

// ─── GET /api/thread-cash/history ───────────────────────────────────────────
router.get("/history", async (req, res) => {
  const buyerId = (req as any).clerkUserId as string;
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? "50"), 10) || 50));
  const history = await getHistory(buyerId, limit);
  res.json({ history });
});

// ─── POST /api/thread-cash/redeem ───────────────────────────────────────────
// Reserves Thread Cash as a checkout discount token. Kept behind the same
// flag as the checkout hook itself: applying it is only safe once checkout
// can fund the discount without changing seller payout (see PR description).
router.post("/redeem", async (req, res) => {
  const buyerId = (req as any).clerkUserId as string;
  if (!(await isFeatureEnabled("threadCashCheckoutDiscount"))) {
    res.status(403).json({
      error: "Spending Thread Cash at checkout isn't available yet.",
      code: "THREAD_CASH_CHECKOUT_DISABLED",
    });
    return;
  }
  const amountCents = Math.floor(Number(req.body?.amountCents));
  if (!amountCents || amountCents < 1) {
    res.status(400).json({ error: "Provide a valid Thread Cash amount." });
    return;
  }
  const idempotencyKey = typeof req.body?.idempotencyKey === "string" ? req.body.idempotencyKey.trim() : "";
  if (!idempotencyKey) {
    res.status(400).json({ error: "A valid idempotency key is required.", code: "THREAD_CASH_IDEMPOTENCY_KEY_REQUIRED" });
    return;
  }
  try {
    const redemption = await redeemThreadCash(buyerId, amountCents, idempotencyKey);
    res.json({ ok: true, discountCents: redemption.discountCents, token: redemption.token });
  } catch (error) {
    if (error instanceof ThreadCashError) {
      res.status(error.status).json({ error: error.message, code: error.code });
      return;
    }
    throw error;
  }
});

// ─── POST /api/thread-cash/send, /claim, /cancel ────────────────────────────
// Peer-to-peer transfer between friends who follow each other (mutual
// follow, checked at both send and claim). Feature-flagged as a server-side
// kill switch only — 'threadCashSend' is ON by default.
router.post("/send", async (req, res) => {
  const buyerId = (req as any).clerkUserId as string;
  if (!(await isFeatureEnabled("threadCashSend", true))) {
    res.status(503).json({ error: "Sending Thread Cash isn't available right now.", code: "THREAD_CASH_SEND_DISABLED" });
    return;
  }
  const { recipientId, conversationId, note, amountCents: rawAmount } = req.body ?? {};
  const amountCents = Math.floor(Number(rawAmount));
  if (typeof recipientId !== "string" || !recipientId.trim()) {
    res.status(400).json({ error: "A recipient is required." });
    return;
  }
  if (!amountCents || amountCents < 1) {
    res.status(400).json({ error: "Provide a valid Thread Cash amount." });
    return;
  }
  const idempotencyKey = typeof req.body?.idempotencyKey === "string" ? req.body.idempotencyKey.trim() : "";
  if (!idempotencyKey) {
    res.status(400).json({ error: "A valid idempotency key is required.", code: "THREAD_CASH_IDEMPOTENCY_KEY_REQUIRED" });
    return;
  }
  try {
    const transfer = await sendThreadCash(buyerId, recipientId.trim(), amountCents, {
      conversationId: typeof conversationId === "string" ? conversationId : null,
      note: typeof note === "string" ? note : null,
      idempotencyKey,
    });
    void notifyThreadCashReceived({
      transferId: transfer.transferId,
      fromUserId: buyerId,
      toUserId: recipientId.trim(),
      amountCents,
    });
    res.json({ ok: true, transferId: transfer.transferId });
  } catch (error) {
    if (error instanceof ThreadCashError) {
      res.status(error.status).json({ error: error.message, code: error.code });
      return;
    }
    throw error;
  }
});

router.post("/claim", async (req, res) => {
  const buyerId = (req as any).clerkUserId as string;
  if (!(await isFeatureEnabled("threadCashSend", true))) {
    res.status(503).json({ error: "Sending Thread Cash isn't available right now.", code: "THREAD_CASH_SEND_DISABLED" });
    return;
  }
  const transferId = typeof req.body?.transferId === "string" ? req.body.transferId : "";
  if (!transferId) {
    res.status(400).json({ error: "A transfer id is required." });
    return;
  }
  try {
    const claimed = await claimThreadCash(transferId, buyerId);
    res.json({ ok: true, amountCents: claimed.amountCents });
  } catch (error) {
    if (error instanceof ThreadCashError) {
      res.status(error.status).json({ error: error.message, code: error.code });
      return;
    }
    throw error;
  }
});

router.post("/cancel", async (req, res) => {
  const buyerId = (req as any).clerkUserId as string;
  if (!(await isFeatureEnabled("threadCashSend", true))) {
    res.status(503).json({ error: "Sending Thread Cash isn't available right now.", code: "THREAD_CASH_SEND_DISABLED" });
    return;
  }
  const transferId = typeof req.body?.transferId === "string" ? req.body.transferId : "";
  if (!transferId) {
    res.status(400).json({ error: "A transfer id is required." });
    return;
  }
  try {
    await cancelThreadCash(transferId, buyerId);
    res.json({ ok: true });
  } catch (error) {
    if (error instanceof ThreadCashError) {
      res.status(error.status).json({ error: error.message, code: error.code });
      return;
    }
    throw error;
  }
});

export default router;
