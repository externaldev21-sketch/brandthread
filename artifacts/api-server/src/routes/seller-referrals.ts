/**
 * Seller-to-seller referrals (BT-313). Mounted at /api/seller-referrals.
 *
 *   GET  /        program config (off unless SELLER_REFERRAL_ENABLED=true), my link, brands I referred
 *   POST /apply   { code } — a new brand adds the code of the brand that referred it
 */
import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, users } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { rateLimit } from "../middlewares/rateLimit";
import { inviteLink } from "../lib/referrals/policy";
import { isSellerAccount, sellerReferralConfig } from "../lib/sellerReferrals/config";
import { applySellerReferralCode, ensureInviteCode, sellerReferralSummary } from "../lib/sellerReferrals/service";

const router = Router();
router.use(requireAuth);

router.get("/", async (req, res) => {
  const me = (req as any).clerkUserId as string;
  const cfg = sellerReferralConfig();
  if (!cfg.enabled) return res.json({ enabled: false });
  try {
    const [user] = await db.select({ accountType: users.accountType, createdAt: users.createdAt, subscriptionStatus: users.subscriptionStatus })
      .from(users).where(eq(users.clerkId, me)).limit(1);
    if (!user || !isSellerAccount(user.accountType)) return res.json({ enabled: false });
    const code = await ensureInviteCode(me);
    const summary = await sellerReferralSummary(me);
    const inWindow = Date.now() - user.createdAt.getTime() <= cfg.applyWindowDays * 86_400_000;
    return res.json({
      enabled: true,
      freeMonths: cfg.freeMonths,
      code,
      link: code ? inviteLink(code) : null,
      referred: summary.referred,
      canApplyCode: !summary.hasReferrer && inWindow && user.subscriptionStatus !== "active",
    });
  } catch (err) {
    req.log?.error({ err }, "seller referral overview failed");
    return res.status(500).json({ error: "Couldn't load referrals." });
  }
});

router.post("/apply", rateLimit("public-read"), async (req, res) => {
  const me = (req as any).clerkUserId as string;
  try {
    const result = await applySellerReferralCode(me, req.body?.code);
    if (!result.ok) return res.status(result.status).json({ error: result.error, code: result.code });
    return res.json({ ok: true });
  } catch (err) {
    req.log?.error({ err }, "seller referral apply failed");
    return res.status(500).json({ error: "Couldn't add that code." });
  }
});

export default router;
