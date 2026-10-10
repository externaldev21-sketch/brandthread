/**
 * Moderation review queue (platform moderators only — users.role = 'admin').
 *
 * GET  /api/moderation/me                       — { isModerator } for any signed-in user
 * GET  /api/moderation/reports?status=open|resolved&type=&limit=&offset=
 * POST /api/moderation/reports/:id/resolve      — { action, note? }
 *        action: 'dismiss'        close without action (publishes filter-held content)
 *                'remove_content' take the reported content down
 *                'suspend_user'   suspend the content owner (and sign them out);
 *                                 optional durationDays 1|3|7|30 (default: until reinstated)
 *                'warn'           warn the owner (in-app + push); content stays
 *                'ban'            permanently ban the owner
 * POST /api/moderation/reports/bulk-dismiss     — { ids: string[] (≤100), note? }
 * GET  /api/moderation/reports/:id/context      — the reported item; for a DM, the
 *                                                 reported message plus a few lines
 *                                                 either side from that conversation only
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
import heldRouter from "./moderationHeld";
import { notifyWarnedUser, parseSuspensionDays, recordUserAction } from "../lib/moderation/userActions";

const router = Router();
router.use(requireAuth);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MODERATION_ACTIONS = ["dismiss", "remove_content", "suspend_user", "warn", "ban"] as const;
/** Lines of DM context shown either side of a reported message. */
export const DM_CONTEXT_LINES = 3;
export type ModerationAction = typeof MODERATION_ACTIONS[number];

/** Review promise shown in the Community Guidelines: act on every report within 24 hours. */
export const REPORT_SLA_HOURS = 24;
export function reportDueBy(createdAt: Date): Date {
  return new Date(createdAt.getTime() + REPORT_SLA_HOURS * 3_600_000);
}

router.get("/me", async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  const [account] = await db.select({ role: users.role }).from(users).where(eq(users.clerkId, userId)).limit(1);
  res.json({ isModerator: account?.role === "admin" });
});

router.use(requireModerator);
router.use("/held", heldRouter);

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
        overdue: sql<number>`count(*) FILTER (WHERE ${reports.status} = 'pending' AND ${reports.createdAt} < ${new Date(Date.now() - REPORT_SLA_HOURS * 3_600_000)})`,
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
      dueBy: reportDueBy(report.createdAt).toISOString(),
      overdue: report.status === "pending" && reportDueBy(report.createdAt).getTime() < Date.now(),
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
        overdue: Number(summaryRows[0]?.overdue ?? 0),
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
  const { action, note: rawNote, durationDays: rawDays } = (req.body ?? {}) as { action?: unknown; note?: unknown; durationDays?: unknown };
  if (typeof action !== "string" || !(MODERATION_ACTIONS as readonly string[]).includes(action)) {
    return res.status(400).json({ error: `action must be one of: ${MODERATION_ACTIONS.join(", ")}` });
  }
  const note = typeof rawNote === "string" ? rawNote.trim().slice(0, 1000) : "";
  const durationDays = action === "suspend_user" ? parseSuspensionDays(rawDays) : null;
  if (durationDays === "invalid") return res.status(400).json({ error: "durationDays must be 1, 3, 7 or 30" });

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
        return res.status(422).json({ error: action === "warn" ? "There is no account to warn for this report." : "There is no account to suspend for this report." });
      }
      if (ownerId === moderatorId) return res.status(400).json({ error: "You can't act on your own account." });
      const [owner] = await db.select({ role: users.role }).from(users).where(eq(users.clerkId, ownerId)).limit(1);
      if (owner?.role === "admin") {
        return res.status(403).json({ error: "Moderator accounts can't be suspended from the queue." });
      }
      const reason = note || `Community Guidelines violation (${report.reason.replaceAll("_", " ")})`;
      if (action === "warn") {
        await recordUserAction(db, { userId: ownerId, kind: "warn", reason, reportId: report.id, actor: moderatorId });
        await notifyWarnedUser(ownerId, note || "Something you shared was reported and goes against the Community Guidelines.");
      } else {
        const endsAt = typeof durationDays === "number" ? new Date(Date.now() + durationDays * 86_400_000) : null;
        await db.update(users)
          .set({
            suspendedAt: new Date(),
            suspensionReason: reason,
            activeStanding: false,
            updatedAt: new Date(),
          })
          .where(eq(users.clerkId, ownerId));
        await recordUserAction(db, { userId: ownerId, kind: action === "ban" ? "ban" : "suspend", reason, reportId: report.id, actor: moderatorId, endsAt });
        suspendedUser = ownerId;
      }
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

// ─── POST /api/moderation/reports/bulk-dismiss ───────────────────────────────
router.post("/reports/bulk-dismiss", async (req, res) => {
  const moderatorId = (req as any).clerkUserId as string;
  const rawIds = (req.body as { ids?: unknown } | undefined)?.ids;
  const note = typeof req.body?.note === "string" ? req.body.note.trim().slice(0, 1000) : "";
  if (!Array.isArray(rawIds) || rawIds.length === 0 || rawIds.length > 100 || !rawIds.every((id) => typeof id === "string" && UUID_RE.test(id))) {
    return res.status(400).json({ error: "ids must be 1–100 report ids" });
  }
  try {
    const rows = await db.select().from(reports).where(and(inArray(reports.id, rawIds as string[]), eq(reports.status, "pending")));
    let dismissed = 0;
    const seen = new Set<string>();
    for (const report of rows) {
      const key = `${report.targetType}:${report.targetId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const targetType = normalizeTargetType(report.targetType);
      if (targetType) await releaseHeldContent(targetType as ReportTargetType, report.targetId, moderatorId);
      const done = await db.update(reports)
        .set({ status: "dismissed", resolutionAction: "dismiss", resolutionNote: note || null, resolvedBy: moderatorId, resolvedAt: new Date() })
        .where(and(eq(reports.targetType, report.targetType), eq(reports.targetId, report.targetId), eq(reports.status, "pending")))
        .returning({ id: reports.id });
      dismissed += done.length;
    }
    return res.json({ ok: true, dismissed });
  } catch (err) {
    req.log.error({ err }, "Bulk dismiss failed");
    return res.status(500).json({ error: "Could not dismiss those reports. Try again." });
  }
});

// ─── GET /api/moderation/reports/:id/context ─────────────────────────────────
// What the moderator needs to judge one report. For a DM report this is the
// reported message plus DM_CONTEXT_LINES messages either side, from that one
// conversation only — never the rest of anyone's inbox.
router.get("/reports/:id/context", async (req, res) => {
  const reportId = String(req.params.id);
  if (!UUID_RE.test(reportId)) return res.status(404).json({ error: "Report not found" });
  try {
    const [report] = await db.select().from(reports).where(eq(reports.id, reportId)).limit(1);
    if (!report) return res.status(404).json({ error: "Report not found" });
    const base = { id: report.id, targetType: report.targetType, excerpt: report.contentExcerpt, note: report.description };
    if (normalizeTargetType(report.targetType) !== "message" || !UUID_RE.test(report.targetId)) return res.json({ ...base, messages: null });
    const result = await db.execute(sql`
      WITH target AS (SELECT conversation_id, created_at, id FROM messages WHERE id = ${report.targetId}::uuid)
      SELECT * FROM (
        (SELECT m.id, m.sender_id, m.body, m.created_at FROM messages m, target t
          WHERE m.conversation_id = t.conversation_id AND (m.created_at, m.id) < (t.created_at, t.id)
          ORDER BY m.created_at DESC, m.id DESC LIMIT ${DM_CONTEXT_LINES})
        UNION ALL
        (SELECT m.id, m.sender_id, m.body, m.created_at FROM messages m, target t WHERE m.id = t.id)
        UNION ALL
        (SELECT m.id, m.sender_id, m.body, m.created_at FROM messages m, target t
          WHERE m.conversation_id = t.conversation_id AND (m.created_at, m.id) > (t.created_at, t.id)
          ORDER BY m.created_at ASC, m.id ASC LIMIT ${DM_CONTEXT_LINES})
      ) ctx ORDER BY created_at ASC, id ASC`);
    const rows = ((result as unknown as { rows?: Array<{ id: string; sender_id: string; body: string; created_at: Date | string }> }).rows ?? []);
    const people = await profilesById([...new Set(rows.map((r) => r.sender_id))]);
    return res.json({
      ...base,
      messages: rows.map((r) => {
        const p = people.get(r.sender_id) as { displayName?: string | null; name?: string | null; username?: string | null } | undefined;
        return {
          id: r.id,
          reported: r.id === report.targetId,
          sender: p ? (p.displayName || p.name || (p.username ? `@${p.username}` : "Member")) : "Member",
          isOwner: r.sender_id === report.targetOwnerId,
          body: String(r.body ?? "").slice(0, 2000),
          createdAt: new Date(r.created_at).toISOString(),
        };
      }),
    });
  } catch (err) {
    req.log.error({ err, reportId }, "Report context failed");
    return res.status(500).json({ error: "Could not load this report." });
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
