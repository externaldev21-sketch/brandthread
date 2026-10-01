/**
 * Invite-only launch access (mounted at /api/access).
 *
 * The mode itself is the `inviteOnlySignup` feature flag (OFF by default).
 * Codes are the platform-admin invite codes that already exist
 * (admin_invite_codes, minted via /api/admin/invites); this router only adds
 * the sign-up-facing side of them:
 *
 *   GET  /api/access/status    (auth)   { inviteOnly, redeemed, required }
 *   POST /api/access/validate  (public) { valid }  — one generic answer, rate-limited
 *   POST /api/access/redeem    (auth)   consume a code for the signed-in account
 *   POST /api/access/waitlist  (public) join the waitlist with an email
 *
 * Enforcement lives in POST /api/auth/onboarding/complete (routes/auth.ts).
 */
import { Router } from "express";
import { db, accessWaitlistSignups } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { rateLimit } from "../middlewares/rateLimit";
import { z } from "@workspace/api-zod";
import { requestPrimitives, validateRequest } from "../middlewares/validateRequest";
import { redeemAdminInviteCode } from "../lib/admin/inviteCodes";
import { getAccessStatus, isRedeemableCode, normalizeAccessCode } from "../lib/access/inviteOnly";

const router = Router();

const codeBody = z.object({ code: z.string().max(40) }).passthrough();
const waitlistBody = z.object({ email: requestPrimitives.email }).passthrough();

router.get("/status", requireAuth, async (req, res) => {
  const clerkId = (req as any).clerkUserId as string;
  try {
    res.setHeader("Cache-Control", "no-store");
    res.json(await getAccessStatus(clerkId));
  } catch (err) {
    req.log.error({ err }, "Access status lookup failed");
    res.status(503).json({ error: "Unable to check access right now." });
  }
});

// Every failure (unknown, malformed, revoked, expired, used up) is the same
// answer, so the endpoint can't be used to learn anything about codes.
router.post("/validate", rateLimit("access-code"), validateRequest({ body: codeBody }), async (req, res) => {
  try {
    res.setHeader("Cache-Control", "no-store");
    res.json({ valid: await isRedeemableCode(req.body.code) });
  } catch (err) {
    req.log.error({ err }, "Access code validation failed");
    res.status(503).json({ error: "Unable to check this code right now." });
  }
});

router.post("/redeem", requireAuth, rateLimit("access-code"), validateRequest({ body: codeBody }), async (req, res) => {
  const clerkId = (req as any).clerkUserId as string;
  const code = normalizeAccessCode(req.body.code);
  const invalid = () => {
    res.status(400).json({ error: "That code isn't valid.", code: "INVALID_CODE" });
  };
  if (!code) { invalid(); return; }
  try {
    const outcome = await db.transaction((tx) => redeemAdminInviteCode(tx, code, clerkId));
    // "already_used" = this account already redeemed a code: idempotent success.
    if (outcome === "ok" || outcome === "already_used") {
      res.json({ ok: true });
      return;
    }
    invalid();
  } catch (err) {
    req.log.error({ err }, "Access code redemption failed");
    res.status(500).json({ error: "Unable to redeem this code right now." });
  }
});

// Always the same 200, whether the email is new or already listed.
router.post("/waitlist", rateLimit("access-waitlist"), validateRequest({ body: waitlistBody }), async (req, res) => {
  try {
    await db
      .insert(accessWaitlistSignups)
      .values({ email: req.body.email })
      .onConflictDoNothing();
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Waitlist signup failed");
    res.status(500).json({ error: "Unable to join the waitlist right now." });
  }
});

export default router;
