/**
 * Thread Cash — platform-funded buyer reward credit.
 *
 * Thread Cash is NOT money: it can't be cashed out, withdrawn, or converted
 * to money. It is earned via a daily check-in with weekly streaks and spent
 * only toward purchases in the app.
 *
 * GET  /api/thread-cash             — balance, streak state, config, history
 * POST /api/thread-cash/check-in    — claim today's check-in (server-time, tz-aware)
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
import { computeCheckIn, EMPTY_STREAK_STATE, type StreakState } from "../lib/threadCash/streaks";
import { notifyThreadCashReceived } from "../lib/activityEvents";
import {
  ThreadCashError,
  cancelThreadCash,
  claimThreadCash,
  awardDailyCheckInOnce,
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
