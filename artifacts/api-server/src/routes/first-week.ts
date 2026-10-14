/**
 * /api/first-week — the first-week checklist card.
 *
 *   GET  /                → { visible, role, steps[], allDone, reward: { cents, granted } | null }
 *   POST /dismiss         → hides the card forever
 *   POST /store-shared    → records that a seller shared their store link
 *
 * Steps are computed from real data on every read. When every step is done,
 * the read credits the Thread Cash reward once (ledger idempotency key
 * first-week:<userId>, behind the firstWeekReward flag). No pushes, no
 * emails — the card is the only surface.
 */
import { Router } from "express";
import { and, count, eq, isNull, ne, sql } from "drizzle-orm";
import {
  db, firstWeekChecklist, follows, posts, products, savedItems, threadCashEntries, users,
} from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";
import { assertThreadCashNotFrozen, isFeatureEnabled, ThreadCashError } from "../lib/threadCash/wallet";
import {
  allDone, firstWeekIdempotencyKey, firstWeekSteps, firstWeekVisible,
  FIRST_WEEK_REWARD_CENTS, FIRST_WEEK_REWARD_FLAG, type FirstWeekFacts,
} from "../lib/firstWeek";

const router = Router();
router.use(requireAuth);

async function loadFacts(userId: string): Promise<FirstWeekFacts | null> {
  const [me] = await db.select({
    accountType: users.accountType, createdAt: users.createdAt,
    profileImageUrl: users.profileImageUrl, avatarUrl: users.avatarUrl,
  }).from(users).where(eq(users.clerkId, userId)).limit(1);
  if (!me) return null;
  const role = me.accountType === "seller" ? "seller" : "buyer";

  const [state] = await db.select().from(firstWeekChecklist).where(eq(firstWeekChecklist.userId, userId)).limit(1);

  const [[brands], [postRow], [savedRow], [productRow]] = await Promise.all([
    db.select({ n: count() }).from(follows)
      .innerJoin(users, eq(users.clerkId, follows.followingId))
      .where(and(eq(follows.followerId, userId), eq(users.accountType, "seller"))),
    db.select({ n: count() }).from(posts).where(and(eq(posts.userId, userId), eq(posts.postStatus, "published"))),
    db.select({ n: count() }).from(savedItems).where(eq(savedItems.userId, userId)),
    db.select({ n: count() }).from(products).where(and(
      eq(products.ownerId, userId), isNull(products.deletedAt), ne(products.status, "archived"),
    )),
  ]);

  return {
    role,
    accountCreatedAt: me.createdAt,
    brandsFollowed: Number(brands?.n ?? 0),
    publishedPosts: Number(postRow?.n ?? 0),
    savedItems: Number(savedRow?.n ?? 0),
    hasProfilePhoto: Boolean(me.profileImageUrl || me.avatarUrl),
    products: Number(productRow?.n ?? 0),
    storeSharedAt: state?.storeSharedAt ?? null,
    dismissedAt: state?.dismissedAt ?? null,
    rewardGrantedAt: state?.rewardGrantedAt ?? null,
  };
}

/** Credits the reward once. Returns true when it is (now or already) granted. */
async function grantReward(userId: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    try {
      await assertThreadCashNotFrozen(tx, userId);
    } catch (err) {
      if (err instanceof ThreadCashError) return false;
      throw err;
    }
    await tx.insert(threadCashEntries).values({
      buyerId: userId,
      amountCents: FIRST_WEEK_REWARD_CENTS,
      source: "first_week",
      referenceId: userId,
      note: "First week checklist",
      idempotencyKey: firstWeekIdempotencyKey(userId),
    }).onConflictDoNothing();
    const now = new Date();
    await tx.insert(firstWeekChecklist).values({ userId, rewardGrantedAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: firstWeekChecklist.userId,
        set: { rewardGrantedAt: sql`coalesce(${firstWeekChecklist.rewardGrantedAt}, now())`, updatedAt: now },
      });
    return true;
  });
}

router.get("/", async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  try {
    const facts = await loadFacts(userId);
    if (!facts) { res.json({ visible: false, steps: [], allDone: false, reward: null }); return; }
    const steps = firstWeekSteps(facts);
    const done = allDone(steps);
    const rewardOn = await isFeatureEnabled(FIRST_WEEK_REWARD_FLAG, false);
    let granted = Boolean(facts.rewardGrantedAt);
    // Only inside the first week: finishing late never pays out.
    if (done && rewardOn && !granted && !facts.dismissedAt && firstWeekVisible(facts, new Date())) {
      granted = await grantReward(userId);
      if (granted) facts.rewardGrantedAt = new Date();
    }
    res.json({
      visible: firstWeekVisible(facts, new Date()) && (!done || granted),
      role: facts.role,
      steps,
      allDone: done,
      reward: rewardOn || granted ? { cents: FIRST_WEEK_REWARD_CENTS, granted } : null,
    });
  } catch (err) {
    logger.error({ err }, "first-week checklist read failed");
    res.status(500).json({ error: "Could not load the checklist" });
  }
});

async function stamp(userId: string, column: "dismissedAt" | "storeSharedAt") {
  const now = new Date();
  const set = column === "dismissedAt"
    ? { dismissedAt: sql`coalesce(${firstWeekChecklist.dismissedAt}, now())`, updatedAt: now }
    : { storeSharedAt: sql`coalesce(${firstWeekChecklist.storeSharedAt}, now())`, updatedAt: now };
  await db.insert(firstWeekChecklist).values({ userId, [column]: now, updatedAt: now })
    .onConflictDoUpdate({ target: firstWeekChecklist.userId, set });
}

router.post("/dismiss", async (req, res) => {
  try {
    await stamp((req as any).clerkUserId as string, "dismissedAt");
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "first-week dismiss failed");
    res.status(500).json({ error: "Could not dismiss" });
  }
});

router.post("/store-shared", async (req, res) => {
  try {
    await stamp((req as any).clerkUserId as string, "storeSharedAt");
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "first-week store-shared failed");
    res.status(500).json({ error: "Could not save" });
  }
});

export default router;
