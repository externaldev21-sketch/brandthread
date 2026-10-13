/**
 * Thread Cash weekly quests, mounted under /api/thread-cash/weekly-quests
 * (behind that router's requireAuth; POSTs are covered by the app-wide
 * "mutation" rate limit like every other Thread Cash write).
 *
 * GET  /             — this week's quests, progress, reward, claimed, week streak
 * POST /claim        — pays the reward once every quest is complete; idempotent
 *
 * Buyer-only: a seller-only account (account_type 'seller') gets 403.
 */
import { Router, type RequestHandler } from "express";
import { eq } from "drizzle-orm";
import { db, users } from "@workspace/db";
import { ThreadCashError } from "../lib/threadCash/wallet";
import { claimWeeklyQuests, getWeeklyQuestsStatus } from "../lib/threadCash/weeklyQuests";

const router = Router();

const requireBuyerAccount: RequestHandler = async (req, res, next) => {
  const userId = (req as any).clerkUserId as string | undefined;
  if (!userId) {
    res.status(401).json({ error: "Sign in to continue." });
    return;
  }
  const [row] = await db.select({ accountType: users.accountType }).from(users).where(eq(users.clerkId, userId)).limit(1);
  if (row?.accountType === "seller") {
    res.status(403).json({ error: "Weekly quests are for shopper accounts.", code: "WEEKLY_QUESTS_BUYER_ONLY" });
    return;
  }
  next();
};

router.use(requireBuyerAccount);

router.get("/", async (req, res) => {
  const buyerId = (req as any).clerkUserId as string;
  res.json(await getWeeklyQuestsStatus(buyerId));
});

router.post("/claim", async (req, res) => {
  const buyerId = (req as any).clerkUserId as string;
  try {
    const result = await claimWeeklyQuests(buyerId);
    res.json({ ok: true, ...result.status, created: result.created, amountCents: result.amountCents, balanceCents: result.balanceCents });
  } catch (error) {
    if (error instanceof ThreadCashError) {
      res.status(error.status).json({ error: error.message, code: error.code });
      return;
    }
    throw error;
  }
});

export default router;
