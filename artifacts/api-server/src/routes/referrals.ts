/**
 * Referral / invite-code system.
 *
 * GET  /api/referrals/code      — get (or lazily generate) my invite code + shareable link
 * GET  /api/referrals/stats     — how many people joined using my code, with join dates
 * POST /api/referrals/apply     — apply an invite code (call once after signup)
 */
import { Router } from "express";
import { db, users, referrals } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { awardLoyaltyPointsOnce } from "./loyalty";

const router = Router();
router.use(requireAuth);

// Unambiguous characters only — avoids 0/O, 1/I/L confusion
const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

function generateCode(len = 6): string {
  return Array.from({ length: len }, () =>
    ALPHABET[Math.floor(Math.random() * ALPHABET.length)]
  ).join("");
}

function inviteLink(code: string): string {
  return `https://brandthread.app/onboarding?referralCode=${code}`;
}

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
    // Lazily generate a unique code (max 10 attempts before giving up)
    for (let i = 0; i < 10; i++) {
      const candidate = generateCode();
      const [collision] = await db
        .select({ clerkId: users.clerkId })
        .from(users)
        .where(eq(users.inviteCode, candidate))
        .limit(1);
      if (!collision) {
        await db
          .update(users)
          .set({ inviteCode: candidate, updatedAt: new Date() })
          .where(eq(users.clerkId, myId));
        code = candidate;
        break;
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
    /** Pre-composed share text — mobile client can pass directly to Share API */
    shareText: `${senderName} invited you to Brandthread — fashion made personal.\n\nUse invite code ${code} or tap: ${link}`,
  });
});

// ─── GET /api/referrals/stats ─────────────────────────────────────────────────
router.get("/stats", async (req, res) => {
  const myId = (req as any).clerkUserId as string;

  const rows = await db
    .select({ inviteeId: referrals.inviteeId, joinedAt: referrals.joinedAt })
    .from(referrals)
    .where(eq(referrals.inviterId, myId));

  if (rows.length === 0) {
    res.json({ total: 0, pointsEarned: 0, referrals: [] });
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
    total: rows.length,
    pointsEarned: rows.length * 500,
    referrals: rows.map((r) => {
      const p = profileMap.get(r.inviteeId);
      return {
        inviteeId: r.inviteeId,
        name:      p ? (p.displayName || p.name) : null,
        joinedAt:  r.joinedAt,
      };
    }),
  });
});

// ─── POST /api/referrals/apply ────────────────────────────────────────────────
// Record the referral relationship. Safe to call at any point after signup;
// idempotent — returns 409 if this user was already attributed.
router.post("/apply", async (req, res) => {
  const myId = (req as any).clerkUserId as string;
  const { code } = req.body as { code?: string };

  if (!code || typeof code !== "string") {
    res.status(400).json({ error: "code required" });
    return;
  }
  const normalizedCode = code.trim().toUpperCase();

  // Idempotency: already referred?
  const [existing] = await db
    .select({ inviteeId: referrals.inviteeId })
    .from(referrals)
    .where(eq(referrals.inviteeId, myId))
    .limit(1);
  if (existing) {
    res.status(409).json({ error: "Referral already recorded.", code: "ALREADY_APPLIED" });
    return;
  }

  // Resolve inviter
  const [inviter] = await db
    .select({ clerkId: users.clerkId })
    .from(users)
    .where(eq(users.inviteCode, normalizedCode))
    .limit(1);
  if (!inviter) {
    res.status(404).json({ error: "Invite code not found.", code: "INVALID_CODE" });
    return;
  }
  if (inviter.clerkId === myId) {
    res.status(400).json({ error: "You cannot use your own invite code." });
    return;
  }

  // Attribution and reward issuance commit together. The unique invitee row
  // plus awardLoyaltyPointsOnce make concurrent/retried applies idempotent.
  const applied = await db.transaction(async (tx) => {
    const [created] = await tx.insert(referrals).values({
      inviterId: inviter.clerkId,
      inviteeId: myId,
      inviteCode: normalizedCode,
    }).onConflictDoNothing().returning({ inviteeId: referrals.inviteeId });
    if (!created) return false;

    await tx.update(users)
      .set({ referredByCode: normalizedCode, updatedAt: new Date() })
      .where(eq(users.clerkId, myId));
    await awardLoyaltyPointsOnce({
      buyerId: inviter.clerkId,
      points: 500,
      source: "referral",
      referenceId: myId,
      note: "Referral bonus — friend joined",
    }, tx);
    return true;
  });

  if (!applied) {
    res.status(409).json({ error: "Referral already recorded.", code: "ALREADY_APPLIED" });
    return;
  }

  res.json({ ok: true, inviterId: inviter.clerkId });
});

export default router;
