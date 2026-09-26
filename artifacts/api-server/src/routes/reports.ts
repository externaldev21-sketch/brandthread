/**
 * Member reports (App Store guideline 1.2).
 *
 * POST  /api/reports              — report a post, video, live stream, comment,
 *                                   live chat message, story, product, profile or DM
 * GET   /api/reports              — moderators: raw report list (legacy; the
 *                                   moderation queue lives at /api/moderation)
 * PATCH /api/reports/:id/status   — moderators: legacy status update
 *
 * Reasons: spam | harassment | nudity | hate | violence | ip_counterfeit | scam | other.
 * "other" requires a note. The reported content's owner and a snapshot of the
 * content are resolved server-side and stored for moderators.
 */
import { Router } from "express";
import { conversationParticipants, conversations, db, messageReports, reports } from "@workspace/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { requireAuth, requireModerator } from "../middlewares/requireAuth";
import { rateLimit } from "../middlewares/rateLimit";
import {
  REPORT_REASONS,
  REPORT_TARGET_TYPES,
  normalizeReportReason,
  normalizeTargetType,
  resolveReportTarget,
} from "../lib/reportTargets";
import { isAgentUserId } from "../lib/brandthreadAgent";

const router = Router();
router.use(requireAuth);

export const MAX_REPORT_NOTE_LENGTH = 1000;

function serializeReportForClient(report: typeof reports.$inferSelect) {
  const { reporterId: _reporterId, ...safeReport } = report;
  return safeReport;
}

// POST /api/reports
router.post("/", rateLimit("report"), async (req, res) => {
  const reporterId = (req as any).clerkUserId as string;
  const body = (req.body ?? {}) as {
    targetType?: unknown; targetId?: unknown; reason?: unknown;
    note?: unknown; description?: unknown;
  };

  const targetType = normalizeTargetType(body.targetType);
  if (!targetType) {
    return res.status(400).json({
      error: `targetType must be one of: ${REPORT_TARGET_TYPES.join(", ")}`,
      code: "VALIDATION_ERROR",
    });
  }
  const targetId = typeof body.targetId === "string" ? body.targetId.trim() : "";
  if (!targetId) return res.status(400).json({ error: "targetId is required", code: "VALIDATION_ERROR" });

  const reason = normalizeReportReason(body.reason);
  if (!reason) {
    return res.status(400).json({
      error: `reason must be one of: ${REPORT_REASONS.join(", ")}`,
      code: "VALIDATION_ERROR",
    });
  }
  const rawNote = typeof body.note === "string" ? body.note : typeof body.description === "string" ? body.description : "";
  const note = rawNote.trim();
  if (note.length > MAX_REPORT_NOTE_LENGTH) {
    return res.status(400).json({ error: `Notes can be up to ${MAX_REPORT_NOTE_LENGTH} characters.`, code: "VALIDATION_ERROR" });
  }
  if (reason === "other" && note.length < 3) {
    return res.status(400).json({ error: "Tell us a little about what's wrong so we can review it.", code: "NOTE_REQUIRED" });
  }

  try {
    const target = await resolveReportTarget(targetType, targetId);
    if (!target) return res.status(404).json({ error: "That content is no longer available." });
    if (target.ownerId && target.ownerId === reporterId) {
      return res.status(400).json({ error: "You can't report your own content.", code: "SELF_REPORT" });
    }
    // The Brandthread Agent is an official Brandthread system account, not a
    // member — it cannot be reported as spam/abuse (its messages/profile are
    // maintained by Brandthread, not moderatable member content).
    if (target.ownerId && isAgentUserId(target.ownerId)) {
      return res.status(200).json({ status: "not_reportable", code: "SYSTEM_ACCOUNT_IMMUNE" });
    }

    if (targetType === "message") {
      const [participant] = await db
        .select({ userId: conversationParticipants.userId })
        .from(conversationParticipants)
        .where(and(
          eq(conversationParticipants.conversationId, target.containerId!),
          eq(conversationParticipants.userId, reporterId),
        ))
        .limit(1);
      if (!participant) return res.status(403).json({ error: "Only conversation participants can report a message" });

      const [createdMessageReport] = await db.insert(messageReports)
        .values({ messageId: target.targetId, reporterId, reason, description: note || null })
        .onConflictDoNothing()
        .returning({ id: messageReports.id });
      if (!createdMessageReport) {
        return res.status(200).json({ status: "already_reported" });
      }

      const now = new Date();
      await Promise.all([
        db.execute(sql`UPDATE messages SET moderation_status = 'reported', reported_at = ${now}
          WHERE id = ${target.targetId} AND moderation_status <> 'removed'`),
        db.update(conversations)
          .set({
            moderationStatus: "reported",
            reportedAt: now,
            reportCount: sql`${conversations.reportCount} + 1`,
            updatedAt: now,
          })
          .where(eq(conversations.id, target.containerId!)),
      ]);
    }

    // One open report per person per item: repeat taps are acknowledged
    // without growing the queue.
    const [existing] = await db
      .select({ id: reports.id })
      .from(reports)
      .where(and(
        eq(reports.reporterId, reporterId),
        eq(reports.targetType, targetType),
        eq(reports.targetId, target.targetId),
        eq(reports.status, "pending"),
      ))
      .limit(1);
    if (existing) return res.status(200).json({ status: "already_reported", id: existing.id });

    const [report] = await db
      .insert(reports)
      .values({
        reporterId,
        targetType,
        targetId: target.targetId,
        targetLabel: target.label,
        targetOwnerId: target.ownerId,
        contentExcerpt: target.excerpt,
        reason,
        description: note || null,
        source: "user",
      })
      .returning();

    return res.status(201).json(serializeReportForClient(report));
  } catch (err) {
    req.log.error({ err, targetType, targetId }, "Failed to create report");
    return res.status(500).json({ error: "We couldn't send your report. Please try again." });
  }
});

// GET /api/reports — moderators only (legacy list)
router.get("/", requireModerator, async (req, res) => {
  const limit  = Math.min(Math.max(parseInt(String(req.query.limit ?? 50), 10) || 50, 1), 200);
  const offset = Math.max(parseInt(String(req.query.offset ?? 0), 10) || 0, 0);
  const status = req.query.status as string | undefined;

  const rows = await db
    .select()
    .from(reports)
    .where(status ? eq(reports.status, status) : undefined)
    .orderBy(desc(reports.createdAt))
    .limit(limit)
    .offset(offset);

  return res.json(rows.map(serializeReportForClient));
});

// PATCH /api/reports/:id/status — moderators only (legacy)
router.patch("/:id/status", requireModerator, async (req, res) => {
  const reportId = String(req.params.id);
  const { status } = req.body as { status: string };
  const VALID = ["pending", "reviewed", "actioned", "dismissed"];
  if (!VALID.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${VALID.join(", ")}` });
  }
  const moderatorId = (req as any).clerkUserId as string;
  const [updated] = await db
    .update(reports)
    .set({
      status,
      resolvedBy: status === "pending" ? null : moderatorId,
      resolvedAt: status === "pending" ? null : new Date(),
    })
    .where(eq(reports.id, reportId))
    .returning();
  if (!updated) return res.status(404).json({ error: "Report not found" });
  return res.json(serializeReportForClient(updated));
});

export default router;
