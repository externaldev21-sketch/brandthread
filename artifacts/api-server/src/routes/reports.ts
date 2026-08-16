/**
 * Content reports (post / product / profile / seller).
 * POST /api/reports           — submit a report (requireAuth)
 * GET  /api/reports           — list all reports for moderation (requireAuth)
 */
import { Router } from "express";
import { db, reports } from "@workspace/db";
import { desc, eq, and } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";

const router = Router();
router.use(requireAuth);

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

  return res.status(201).json(report);
});

// GET /api/reports — admin/moderation list
router.get("/", async (req, res) => {
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

  return res.json(rows);
});

// PATCH /api/reports/:id/status — update report status (actioned/dismissed/reviewed)
router.patch("/:id/status", async (req, res) => {
  const { status } = req.body as { status: string };
  const VALID = ["pending", "reviewed", "actioned", "dismissed"];
  if (!VALID.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${VALID.join(", ")}` });
  }
  const [updated] = await db
    .update(reports)
    .set({ status })
    .where(eq(reports.id, req.params.id))
    .returning();
  if (!updated) return res.status(404).json({ error: "Report not found" });
  return res.json(updated);
});

export default router;
