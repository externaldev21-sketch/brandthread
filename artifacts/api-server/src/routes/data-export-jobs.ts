/**
 * Async "Email me a download link" data export. Mounted at /auth/data-export
 * (before the auth router) and only owns /jobs* and /download; the instant
 * POST /auth/data-export is untouched.
 */
import { Router } from "express";
import { and, desc, eq } from "drizzle-orm";
import { db, dataExportJobs } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { EMAIL_EXPORT_CATEGORIES, normalizeExportCategories } from "../lib/dataExport";
import {
  generateDownloadToken,
  hashDownloadToken,
  isDownloadable,
  isValidTokenShape,
  nextExportRequestAt,
} from "../lib/dataExportJobs";
import { kickDataExportJobs, downloadUrlFor } from "../jobs/dataExportJob";
import { isMailerConfigured } from "../lib/mailer";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
import { getWebOrigin } from "../lib/webOrigin";

const router = Router();
const storage = new ObjectStorageService();

type JobRow = typeof dataExportJobs.$inferSelect;

function publicJob(job: JobRow, now = new Date()) {
  return {
    id: job.id,
    status: job.status,
    categories: job.categories ?? [],
    requestedAt: job.requestedAt.toISOString(),
    readyAt: job.readyAt?.toISOString() ?? null,
    expiresAt: job.expiresAt?.toISOString() ?? null,
    emailed: Boolean(job.emailedAt),
    downloadable: isDownloadable(job, now),
  };
}

// POST /api/auth/data-export/jobs  { include?: string[] }
router.post("/jobs", requireAuth, async (req, res) => {
  const clerkUserId = (req as any).clerkUserId as string;
  const include = normalizeExportCategories(
    req.body?.include ?? ["profile", "orders", "messages"],
    EMAIL_EXPORT_CATEGORIES,
  );
  if (include.length === 0) {
    res.status(400).json({ error: "Select at least one export category." });
    return;
  }
  try {
    const [latest] = await db.select().from(dataExportJobs)
      .where(eq(dataExportJobs.clerkId, clerkUserId))
      .orderBy(desc(dataExportJobs.requestedAt))
      .limit(5)
      .then((rows) => rows.filter((row) => row.status !== "failed"));
    const nextAt = nextExportRequestAt(latest?.requestedAt ?? null);
    if (latest && nextAt) {
      res.setHeader("Retry-After", String(Math.max(1, Math.ceil((nextAt.getTime() - Date.now()) / 1000))));
      res.status(429).json({
        error: "You can request one data export every 24 hours.",
        code: "DATA_EXPORT_RATE_LIMITED",
        nextRequestAt: nextAt.toISOString(),
        job: publicJob(latest),
      });
      return;
    }
    const [job] = await db.insert(dataExportJobs)
      .values({ clerkId: clerkUserId, categories: include })
      .returning();
    kickDataExportJobs();
    res.status(202).json({ job: publicJob(job) });
  } catch (err) {
    req.log.error({ err, clerkUserId }, "Failed to queue data export");
    res.status(500).json({ error: "Could not start your data export." });
  }
});

// GET /api/auth/data-export/jobs — recent jobs + when the next request is allowed
router.get("/jobs", requireAuth, async (req, res) => {
  const clerkUserId = (req as any).clerkUserId as string;
  try {
    const rows = await db.select().from(dataExportJobs)
      .where(eq(dataExportJobs.clerkId, clerkUserId))
      .orderBy(desc(dataExportJobs.requestedAt))
      .limit(5);
    const counted = rows.find((row) => row.status !== "failed");
    const nextAt = nextExportRequestAt(counted?.requestedAt ?? null);
    res.json({
      jobs: rows.map((row) => publicJob(row)),
      nextRequestAt: nextAt?.toISOString() ?? null,
      emailEnabled: isMailerConfigured(),
    });
  } catch (err) {
    req.log.error({ err, clerkUserId }, "Failed to list data exports");
    res.status(500).json({ error: "Could not load your data exports." });
  }
});

// POST /api/auth/data-export/jobs/:id/link — fresh download link for a ready job
// (the emailed token is never stored, so the app mints a new one on demand).
router.post("/jobs/:id/link", requireAuth, async (req, res) => {
  const clerkUserId = (req as any).clerkUserId as string;
  try {
    const [job] = await db.select().from(dataExportJobs)
      .where(and(eq(dataExportJobs.id, String(req.params.id)), eq(dataExportJobs.clerkId, clerkUserId)))
      .limit(1);
    if (!job || !isDownloadable(job)) {
      res.status(404).json({ error: "This export is no longer available.", code: "DATA_EXPORT_UNAVAILABLE" });
      return;
    }
    const token = generateDownloadToken();
    await db.update(dataExportJobs)
      .set({ downloadTokenHash: hashDownloadToken(token) })
      .where(eq(dataExportJobs.id, job.id));
    res.json({
      url: downloadUrlFor(getWebOrigin(), token),
      expiresAt: job.expiresAt!.toISOString(),
    });
  } catch (err) {
    req.log.error({ err, clerkUserId }, "Failed to mint data export link");
    res.status(500).json({ error: "Could not create a download link." });
  }
});

// GET /api/auth/data-export/download?token=… — auth-free; the 256-bit token is
// the credential and only its SHA-256 hash is stored.
router.get("/download", async (req, res) => {
  const token = req.query.token;
  if (!isValidTokenShape(token)) {
    res.status(404).json({ error: "This download link is not valid." });
    return;
  }
  try {
    const [job] = await db.select().from(dataExportJobs)
      .where(eq(dataExportJobs.downloadTokenHash, hashDownloadToken(token)))
      .limit(1);
    if (!job || job.status === "failed") {
      res.status(404).json({ error: "This download link is not valid." });
      return;
    }
    if (!isDownloadable(job) || !job.fileObjectKey) {
      res.status(410).json({ error: "This download link has expired. Request a new export in the app." });
      return;
    }
    const file = await storage.getObjectEntityFile(job.fileObjectKey);
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="brandthread-my-data-${job.id}.json"`);
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    file.createReadStream()
      .on("error", (err) => {
        req.log.error({ err, jobId: job.id }, "Data export stream failed");
        if (!res.headersSent) res.status(500).end();
        else res.destroy();
      })
      .pipe(res);
  } catch (err) {
    if (err instanceof ObjectNotFoundError) {
      res.status(410).json({ error: "This download link has expired. Request a new export in the app." });
      return;
    }
    req.log.error({ err }, "Failed to serve data export");
    res.status(500).json({ error: "Could not download your data." });
  }
});

export default router;
