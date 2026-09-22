/**
 * Moderation review queue (platform moderators only — users.role = 'admin').
 *
 * GET  /api/moderation/me                       — { isModerator } for any signed-in user
 * GET  /api/moderation/reports?status=open|resolved&type=&limit=&offset=
 * POST /api/moderation/reports/:id/resolve      — { action, note? }
 *        action: 'dismiss'        close without action (publishes filter-held content)
 *                'remove_content' take the reported content down
 *                'suspend_user'   suspend the content owner (and sign them out)
 * POST /api/moderation/users/:userId/reinstate  — lift a suspension
 *
 * Resolving a report resolves every open report on the same item, so the
 * queue never asks two moderators to review the same thing.
 */
import { Router } from "express";
import { clerkClient } from "@clerk/express";
import { and, count, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { db, reports, users } from "@workspace/db";
import { requireAuth, requireModerator } from "../middlewares/requireAuth";
import {
  normalizeTargetType,
  releaseHeldContent,
  removeReportedContent,
  resolveReportTarget,
} from "../lib/reportTargets";
import { profilesById, type ReportTargetType } from "../lib/safety";

const router = Router();
router.use(requireAuth);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MODERATION_ACTIONS = ["dismiss", "remove_content", "suspend_user"] as const;
export type ModerationAction = typeof MODERATION_ACTIONS[number];

router.get("/me", async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  const [account] = await db.select({ role: users.role }).from(users).where(eq(users.clerkId, userId)).limit(1);
  res.json({ isModerator: account?.role === "admin" });
});

router.use(requireModerator);

// ─── GET /api/moderation/reports ─────────────────────────────────────────────
router.get("/reports", async (req, res) => {
  const statusParam = String(req.query.status ?? "open");
  if (!["open", "resolved", "all"].includes(statusParam)) {
    return res.status(400).json({ error: "status must be open, resolved or all" });
  }
  const type = req.query.type ? normalizeTargetType(req.query.type) : null;
  if (req.query.type && !type) return res.status(400).json({ error: "Unknown content type" });
  const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? 50), 10) || 50, 1), 100);
  const offset = Math.max(parseInt(String(req.query.offset ?? 0), 10) || 0, 0);

  const statusFilter = statusParam === "open"
    ? eq(reports.status, "pending")
    : statusParam === "resolved" ? ne(reports.status, "pending") : undefined;

  try {
    const rows = await db
      .select()
      .from(reports)
      .where(and(statusFilter, type ? eq(reports.targetType, type) : undefined))
      .orderBy(statusParam === "open" ? sql`${reports.createdAt} ASC` : desc(reports.createdAt))
      .limit(limit + 1)
      .offset(offset);
    const page = rows.slice(0, limit);

    const targetKeys = [...new Set(page.map((r) => `${r.targetType}:${r.targetId}`))];
    const ownerIds = [...new Set(page.map((r) => r.targetOwnerId).filter((id): id is string => !!id))];
    const reporterIds = page.map((r) => r.reporterId).filter((id) => !id.startsWith("system:"));

    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    const [openCounts, priorActions, profiles, summaryRows] = await Promise.all([
      targetKeys.length ? db
        .select({ targetType: reports.targetType, targetId: reports.targetId, n: count() })
        .from(reports)
        .where(and(eq(reports.status, "pending"), inArray(sql`${reports.targetType} || ':' || ${reports.targetId}`, targetKeys)))
        .groupBy(reports.targetType, reports.targetId) : Promise.resolve([]),
      ownerIds.length ? db
        .select({ ownerId: reports.targetOwnerId, n: count() })
        .from(reports)
        .where(and(eq(reports.status, "actioned"), inArray(reports.targetOwnerId, ownerIds)))
        .groupBy(reports.targetOwnerId) : Promise.resolve([]),
      profilesById([...ownerIds, ...reporterIds]),
      db.select({
        open: sql<number>`count(*) FILTER (WHERE ${reports.status} = 'pending')`,
        held: sql<number>`count(*) FILTER (WHERE ${reports.status} = 'pending' AND ${reports.source} = 'auto_filter')`,
        resolvedToday: sql<number>`count(*) FILTER (WHERE ${reports.status} <> 'pending' AND ${reports.resolvedAt} >= ${startOfDay})`,
      }).from(reports),
    ]);
    const openByTarget = new Map(openCounts.map((row) => [`${row.targetType}:${row.targetId}`, Number(row.n)]));
    const priorByOwner = new Map(priorActions.map((row) => [row.ownerId, Number(row.n)]));

    const items = page.map((report) => ({
      id: report.id,
      status: report.status,
      source: report.source,
      targetType: report.targetType,
      targetId: report.targetId,
      targetLabel: report.targetLabel,
      contentExcerpt: report.contentExcerpt,
      reason: report.reason,
      note: report.description,
      createdAt: report.createdAt.toISOString(),
      resolution: report.status === "pending" ? null : {
        action: report.resolutionAction,
        note: report.resolutionNote,
        resolvedAt: report.resolvedAt?.toISOString() ?? null,
      },
      owner: report.targetOwnerId ? profiles.get(report.targetOwnerId) ?? null : null,
      reporter: report.reporterId.startsWith("system:") ? null : profiles.get(report.reporterId) ?? null,
      openReportsOnTarget: openByTarget.get(`${report.targetType}:${report.targetId}`) ?? 0,
      ownerPriorActions: report.targetOwnerId ? priorByOwner.get(report.targetOwnerId) ?? 0 : 0,
    }));

    return res.json({
      items,
      hasMore: rows.length > limit,
      summary: {
        open: Number(summaryRows[0]?.open ?? 0),
        heldByFilter: Number(summaryRows[0]?.held ?? 0),
        resolvedToday: Number(summaryRows[0]?.resolvedToday ?? 0),
      },
    });
  } catch (err) {
    req.log.error({ err }, "Failed to load moderation queue");
    return res.status(500).json({ error: "Could not load the review queue." });
  }
});

// ─── POST /api/moderation/reports/:id/resolve ────────────────────────────────
router.post("/reports/:id/resolve", async (req, res) => {
  const moderatorId = (req as any).clerkUserId as string;
  const reportId = String(req.params.id);
  if (!UUID_RE.test(reportId)) return res.status(404).json({ error: "Report not found" });
  const { action, note: rawNote } = (req.body ?? {}) as { action?: unknown; note?: unknown };
  if (typeof action !== "string" || !(MODERATION_ACTIONS as readonly string[]).includes(action)) {
    return res.status(400).json({ error: `action must be one of: ${MODERATION_ACTIONS.join(", ")}` });
  }
  const note = typeof rawNote === "string" ? rawNote.trim().slice(0, 1000) : "";

  const [report] = await db.select().from(reports).where(eq(reports.id, reportId)).limit(1);
  if (!report) return res.status(404).json({ error: "Report not found" });
  const targetType = normalizeTargetType(report.targetType);
  if (!targetType) return res.status(422).json({ error: "This report targets an unsupported content type." });

  const ownerId = report.targetOwnerId
    ?? (await resolveReportTarget(targetType, report.targetId))?.ownerId
    ?? null;

  try {
    let suspendedUser: string | null = null;
    if (action === "dismiss") {
      await releaseHeldContent(targetType as ReportTargetType, report.targetId, moderatorId);
    } else if (action === "remove_content") {
      await removeReportedContent(targetType as ReportTargetType, report.targetId, moderatorId);
    } else {
      if (!ownerId || ownerId.startsWith("deleted")) {
        return res.status(422).json({ error: "There is no account to suspend for this report." });
      }
      if (ownerId === moderatorId) return res.status(400).json({ error: "You can't suspend your own account." });
      const [owner] = await db.select({ role: users.role }).from(users).where(eq(users.clerkId, ownerId)).limit(1);
      if (owner?.role === "admin") {
        return res.status(403).json({ error: "Moderator accounts can't be suspended from the queue." });
      }
      await db.update(users)
        .set({
          suspendedAt: new Date(),
          suspensionReason: note || `Community Guidelines violation (${report.reason})`,
          activeStanding: false,
          updatedAt: new Date(),
        })
        .where(eq(users.clerkId, ownerId));
      suspendedUser = ownerId;
    }

    const status = action === "dismiss" ? "dismissed" : "actioned";
    const resolved = await db.update(reports)
      .set({
        status,
        resolutionAction: action,
        resolutionNote: note || null,
        resolvedBy: moderatorId,
        resolvedAt: new Date(),
      })
      .where(and(
        eq(reports.targetType, report.targetType),
        eq(reports.targetId, report.targetId),
        eq(reports.status, "pending"),
      ))
      .returning({ id: reports.id });

    // Banning in Clerk revokes every session so a suspended account is signed
    // out everywhere immediately. The database flag already hides content and
    // blocks publishing, so a Clerk outage does not undo the suspension.
    let signedOut = false;
    if (suspendedUser) {
      try {
        await clerkClient.users.banUser(suspendedUser);
        signedOut = true;
      } catch (err) {
        req.log.warn({ err, userId: suspendedUser }, "Clerk ban failed after suspension");
      }
    }

    return res.json({
      ok: true,
      status,
      action,
      resolvedReports: Math.max(resolved.length, 1),
      suspendedUserId: suspendedUser,
      signedOut,
    });
  } catch (err) {
    req.log.error({ err, reportId, action }, "Failed to resolve report");
    return res.status(500).json({ error: "Could not apply that action. Try again." });
  }
});

// ─── POST /api/moderation/users/:userId/reinstate ────────────────────────────
router.post("/users/:userId/reinstate", async (req, res) => {
  const userId = String(req.params.userId);
  const rows = await db.update(users)
    .set({ suspendedAt: null, suspensionReason: null, activeStanding: true, updatedAt: new Date() })
    .where(eq(users.clerkId, userId))
    .returning({ id: users.id });
  if (rows.length === 0) return res.status(404).json({ error: "User not found" });
  try {
    await clerkClient.users.unbanUser(userId);
  } catch (err) {
    req.log.warn({ err, userId }, "Clerk unban failed after reinstatement");
  }
  return res.json({ ok: true });
});

export default router;
