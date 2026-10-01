/**
 * Referral / invite-code system ("Give $10, get $10" Thread Cash).
 *
 * GET  /api/referrals/invite/:code — PUBLIC: count an invite-link click, say if the code is valid
 * GET  /api/referrals/code      — get (or lazily generate) my invite code + shareable link
 * GET  /api/referrals/stats     — my invitees with status, pending vs earned Thread Cash
 * POST /api/referrals/apply     — apply an invite code (call once after signup)
 *
 * Reward timing (see lib/referrals/policy.ts): the invitee gets $10 Thread Cash
 * on joining; the inviter gets $10 when the invitee's first order of $10 or
 * more is paid (hook: qualifyReferralForOrderSafe in routes/webhooks.ts). The
 * inviter's 500 loyalty points on join are unchanged.
 */
import { Router } from "express";
import { db, users, referrals } from "@workspace/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { rateLimit } from "../middlewares/rateLimit";
import { applyReferralCode } from "../lib/referrals/rewards";
import { notifyReferralJoined } from "../lib/activityEvents";
import {
  REFERRAL_INVITEE_REWARD_CENTS,
  REFERRAL_INVITER_REWARD_CENTS,
  REFERRAL_JOIN_POINTS,
  REFERRAL_MAX_PAID_PER_INVITER,
  REFERRAL_MIN_ORDER_CENTS,
  generateInviteCode,
  inviteLink,
  normalizeInviteCode,
} from "../lib/referrals/policy";
import { redeemAdminInviteCode } from "../lib/admin/inviteCodes";

const router = Router();

const rewardTerms = {
  inviteeRewardCents: REFERRAL_INVITEE_REWARD_CENTS,
  inviterRewardCents: REFERRAL_INVITER_REWARD_CENTS,
  minOrderCents: REFERRAL_MIN_ORDER_CENTS,
  joinPoints: REFERRAL_JOIN_POINTS,
  maxPaidReferrals: REFERRAL_MAX_PAID_PER_INVITER,
};

// ─── GET /api/referrals/invite/:code (public) ─────────────────────────────────
// Lightweight link-click tracking for the invite landing/deep link. Returns no
// personal data about the inviter — only whether the code exists.
router.get("/invite/:code", rateLimit("public-read"), async (req, res) => {
  const code = normalizeInviteCode(req.params.code);
  if (!code) {
    res.status(404).json({ valid: false });
    return;
  }
  const updated = await db
    .update(users)
    .set({ inviteLinkClicks: sql`${users.inviteLinkClicks} + 1`, inviteLastClickedAt: new Date() })
    .where(eq(users.inviteCode, code))
    .returning({ clerkId: users.clerkId });
  if (updated.length === 0) {
    res.status(404).json({ valid: false });
    return;
  }
  res.set("Cache-Control", "no-store");
  res.json({ valid: true, code, terms: rewardTerms });
});

router.use(requireAuth);

// ─── GET /api/referrals/code ──────────────────────────────────────────────────
// Returns the caller's invite code, generating one lazily on first call.
router.get("/code", async (req, res) => {
  const myId = (req as any).clerkUserId as string;

  const [user] = await db
    .select({ inviteCode: users.inviteCode, name: users.name, displayName: users.displayName })
    .from(users)
    .where(eq(users.clerkId, myId))
    .limit(1);

  if (!user) {
    res.status(404).json({ error: "User not found — call /auth/sync first" });
    return;
  }

  let code = user.inviteCode;

  if (!code) {
    // Lazily generate a unique code (max 10 attempts before giving up). The
    // conditional update means two racing requests can't overwrite each other.
    for (let i = 0; i < 10 && !code; i++) {
      const candidate = generateInviteCode();
      try {
        const updated = await db
          .update(users)
          .set({ inviteCode: candidate, updatedAt: new Date() })
          .where(and(eq(users.clerkId, myId), sql`${users.inviteCode} IS NULL`))
          .returning({ inviteCode: users.inviteCode });
        if (updated[0]) {
          code = updated[0].inviteCode;
        } else {
          const [again] = await db.select({ inviteCode: users.inviteCode }).from(users)
            .where(eq(users.clerkId, myId)).limit(1);
          code = again?.inviteCode ?? null;
        }
      } catch (err: any) {
        if (err?.code === "23505" || err?.cause?.code === "23505") continue; // collision: retry
        throw err;
      }
    }
    if (!code) {
      res.status(500).json({ error: "Could not generate invite code — try again" });
      return;
    }
  }

  const senderName = user.displayName || user.name || "someone";
  const link = inviteLink(code);

  res.json({
    code,
    link,
    terms: rewardTerms,
    /** Pre-composed share text — mobile client can pass directly to Share API */
    shareText: `${senderName} invited you to Brandthread. Join with my link and get $10 Thread Cash.\n\nUse invite code ${code} or tap: ${link}`,
  });
});

// ─── GET /api/referrals/stats ─────────────────────────────────────────────────
router.get("/stats", async (req, res) => {
  const myId = (req as any).clerkUserId as string;

  const [me] = await db
    .select({ clicks: users.inviteLinkClicks })
    .from(users)
    .where(eq(users.clerkId, myId))
    .limit(1);

  const rows = await db
    .select({
      inviteeId: referrals.inviteeId,
      joinedAt: referrals.joinedAt,
      status: referrals.status,
      inviterRewardCents: referrals.inviterRewardCents,
      rewardedAt: referrals.rewardedAt,
    })
    .from(referrals)
    .where(eq(referrals.inviterId, myId));

  const earnedCents = rows.reduce((sum, r) => sum + r.inviterRewardCents, 0);
  const rewardedCount = rows.filter((r) => r.status === "rewarded").length;
  const pendingCount = rows.filter((r) => r.status === "pending").length;
  // Pending cash only counts friends the inviter can still be paid for.
  const payableSlots = Math.max(0, REFERRAL_MAX_PAID_PER_INVITER - rewardedCount);
  const pendingCents = Math.min(pendingCount, payableSlots) * REFERRAL_INVITER_REWARD_CENTS;

  const base = {
    total: rows.length,
    clicks: me?.clicks ?? 0,
    earnedCents,
    pendingCents,
    terms: rewardTerms,
    /** Loyalty points earned on joins (500 each), unchanged from before. */
    pointsEarned: rows.length * REFERRAL_JOIN_POINTS,
  };

  if (rows.length === 0) {
    res.json({ ...base, referrals: [] });
    return;
  }

  // Hydrate with invitee names
  const inviteeIds = rows.map((r) => r.inviteeId);
  const profiles = await db
    .select({ clerkId: users.clerkId, name: users.name, displayName: users.displayName })
    .from(users)
    .where(inArray(users.clerkId, inviteeIds));

  const profileMap = new Map(profiles.map((p) => [p.clerkId, p]));

  res.json({
    ...base,
    referrals: rows
      .sort((a, b) => b.joinedAt.getTime() - a.joinedAt.getTime())
      .map((r) => {
        const p = profileMap.get(r.inviteeId);
        return {
          inviteeId: r.inviteeId,
          name:      p ? (p.displayName || p.name) : null,
          joinedAt:  r.joinedAt,
          status:    r.status,
          rewardCents: r.inviterRewardCents,
          rewardedAt: r.rewardedAt,
        };
      }),
  });
});

// ─── POST /api/referrals/apply ────────────────────────────────────────────────
// Record the referral relationship. Safe to call at any point after signup;
// idempotent — returns 409 if this user was already attributed.
router.post("/apply", async (req, res) => {
  const myId = (req as any).clerkUserId as string;
  const { code, expectedClerkId } = req.body as { code?: string; expectedClerkId?: string };

  if (expectedClerkId && expectedClerkId !== myId) {
    (req as any).log?.warn("referral application rejected after account context changed");
    res.status(409).json({
      error: "The signed-in account changed before the referral could be saved.",
      code: "ACCOUNT_CONTEXT_CHANGED",
    });
    return;
  }

  if (!code || typeof code !== "string") {
    res.status(400).json({ error: "code required" });
    return;
  }
  const normalizedCode = code.trim().toUpperCase();

  const result = await applyReferralCode({ inviteeId: myId, code: normalizedCode });
  if (!result.ok && result.code === "INVALID_CODE") {
    // Not a member's referral code: it may be an admin-issued invite code.
    // Those grant no referral reward or Thread Cash; they count against the code's limits.
    const [me] = await db.select({ referredByCode: users.referredByCode }).from(users).where(eq(users.clerkId, myId)).limit(1);
    if (me?.referredByCode) {
      res.status(409).json({ error: "Referral already recorded.", code: "ALREADY_APPLIED" });
      return;
    }
    const outcome = await db.transaction(async (tx) => {
      const redeemed = await redeemAdminInviteCode(tx, normalizedCode, myId);
      if (redeemed === "ok") {
        await tx.update(users).set({ referredByCode: normalizedCode, updatedAt: new Date() }).where(eq(users.clerkId, myId));
      }
      return redeemed;
    });
    if (outcome === "ok") { res.json({ ok: true, inviterId: null }); return; }
    if (outcome === "already_used") { res.status(409).json({ error: "Referral already recorded.", code: "ALREADY_APPLIED" }); return; }
    if (outcome === "invalid") { res.status(404).json({ error: "Invite code not found.", code: "INVALID_CODE" }); return; }
    res.status(410).json({ error: outcome === "expired" ? "This invite code has expired." : "This invite code has been fully used.", code: "INVALID_CODE" });
    return;
  }
  if (!result.ok) {
    res.status(result.status).json({ error: result.error, code: result.code });
    return;
  }

  // Post-commit, non-throwing: tell the inviter a friend joined.
  void notifyReferralJoined({ inviterId: result.inviterId, inviteeId: myId });

  res.json({ ok: true, inviterId: result.inviterId, inviteeRewardCents: result.inviteeRewardCents });
});

export default router;
