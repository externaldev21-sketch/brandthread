/**
 * Creator side of the affiliate program. Mounted at /api/affiliate (no team
 * context: a creator acts as themselves, never as a store they joined).
 *
 *   GET  /overview                  my brands, codes, share links, stats, payout availability
 *   GET  /brands/:ref               a brand's program (ref = username or seller id) + my status
 *   POST /brands/:sellerId/apply    apply (auto-approved when the seller allows it)
 *   POST /invites/:id/accept|decline
 *   POST /attach                    attach a clicked ?aff= code to me (signed-in last-click)
 *   GET  /payouts                   payout history
 *   GET  /payout-account            Connect readiness
 *   POST /payout-account/onboard    Stripe Connect Express onboarding link
 */
import { Router } from "express";
import { and, eq, sql } from "drizzle-orm";
import { db, affiliateAttributions, affiliateCreators, users } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { requireStripe, stripe } from "../lib/stripe";
import { getWebOrigin } from "../lib/webOrigin";
import { attributionExpiry, isSelfReferral, normalizeAffiliateCode } from "../lib/affiliate/commission";
import { generateUniqueCode, getProgram, syncDiscountCode } from "../lib/affiliate/service";
import { creatorAccountState, payoutsConfigured } from "../lib/affiliate/payouts";
import { creatorBrandRows, creatorPayoutRows, sumStats } from "../lib/affiliate/queries";
import { CREATOR_CONNECT_REFRESH_PATH, CREATOR_CONNECT_RETURN_PATH, creatorConnectLanding } from "../lib/affiliate/connectReturn";

/** Stripe Connect return/refresh for creators (BT-323), mounted at /api/affiliate/connect. */
export const affiliateConnectRedirectRouter = Router();
affiliateConnectRedirectRouter.get("/return", (req, res) => {
  res.redirect(302, creatorConnectLanding(req.get("user-agent"), "returned"));
});
affiliateConnectRedirectRouter.get("/refresh", (req, res) => {
  res.redirect(302, creatorConnectLanding(req.get("user-agent"), "refresh"));
});

const router = Router();
router.use(requireAuth);

const me = (req: any) => req.clerkUserId as string;

export function shareLink(code: string, brandUsername: string | null): string {
  const origin = getWebOrigin();
  return brandUsername
    ? `${origin}/u/${encodeURIComponent(brandUsername)}?aff=${encodeURIComponent(code)}`
    : `${origin}/?aff=${encodeURIComponent(code)}`;
}

async function payoutStatus(creatorId: string) {
  const available = payoutsConfigured();
  if (!available) {
    return {
      available: false,
      reason: stripe ? "Payouts are not switched on yet." : "Payouts are not configured on this server yet.",
      connected: false,
      ready: false,
    };
  }
  const account = await creatorAccountState(creatorId, stripe);
  return { available: true, reason: null, connected: Boolean(account.accountId), ready: account.ready };
}

router.get("/overview", async (req, res) => {
  try {
    const creatorId = me(req);
    const brands = await creatorBrandRows(creatorId);
    const active = brands.filter((b) => b.status === "active");
    res.json({
      brands: brands.map((b) => ({
        ...b,
        commissionPercent: b.commissionBps / 100,
        buyerDiscountPercent: b.buyerDiscountBps / 100,
        shareLink: b.status === "active" && b.programEnabled ? shareLink(b.code, b.brandUsername) : null,
      })),
      totals: sumStats(active.map((b) => b.stats)),
      payout: await payoutStatus(creatorId),
    });
  } catch (err) {
    req.log.error({ err }, "Affiliate overview failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/brands/:ref", async (req, res) => {
  try {
    const ref = String(req.params.ref);
    const [brand] = await db.select({
      clerkId: users.clerkId, username: users.username, brandName: users.brandName, name: users.name,
      imageUrl: users.profileImageUrl,
    }).from(users).where(sql`${users.clerkId} = ${ref} OR lower(${users.username}) = lower(${ref})`).limit(1);
    if (!brand) {
      res.status(404).json({ error: "Brand not found" });
      return;
    }
    const program = await getProgram(brand.clerkId);
    const [mine] = await db.select().from(affiliateCreators).where(and(
      eq(affiliateCreators.sellerId, brand.clerkId), eq(affiliateCreators.creatorId, me(req)),
    )).limit(1);
    res.json({
      sellerId: brand.clerkId,
      brandName: brand.brandName || brand.name,
      username: brand.username,
      imageUrl: brand.imageUrl,
      program: {
        enabled: program.enabled,
        commissionPercent: program.defaultCommissionBps / 100,
        buyerDiscountPercent: program.buyerDiscountBps / 100,
        windowDays: program.windowDays,
        autoApprove: program.autoApprove,
      },
      mine: mine ? { id: mine.id, status: mine.status } : null,
      isOwnBrand: brand.clerkId === me(req),
    });
  } catch (err) {
    req.log.error({ err }, "Affiliate brand lookup failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/brands/:sellerId/apply", async (req, res) => {
  try {
    const creatorId = me(req);
    const sellerId = String(req.params.sellerId);
    if (sellerId === creatorId) {
      res.status(400).json({ error: "You can't join your own brand's creator program" });
      return;
    }
    const [seller] = await db.select({ id: users.id }).from(users).where(eq(users.clerkId, sellerId)).limit(1);
    const program = await getProgram(sellerId);
    if (!seller || !program.enabled) {
      res.status(404).json({ error: "This brand isn't accepting creators right now" });
      return;
    }
    const [creator] = await db.select({ displayName: users.displayName, name: users.name, username: users.username })
      .from(users).where(eq(users.clerkId, creatorId)).limit(1);
    if (!creator) {
      res.status(404).json({ error: "User not found — call /api/auth/sync first" });
      return;
    }
    const status = program.autoApprove ? "active" : "pending";

    const result = await db.transaction(async (tx) => {
      const [existing] = await tx.select().from(affiliateCreators).where(and(
        eq(affiliateCreators.sellerId, sellerId), eq(affiliateCreators.creatorId, creatorId),
      )).for("update").limit(1);
      if (existing) {
        if (existing.status === "removed" || existing.status === "declined") {
          const [row] = await tx.update(affiliateCreators).set({
            status, origin: "apply", updatedAt: new Date(), approvedAt: status === "active" ? new Date() : null,
          }).where(eq(affiliateCreators.id, existing.id)).returning();
          if (status === "active") await syncDiscountCode(tx, row, program);
          return row;
        }
        if (existing.status === "invited") {
          const [row] = await tx.update(affiliateCreators).set({ status: "active", approvedAt: new Date(), updatedAt: new Date() })
            .where(eq(affiliateCreators.id, existing.id)).returning();
          await syncDiscountCode(tx, row, program);
          return row;
        }
        return existing;
      }
      const code = await generateUniqueCode(tx, sellerId, creator.username || creator.displayName || creator.name);
      const [row] = await tx.insert(affiliateCreators).values({
        sellerId, creatorId, status, origin: "apply", code, approvedAt: status === "active" ? new Date() : null,
      }).returning();
      if (status === "active") await syncDiscountCode(tx, row, program);
      return row;
    });
    res.status(201).json({ id: result.id, status: result.status, code: result.code });
  } catch (err) {
    req.log.error({ err }, "Affiliate apply failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

async function respondToInvite(req: any, res: any, accept: boolean) {
  try {
    const creatorId = me(req);
    const outcome = await db.transaction(async (tx) => {
      const [row] = await tx.select().from(affiliateCreators).where(and(
        eq(affiliateCreators.id, String(req.params.id)), eq(affiliateCreators.creatorId, creatorId),
      )).for("update").limit(1);
      if (!row || row.status !== "invited") return null;
      const [updated] = await tx.update(affiliateCreators).set({
        status: accept ? "active" : "declined", approvedAt: accept ? new Date() : null, updatedAt: new Date(),
      }).where(eq(affiliateCreators.id, row.id)).returning();
      if (accept) await syncDiscountCode(tx, updated, await getProgram(row.sellerId, tx));
      return updated;
    });
    if (!outcome) {
      res.status(404).json({ error: "Invite not found" });
      return;
    }
    res.json({ id: outcome.id, status: outcome.status });
  } catch (err) {
    req.log.error({ err }, "Affiliate invite response failed");
    res.status(500).json({ error: "Internal server error" });
  }
}
router.post("/invites/:id/accept", (req, res) => respondToInvite(req, res, true));
router.post("/invites/:id/decline", (req, res) => respondToInvite(req, res, false));

/**
 * The buyer opened a creator's ?aff= link and is signed in. Stores last-click
 * attribution for the program's window. Self-referral is refused here too.
 */
router.post("/attach", async (req, res) => {
  try {
    const buyerId = me(req);
    const code = normalizeAffiliateCode(req.body?.code);
    if (!code) {
      res.status(400).json({ error: "Invalid code" });
      return;
    }
    const [affiliate] = await db.select().from(affiliateCreators).where(eq(affiliateCreators.code, code)).limit(1);
    const program = affiliate ? await getProgram(affiliate.sellerId) : null;
    if (!affiliate || affiliate.status !== "active" || !program?.enabled) {
      res.json({ attributed: false, reason: "inactive" });
      return;
    }
    if (isSelfReferral({ creatorId: affiliate.creatorId, sellerId: affiliate.sellerId, buyerId })) {
      res.json({ attributed: false, reason: "self" });
      return;
    }
    const clickedAt = new Date();
    const expiresAt = attributionExpiry(clickedAt, program.windowDays);
    await db.insert(affiliateAttributions).values({
      affiliateId: affiliate.id, sellerId: affiliate.sellerId, creatorId: affiliate.creatorId, buyerId, clickedAt, expiresAt,
    }).onConflictDoUpdate({
      target: [affiliateAttributions.buyerId, affiliateAttributions.sellerId],
      set: { affiliateId: affiliate.id, creatorId: affiliate.creatorId, clickedAt, expiresAt },
    });
    res.json({ attributed: true, sellerId: affiliate.sellerId, expiresAt: expiresAt.toISOString() });
  } catch (err) {
    req.log.error({ err }, "Affiliate attach failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/payouts", async (req, res) => {
  try {
    res.json({ payouts: await creatorPayoutRows(me(req)), payout: await payoutStatus(me(req)) });
  } catch (err) {
    req.log.error({ err }, "Affiliate payouts failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/payout-account", async (req, res) => {
  try {
    res.json(await payoutStatus(me(req)));
  } catch (err) {
    req.log.error({ err }, "Affiliate payout account failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/payout-account/onboard", async (req, res) => {
  try {
    if (!payoutsConfigured()) {
      res.status(503).json({ error: "Payouts aren't available yet." });
      return;
    }
    const client = requireStripe();
    const creatorId = me(req);
    const [user] = await db.select({ stripeAccountId: users.stripeAccountId }).from(users)
      .where(eq(users.clerkId, creatorId)).limit(1);
    if (!user) {
      res.status(404).json({ error: "User not found — call /api/auth/sync first" });
      return;
    }
    let accountId = user.stripeAccountId;
    if (!accountId) {
      const account = await client.accounts.create({ type: "express", capabilities: { transfers: { requested: true } } });
      accountId = account.id;
      await db.update(users).set({ stripeAccountId: accountId, stripeAccountStatus: "pending", updatedAt: new Date() })
        .where(and(eq(users.clerkId, creatorId), sql`${users.stripeAccountId} IS NULL`));
    }
    const origin = getWebOrigin("https://localhost:3000");
    const link = await client.accountLinks.create({
      account: accountId,
      refresh_url: `${origin}${CREATOR_CONNECT_REFRESH_PATH}`,
      return_url: `${origin}${CREATOR_CONNECT_RETURN_PATH}`,
      type: "account_onboarding",
    });
    res.json({ url: link.url });
  } catch (err: any) {
    const status = err?.status ?? 500;
    if (status < 500) {
      res.status(status).json({ error: err.message });
      return;
    }
    req.log.error({ err }, "Affiliate onboarding failed");
    res.status(500).json({ error: "Failed to create onboarding link" });
  }
});

export default router;
