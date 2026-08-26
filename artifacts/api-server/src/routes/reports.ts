/**
 * Content reports (post / product / profile / seller / message).
 * POST /api/reports           — submit a report (requireAuth)
 * GET  /api/reports           — list all reports for moderation (requireAuth)
 */
import { Router } from "express";
import { conversationParticipants, conversations, db, messageReports, messages, reports } from "@workspace/db";
import { desc, eq, and, sql } from "drizzle-orm";
import { requireAuth, requireModerator } from "../middlewares/requireAuth";

const router = Router();
router.use(requireAuth);

function serializeReportForClient(report: typeof reports.$inferSelect) {
  const { reporterId: _reporterId, ...safeReport } = report;
  return safeReport;
}

// POST /api/reports
router.post("/", async (req, res) => {
  const reporterId = (req as any).clerkUserId as string;
  const { targetType, targetId, targetLabel, reason, description } = req.body as {
    targetType:   string;
    targetId:     string;
    targetLabel?: string;
    reason:       string;
    description?: string;
  };

  if (!targetType || !targetId || !reason) {
    return res.status(400).json({ error: "targetType, targetId and reason are required" });
  }

  const VALID_TARGET_TYPES = ["post", "product", "profile", "story", "message", "seller"];
  if (!VALID_TARGET_TYPES.includes(targetType)) {
    return res.status(400).json({ error: `targetType must be one of: ${VALID_TARGET_TYPES.join(", ")}` });
  }

  if (targetType === "message") {
    const [message] = await db
      .select({ id: messages.id, conversationId: messages.conversationId })
      .from(messages)
      .where(eq(messages.id, targetId))
      .limit(1);
    if (!message) return res.status(404).json({ error: "Message not found" });

    const [participant] = await db
      .select({ userId: conversationParticipants.userId })
      .from(conversationParticipants)
      .where(and(
        eq(conversationParticipants.conversationId, message.conversationId),
        eq(conversationParticipants.userId, reporterId),
      ))
      .limit(1);
    if (!participant) return res.status(403).json({ error: "Only conversation participants can report a message" });

    const [createdMessageReport] = await db.insert(messageReports)
      .values({ messageId: message.id, reporterId, reason, description: description ?? null })
      .onConflictDoNothing()
      .returning({ id: messageReports.id });
    if (!createdMessageReport) {
      return res.status(200).json({ status: "already_reported" });
    }

    const now = new Date();
    await Promise.all([
      db.update(messages)
        .set({ moderationStatus: "reported", reportedAt: now })
        .where(eq(messages.id, message.id)),
      db.update(conversations)
        .set({
          moderationStatus: "reported",
          reportedAt: now,
          reportCount: sql`${conversations.reportCount} + 1`,
          updatedAt: now,
        })
        .where(eq(conversations.id, message.conversationId)),
    ]);
  }

  const [report] = await db
    .insert(reports)
    .values({
      reporterId,
      targetType,
      targetId,
      targetLabel: targetLabel ?? null,
      reason,
      description: description ?? null,
    })
    .returning();

  return res.status(201).json(serializeReportForClient(report));
});

// GET /api/reports — admin/moderation list
router.get("/", requireModerator, async (req, res) => {
  const limit  = Math.min(parseInt(String(req.query.limit  ?? 50),  10), 200);
  const offset = parseInt(String(req.query.offset ?? 0), 10);
  const status = req.query.status as string | undefined;

  const rows = await db
    .select()
    .from(reports)
    .where(status ? eq(reports.status, status) : undefined)
    .orderBy(desc(reports.createdAt))
    .limit(limit)
    .offset(offset);

  // Reporter identity is moderation-only information. This route is shared by
  // authenticated clients, so never reveal it to another conversation member.
  return res.json(rows.map(serializeReportForClient));
});

// PATCH /api/reports/:id/status — update report status (actioned/dismissed/reviewed)
router.patch("/:id/status", requireModerator, async (req, res) => {
  const reportId = String(req.params.id);
  const { status } = req.body as { status: string };
  const VALID = ["pending", "reviewed", "actioned", "dismissed"];
  if (!VALID.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${VALID.join(", ")}` });
  }
  const [updated] = await db
    .update(reports)
    .set({ status })
    .where(eq(reports.id, reportId))
    .returning();
  if (!updated) return res.status(404).json({ error: "Report not found" });
  return res.json(serializeReportForClient(updated));
});

export default router;
