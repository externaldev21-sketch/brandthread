/**
 * Seller side of the affiliate program. Mounted at /api/seller/affiliate behind
 * teamContext, so a team member acts on the store's program. Every query is
 * scoped to that store's id; one seller can never see or edit another's.
 *
 *   GET    /                      program settings + creator list (with stats) + totals
 *   PUT    /program               save settings
 *   POST   /creators/invite       { username, commissionPercent? } invite an existing user
 *   PATCH  /creators/:id          { status?: active|paused, commissionPercent?: number|null }
 *   POST   /creators/:id/approve  approve a pending application
 *   DELETE /creators/:id          remove a creator (their open code stops working)
 *   GET    /payouts               payouts made to creators
 */
import { Router } from "express";
import { and, eq, sql } from "drizzle-orm";
import { db, affiliateCreators, affiliatePrograms, users } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { requirePermission } from "../middlewares/requireRole";
import {
  MAX_BUYER_DISCOUNT_BPS, MAX_COMMISSION_BPS, MAX_HOLD_DAYS, MAX_WINDOW_DAYS, isValidBps, percentToBps,
} from "../lib/affiliate/commission";
import { generateUniqueCode, getProgram, syncAllDiscountCodes, syncDiscountCode } from "../lib/affiliate/service";
import { sellerCreatorRows, sellerPayoutRows, sumStats } from "../lib/affiliate/queries";
import { payoutsConfigured } from "../lib/affiliate/payouts";
import { getWebOrigin } from "../lib/webOrigin";

const router = Router();
router.use(requireAuth);
router.use(requirePermission("marketing"));

const store = (req: any) => req.clerkUserId as string;

function programJson(p: Awaited<ReturnType<typeof getProgram>>) {
  return {
    enabled: p.enabled,
    commissionPercent: p.defaultCommissionBps / 100,
    buyerDiscountPercent: p.buyerDiscountBps / 100,
    windowDays: p.windowDays,
    holdDays: p.holdDays,
    minPayoutCents: p.minPayoutCents,
    autoApprove: p.autoApprove,
  };
}

router.get("/", async (req, res) => {
  try {
    const sellerId = store(req);
    const [program, creators] = await Promise.all([getProgram(sellerId), sellerCreatorRows(sellerId)]);
    const [owner] = await db.select({ username: users.username }).from(users).where(eq(users.clerkId, sellerId)).limit(1);
    res.json({
      program: programJson(program),
      creators: creators.map((c) => ({
        ...c, commissionPercent: (c.commissionBpsOverride ?? program.defaultCommissionBps) / 100,
        hasOverride: c.commissionBpsOverride != null,
      })),
      totals: sumStats(creators.filter((c) => c.status !== "removed").map((c) => c.stats)),
      programLink: `${getWebOrigin()}/creator-program/join?brand=${encodeURIComponent(owner?.username || sellerId)}`,
      payoutsAvailable: payoutsConfigured(),
    });
  } catch (err) {
    req.log.error({ err }, "Seller affiliate overview failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/program", async (req, res) => {
  try {
    const sellerId = store(req);
    const b = req.body ?? {};
    const current = await getProgram(sellerId);
    const next = { ...current };
    if (b.enabled !== undefined) {
      if (typeof b.enabled !== "boolean") { res.status(400).json({ error: "enabled must be true or false" }); return; }
      next.enabled = b.enabled;
    }
    if (b.autoApprove !== undefined) {
      if (typeof b.autoApprove !== "boolean") { res.status(400).json({ error: "autoApprove must be true or false" }); return; }
      next.autoApprove = b.autoApprove;
    }
    if (b.commissionPercent !== undefined) {
      const bps = percentToBps(b.commissionPercent);
      if (bps == null || !isValidBps(bps, MAX_COMMISSION_BPS)) {
        res.status(400).json({ error: `Commission must be between 0 and ${MAX_COMMISSION_BPS / 100}%` });
        return;
      }
      next.defaultCommissionBps = bps;
    }
    if (b.buyerDiscountPercent !== undefined) {
      const bps = percentToBps(b.buyerDiscountPercent);
      if (bps == null || !isValidBps(bps, MAX_BUYER_DISCOUNT_BPS)) {
        res.status(400).json({ error: `Buyer discount must be between 0 and ${MAX_BUYER_DISCOUNT_BPS / 100}%` });
        return;
      }
      next.buyerDiscountBps = bps;
    }
    if (b.windowDays !== undefined) {
      if (!Number.isInteger(b.windowDays) || b.windowDays < 1 || b.windowDays > MAX_WINDOW_DAYS) {
        res.status(400).json({ error: `Attribution window must be 1 to ${MAX_WINDOW_DAYS} days` });
        return;
      }
      next.windowDays = b.windowDays;
    }
    if (b.holdDays !== undefined) {
      if (!Number.isInteger(b.holdDays) || b.holdDays < 0 || b.holdDays > MAX_HOLD_DAYS) {
        res.status(400).json({ error: `Hold period must be 0 to ${MAX_HOLD_DAYS} days` });
        return;
      }
      next.holdDays = b.holdDays;
    }
    if (b.minPayoutCents !== undefined) {
      if (!Number.isInteger(b.minPayoutCents) || b.minPayoutCents < 0 || b.minPayoutCents > 1_000_000) {
        res.status(400).json({ error: "Minimum payout must be between $0 and $10,000" });
        return;
      }
      next.minPayoutCents = b.minPayoutCents;
    }
    const values = {
      enabled: next.enabled, defaultCommissionBps: next.defaultCommissionBps, buyerDiscountBps: next.buyerDiscountBps,
      windowDays: next.windowDays, holdDays: next.holdDays, minPayoutCents: next.minPayoutCents, autoApprove: next.autoApprove,
      updatedAt: new Date(),
    };
    const [saved] = await db.insert(affiliatePrograms).values({ sellerId, ...values })
      .onConflictDoUpdate({ target: affiliatePrograms.sellerId, set: values }).returning();
    await syncAllDiscountCodes(sellerId, saved);
    res.json({ program: programJson(saved) });
  } catch (err) {
    req.log.error({ err }, "Seller affiliate program save failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

function parseOverride(raw: unknown): { ok: true; bps: number | null } | { ok: false } {
  if (raw === null) return { ok: true, bps: null };
  const bps = percentToBps(raw);
  if (bps == null || !isValidBps(bps, MAX_COMMISSION_BPS)) return { ok: false };
  return { ok: true, bps };
}

router.post("/creators/invite", async (req, res) => {
  try {
    const sellerId = store(req);
    const username = typeof req.body?.username === "string" ? req.body.username.trim().replace(/^@/, "") : "";
    if (!username) { res.status(400).json({ error: "Enter a username" }); return; }
    let overrideBps: number | null = null;
    if (req.body?.commissionPercent !== undefined) {
      const parsed = parseOverride(req.body.commissionPercent);
      if (!parsed.ok) { res.status(400).json({ error: "Invalid commission" }); return; }
      overrideBps = parsed.bps;
    }
    const program = await getProgram(sellerId);
    if (!program.enabled) { res.status(409).json({ error: "Turn the program on before inviting creators" }); return; }
    const [creator] = await db.select({ clerkId: users.clerkId, username: users.username, name: users.name, displayName: users.displayName })
      .from(users).where(sql`lower(${users.username}) = lower(${username})`).limit(1);
    if (!creator) { res.status(404).json({ error: "No one on Brandthread has that username" }); return; }
    if (creator.clerkId === sellerId) { res.status(400).json({ error: "You can't invite your own account" }); return; }

    const row = await db.transaction(async (tx) => {
      const [existing] = await tx.select().from(affiliateCreators).where(and(
        eq(affiliateCreators.sellerId, sellerId), eq(affiliateCreators.creatorId, creator.clerkId),
      )).for("update").limit(1);
      if (existing) {
        if (existing.status === "pending") {
          const [r] = await tx.update(affiliateCreators).set({
            status: "active", approvedAt: new Date(), commissionBpsOverride: overrideBps ?? existing.commissionBpsOverride, updatedAt: new Date(),
          }).where(eq(affiliateCreators.id, existing.id)).returning();
          await syncDiscountCode(tx, r, program);
          return { row: r, conflict: false };
        }
        if (existing.status === "removed" || existing.status === "declined") {
          const [r] = await tx.update(affiliateCreators).set({
            status: "invited", origin: "invite", commissionBpsOverride: overrideBps, updatedAt: new Date(),
          }).where(eq(affiliateCreators.id, existing.id)).returning();
          return { row: r, conflict: false };
        }
        return { row: existing, conflict: true };
      }
      const code = await generateUniqueCode(tx, sellerId, creator.username || creator.displayName || creator.name);
      const [r] = await tx.insert(affiliateCreators).values({
        sellerId, creatorId: creator.clerkId, status: "invited", origin: "invite", code, commissionBpsOverride: overrideBps,
      }).returning();
      return { row: r, conflict: false };
    });
    if (row.conflict) {
      res.status(409).json({ error: `@${creator.username} is already in your program` });
      return;
    }
    res.status(201).json({ id: row.row.id, status: row.row.status });
  } catch (err) {
    req.log.error({ err }, "Seller affiliate invite failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

async function mutateCreator(req: any, res: any, change: (row: typeof affiliateCreators.$inferSelect) => Record<string, unknown> | { error: string }) {
  try {
    const sellerId = store(req);
    const program = await getProgram(sellerId);
    const out = await db.transaction(async (tx) => {
      const [row] = await tx.select().from(affiliateCreators).where(and(
        eq(affiliateCreators.id, String(req.params.id)), eq(affiliateCreators.sellerId, sellerId),
      )).for("update").limit(1);
      if (!row) return { notFound: true as const };
      const patch = change(row);
      if ("error" in patch) return { error: patch.error as string };
      const [updated] = await tx.update(affiliateCreators).set({ ...patch, updatedAt: new Date() })
        .where(eq(affiliateCreators.id, row.id)).returning();
      await syncDiscountCode(tx, updated, program);
      return { updated };
    });
    if ("notFound" in out) { res.status(404).json({ error: "Creator not found" }); return; }
    if ("error" in out) { res.status(409).json({ error: out.error }); return; }
    res.json({ id: out.updated.id, status: out.updated.status, commissionBpsOverride: out.updated.commissionBpsOverride });
  } catch (err) {
    req.log.error({ err }, "Seller affiliate update failed");
    res.status(500).json({ error: "Internal server error" });
  }
}

router.post("/creators/:id/approve", (req, res) => mutateCreator(req, res, (row) =>
  row.status === "pending" ? { status: "active", approvedAt: new Date() } : { error: "Only pending applications can be approved" }));

router.patch("/creators/:id", (req, res) => {
  const body = req.body ?? {};
  let override: { set: boolean; bps: number | null } = { set: false, bps: null };
  if (body.commissionPercent !== undefined) {
    const parsed = parseOverride(body.commissionPercent);
    if (!parsed.ok) { res.status(400).json({ error: "Invalid commission" }); return; }
    override = { set: true, bps: parsed.bps };
  }
  if (body.status !== undefined && body.status !== "active" && body.status !== "paused") {
    res.status(400).json({ error: "status must be active or paused" });
    return;
  }
  return mutateCreator(req, res, (row) => {
    if (row.status === "removed" || row.status === "declined" || row.status === "invited") {
      return { error: "This creator isn't active in your program" };
    }
    if (body.status === "active" && row.status === "pending") return { error: "Approve the application first" };
    return {
      ...(body.status ? { status: body.status } : {}),
      ...(override.set ? { commissionBpsOverride: override.bps } : {}),
    };
  });
});

router.delete("/creators/:id", (req, res) => mutateCreator(req, res, () => ({ status: "removed" })));

router.get("/payouts", async (req, res) => {
  try {
    res.json({ payouts: await sellerPayoutRows(store(req)), payoutsAvailable: payoutsConfigured() });
  } catch (err) {
    req.log.error({ err }, "Seller affiliate payouts failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
