/**
 * Admin → trust & safety tools that had no dashboard screen.
 *
 * Held content (auto-moderation): the same queue as /api/moderation/held,
 * re-mounted behind the admin gate so the dashboard stays on /api/admin and
 * every approve / remove lands in the admin audit log.
 *   GET  /api/admin/held?type=all|post|story|comment|media&limit=&cursor=
 *   GET  /api/admin/held/counts
 *   POST /api/admin/held/:type/:id/approve | /remove
 *
 * Repeat infringers (IP takedown strikes, migration 231)
 *   GET  /api/admin/repeat-infringers          sellers with strikes, flagged first, with their IP cases
 *   POST /api/admin/repeat-infringers/:userId/clear   { resetStrikes?: boolean }
 *
 * For You ranking weights (ranking_config row 'ranking_weights')
 *   GET   /api/admin/ranking                   { config, defaults, stored, envOverride, updatedAt }
 *   PATCH /api/admin/ranking                   partial config; sanitized + clamped server-side
 *   POST  /api/admin/ranking/reset             store the code defaults
 */
import { Router, type NextFunction, type Request, type Response } from "express";
import { desc, eq, inArray, or, sql } from "drizzle-orm";
import { db, ipCases, products, rankingConfig, users } from "@workspace/db";
import { actorOf, recordAdminAction } from "../../lib/admin/audit";
import { logger } from "../../lib/logger";
import { repeatInfringerThreshold } from "../../lib/ipEnforcement";
import {
  DEFAULT_RANKING_CONFIG, RANKING_CONFIG_KEY, getRankingConfig, saveRankingConfig,
} from "../../lib/ranking/config";
import heldRouter from "../moderationHeld";

const router = Router();

// ─── Held content ────────────────────────────────────────────────────────────

/** Audits successful approve/remove calls made through the admin mount. */
function auditHeld(req: Request, res: Response, next: NextFunction): void {
  const m = req.method === "POST" ? /^\/(post|video|story|comment)\/([^/]+)\/(approve|remove)$/.exec(req.path) : null;
  if (m) {
    res.on("finish", () => {
      if (res.statusCode >= 300) return;
      const [, type, id, action] = m;
      void recordAdminAction(actorOf(req), {
        action: `moderation.held.${action}`, targetType: type === "video" ? "post" : type, targetId: id,
        summary: action === "approve" ? `Published held ${type}` : `Removed held ${type}`,
      }).catch((err) => logger.error({ err, path: req.path }, "Failed to audit held-content action"));
    });
  }
  next();
}

router.use("/held", auditHeld, heldRouter);

// ─── Repeat infringers ───────────────────────────────────────────────────────

router.get("/repeat-infringers", async (req, res) => {
  try {
    const sellers = await db.select({
      userId: users.clerkId, name: users.name, brandName: users.brandName, username: users.username,
      ipStrikeCount: users.ipStrikeCount, ipRepeatInfringer: users.ipRepeatInfringer,
      ipRepeatInfringerFlaggedAt: users.ipRepeatInfringerFlaggedAt, suspendedAt: users.suspendedAt,
    }).from(users)
      .where(or(sql`${users.ipStrikeCount} > 0`, eq(users.ipRepeatInfringer, true)))
      .orderBy(desc(users.ipRepeatInfringer), desc(users.ipStrikeCount)).limit(200);

    const ids = sellers.map((s) => s.userId);
    const caseRows = ids.length
      ? await db.select({
          id: ipCases.id, publicReference: ipCases.publicReference, status: ipCases.status, rightsType: ipCases.rightsType,
          createdAt: ipCases.createdAt, takedownAt: ipCases.takedownAt, strikeAppliedAt: ipCases.strikeAppliedAt,
          counterNoticeStatus: ipCases.counterNoticeStatus, sellerId: ipCases.sellerId,
          listingOwnerId: products.ownerId, listingName: products.name,
        }).from(ipCases)
          .leftJoin(products, eq(products.id, ipCases.listingProductId))
          .where(or(inArray(ipCases.sellerId, ids), inArray(products.ownerId, ids)))
          .orderBy(desc(ipCases.createdAt)).limit(2000)
      : [];
    const bySeller = new Map<string, typeof caseRows>();
    for (const c of caseRows) {
      const owner = c.sellerId ?? c.listingOwnerId;
      if (!owner) continue;
      const list = bySeller.get(owner) ?? [];
      list.push(c);
      bySeller.set(owner, list);
    }

    return res.json({
      threshold: repeatInfringerThreshold(),
      sellers: sellers.map((s) => ({
        ...s,
        ipRepeatInfringerFlaggedAt: s.ipRepeatInfringerFlaggedAt?.toISOString() ?? null,
        suspendedAt: s.suspendedAt?.toISOString() ?? null,
        cases: (bySeller.get(s.userId) ?? []).map((c) => ({
          id: c.id, reference: c.publicReference, status: c.status, rightsType: c.rightsType, listingName: c.listingName,
          createdAt: c.createdAt.toISOString(), takedownAt: c.takedownAt?.toISOString() ?? null,
          strike: c.strikeAppliedAt != null, counterNoticeStatus: c.counterNoticeStatus,
        })),
      })),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to load repeat infringers");
    return res.status(500).json({ error: "Could not load repeat infringers." });
  }
});

router.post("/repeat-infringers/:userId/clear", async (req, res) => {
  const userId = String(req.params.userId);
  const resetStrikes = req.body?.resetStrikes === true;
  try {
    const result = await db.transaction(async (tx) => {
      const [before] = await tx.select({ strikes: users.ipStrikeCount, flagged: users.ipRepeatInfringer })
        .from(users).where(eq(users.clerkId, userId)).limit(1);
      if (!before) return null;
      await tx.update(users).set({
        ipRepeatInfringer: false, ipRepeatInfringerFlaggedAt: null,
        ...(resetStrikes ? { ipStrikeCount: 0 } : {}), updatedAt: new Date(),
      }).where(eq(users.clerkId, userId));
      await recordAdminAction(actorOf(req), {
        action: "ip.repeat_infringer.clear", targetType: "user", targetId: userId,
        summary: resetStrikes ? "Cleared the repeat-infringer flag and reset IP strikes" : "Cleared the repeat-infringer flag",
        metadata: { previousStrikes: before.strikes, previouslyFlagged: before.flagged, resetStrikes },
      }, tx);
      return { ipStrikeCount: resetStrikes ? 0 : before.strikes };
    });
    if (!result) return res.status(404).json({ error: "Seller not found" });
    return res.json({ ok: true, ipRepeatInfringer: false, ...result });
  } catch (err) {
    req.log.error({ err, userId }, "Failed to clear repeat-infringer flag");
    return res.status(500).json({ error: "Could not update this seller. Try again." });
  }
});

// ─── Ranking weights ─────────────────────────────────────────────────────────

async function rankingState() {
  const [row] = await db.select({ updatedAt: rankingConfig.updatedAt }).from(rankingConfig)
    .where(eq(rankingConfig.key, RANKING_CONFIG_KEY)).limit(1);
  return {
    config: await getRankingConfig(),
    defaults: DEFAULT_RANKING_CONFIG,
    stored: !!row,
    updatedAt: row?.updatedAt.toISOString() ?? null,
    // RANKING_WEIGHTS_JSON wins over the stored row; the screen says so.
    envOverride: !!process.env.RANKING_WEIGHTS_JSON,
  };
}

router.get("/ranking", async (req, res) => {
  try {
    return res.json(await rankingState());
  } catch (err) {
    req.log.error({ err }, "Failed to load ranking config");
    return res.status(500).json({ error: "Could not load ranking weights." });
  }
});

async function storeRanking(req: Request, res: Response, patch: unknown, summary: string) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    return res.status(400).json({ error: "Send the weights to change as an object." });
  }
  try {
    const before = await getRankingConfig();
    await saveRankingConfig(patch);
    const state = await rankingState();
    await recordAdminAction(actorOf(req), {
      action: "ranking.update", targetType: "ranking_config", targetId: RANKING_CONFIG_KEY, summary,
      metadata: { before, after: state.config },
    });
    return res.json(state);
  } catch (err) {
    req.log.error({ err }, "Failed to save ranking config");
    return res.status(500).json({ error: "Could not save ranking weights." });
  }
}

router.patch("/ranking", (req, res) => storeRanking(req, res, req.body, "Updated For You ranking weights"));
router.post("/ranking/reset", (req, res) => storeRanking(req, res, DEFAULT_RANKING_CONFIG, "Reset For You ranking weights to defaults"));

export default router;
