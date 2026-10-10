/**
 * Retention offers before a seller cancels (shown in the cancel sheet next to
 * "Switch to a lower plan" and "Keep plan").
 *
 * GET  /api/seller/subscription-retention/offers   — { pause: { available, paused, resumesAt, nextPauseAt }, provider }
 * POST /api/seller/subscription-retention/pause    — pause billing for 30 days; the store goes on vacation mode
 * POST /api/seller/subscription-retention/resume   — end a pause now (billing and the store resume)
 *
 * Stripe subscriptions only (lib/subscriptionPause.ts). App Store / Play
 * subscriptions answer 409 NATIVE_SUBSCRIPTION: they are managed in the store.
 */
import { Router } from "express";
import { eq } from "drizzle-orm";
import type Stripe from "stripe";
import { db, users } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { requireRole, teamContext } from "../middlewares/requireRole";
import { stripe as defaultStripe } from "../lib/stripe";
import { pauseEnd, pauseState, vacationMessage } from "../lib/subscriptionPause";

type StripeLike = Pick<Stripe, "subscriptions">;
let stripeOverride: StripeLike | null | undefined;
/** Test seam. */
export function setRetentionStripe(client: StripeLike | null | undefined): void { stripeOverride = client; }
const stripeClient = (): StripeLike | null => (stripeOverride === undefined ? defaultStripe : stripeOverride);

const router = Router();
router.use(requireAuth);
router.use(teamContext());

async function loadSubscription(ownerId: string): Promise<{ sub: Stripe.Subscription | null; native: boolean }> {
  const [user] = await db.select({ subscriptionId: users.subscriptionId }).from(users).where(eq(users.clerkId, ownerId)).limit(1);
  const id = user?.subscriptionId ?? null;
  if (!id || !id.startsWith("sub_")) return { sub: null, native: !!id };
  const client = stripeClient();
  if (!client) return { sub: null, native: false };
  return { sub: await client.subscriptions.retrieve(id), native: false };
}

router.get("/offers", requireRole("manager"), async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  try {
    const { sub, native } = await loadSubscription(ownerId);
    if (!sub) {
      return void res.json({ provider: native ? "store" : null, pause: { available: false, paused: false, resumesAt: null, nextPauseAt: null } });
    }
    const state = pauseState(sub, new Date());
    res.json({
      provider: "stripe",
      pause: state.paused
        ? { available: false, paused: true, resumesAt: state.resumesAt.toISOString(), nextPauseAt: null }
        : { available: state.canPause, paused: false, resumesAt: null, nextPauseAt: state.nextPauseAt?.toISOString() ?? null },
    });
  } catch (err) {
    req.log?.error?.({ err }, "Retention offers lookup failed");
    res.status(502).json({ error: "Couldn't load your plan. Try again." });
  }
});

router.post("/pause", requireRole("owner"), async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  try {
    const { sub, native } = await loadSubscription(ownerId);
    if (native) return void res.status(409).json({ error: "Manage this subscription in the App Store or Google Play.", code: "NATIVE_SUBSCRIPTION" });
    if (!sub) return void res.status(404).json({ error: "No subscription to pause", code: "NO_SUBSCRIPTION" });
    const now = new Date();
    const state = pauseState(sub, now);
    if (state.paused) return void res.json({ paused: true, resumesAt: state.resumesAt.toISOString() });
    if (!state.canPause) {
      return void res.status(409).json({
        error: "You can pause once every 6 months.", code: "PAUSE_UNAVAILABLE", nextPauseAt: state.nextPauseAt?.toISOString() ?? null,
      });
    }
    const resumesAt = pauseEnd(now);
    await stripeClient()!.subscriptions.update(sub.id, {
      pause_collection: { behavior: "void", resumes_at: Math.floor(resumesAt.getTime() / 1000) },
      metadata: { ...(sub.metadata ?? {}), lastPausedAt: String(now.getTime()) },
    }, { idempotencyKey: `pause/${sub.id}/${now.toISOString().slice(0, 10)}` });
    await db.update(users).set({
      vacationMode: true, vacationUntil: resumesAt, vacationMessage: vacationMessage(resumesAt), updatedAt: now,
    }).where(eq(users.clerkId, ownerId));
    req.log?.info?.({ ownerId, resumesAt }, "Seller paused their subscription");
    res.json({ paused: true, resumesAt: resumesAt.toISOString() });
  } catch (err) {
    req.log?.error?.({ err }, "Subscription pause failed");
    res.status(502).json({ error: "Couldn't pause your plan. Try again." });
  }
});

router.post("/resume", requireRole("owner"), async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  try {
    const { sub, native } = await loadSubscription(ownerId);
    if (native) return void res.status(409).json({ error: "Manage this subscription in the App Store or Google Play.", code: "NATIVE_SUBSCRIPTION" });
    if (!sub) return void res.status(404).json({ error: "No subscription", code: "NO_SUBSCRIPTION" });
    if (sub.pause_collection) {
      await stripeClient()!.subscriptions.update(sub.id, { pause_collection: "" as any });
    }
    await db.update(users).set({ vacationMode: false, vacationUntil: null, updatedAt: new Date() }).where(eq(users.clerkId, ownerId));
    res.json({ paused: false });
  } catch (err) {
    req.log?.error?.({ err }, "Subscription resume failed");
    res.status(502).json({ error: "Couldn't resume your plan. Try again." });
  }
});

export default router;
