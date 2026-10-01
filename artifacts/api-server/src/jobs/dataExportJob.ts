import { and, eq, lt, asc, sql } from "drizzle-orm";
import { db, dataExportJobs, users } from "@workspace/db";
import { logger } from "../lib/logger";
import { buildAccountDataExport } from "../lib/dataExport";
import { ObjectStorageService } from "../lib/objectStorage";
import { isMailerConfigured, sendDataExportReadyEmail } from "../lib/mailer";
import { getWebOrigin } from "../lib/webOrigin";
import {
  DATA_EXPORT_LINK_TTL_MS,
  DATA_EXPORT_RUNNING_STALE_MS,
  generateDownloadToken,
  hashDownloadToken,
  statusAfterFailure,
  type DataExportStatus,
} from "../lib/dataExportJobs";

const INTERVAL_MS = 60 * 1000;
const MAX_JOBS_PER_TICK = 5;

export type ClaimedJob = { id: string; clerkId: string; categories: string[]; attempts: number };

export type ReadyPatch = {
  status: "ready";
  fileObjectKey: string;
  readyAt: Date;
  expiresAt: Date;
  downloadTokenHash: string;
  emailedAt: Date | null;
};

export type ProcessDeps = {
  now: () => Date;
  origin: () => string;
  mailerConfigured: () => boolean;
  buildExport: (clerkId: string, categories: string[]) => Promise<Record<string, unknown>>;
  uploadFile: (jobId: string, contents: Buffer) => Promise<string>;
  getEmail: (clerkId: string) => Promise<string | null>;
  sendEmail: (opts: { to: string; downloadUrl: string; expiresAt: Date }) => Promise<boolean>;
  saveReady: (jobId: string, patch: ReadyPatch) => Promise<void>;
  saveFailure: (jobId: string, status: DataExportStatus, error: string) => Promise<void>;
};

export function downloadUrlFor(origin: string, token: string): string {
  return `${origin}/api/auth/data-export/download?token=${token}`;
}

/**
 * Runs one claimed job to completion. The file is built and stored first; the
 * job is marked ready before the email goes out, so an unconfigured or failing
 * mailer never loses the export (the person can still fetch it in the app).
 */
export async function processDataExportJob(job: ClaimedJob, deps: ProcessDeps): Promise<DataExportStatus> {
  try {
    const data = await deps.buildExport(job.clerkId, job.categories);
    const exportedAt = deps.now().toISOString();
    const body = Buffer.from(JSON.stringify({ exportedAt, include: job.categories, ...data }, null, 2), "utf8");
    const fileObjectKey = await deps.uploadFile(job.id, body);

    const token = generateDownloadToken();
    const readyAt = deps.now();
    const expiresAt = new Date(readyAt.getTime() + DATA_EXPORT_LINK_TTL_MS);
    const patch: ReadyPatch = {
      status: "ready",
      fileObjectKey,
      readyAt,
      expiresAt,
      downloadTokenHash: hashDownloadToken(token),
      emailedAt: null,
    };
    await deps.saveReady(job.id, patch);

    if (deps.mailerConfigured()) {
      const to = await deps.getEmail(job.clerkId);
      if (to) {
        const sent = await deps.sendEmail({ to, downloadUrl: downloadUrlFor(deps.origin(), token), expiresAt });
        if (sent) {
          await deps.saveReady(job.id, { ...patch, emailedAt: deps.now() });
        } else {
          logger.warn({ job: "dataExport", jobId: job.id }, "Data export ready but email failed; available in-app");
        }
      }
    } else {
      logger.warn({ job: "dataExport", jobId: job.id }, "Data export ready; mailer not configured, available in-app only");
    }
    return "ready";
  } catch (err) {
    const next = statusAfterFailure(job.attempts);
    logger.error({ err, job: "dataExport", jobId: job.id, attempts: job.attempts, next }, "Data export job attempt failed");
    await deps.saveFailure(job.id, next, err instanceof Error ? err.message.slice(0, 500) : "Export failed");
    return next;
  }
}

const storage = new ObjectStorageService();

export const defaultDeps: ProcessDeps = {
  now: () => new Date(),
  origin: () => getWebOrigin(),
  mailerConfigured: isMailerConfigured,
  buildExport: buildAccountDataExport,
  uploadFile: (jobId, contents) =>
    storage.createObjectEntityFromBuffer(contents, "application/json", `/objects/data-exports/${jobId}.json`),
  getEmail: async (clerkId) => {
    const [row] = await db.select({ email: users.email }).from(users).where(eq(users.clerkId, clerkId)).limit(1);
    return row?.email ?? null;
  },
  sendEmail: sendDataExportReadyEmail,
  saveReady: async (jobId, patch) => {
    await db.update(dataExportJobs).set({ ...patch, lastError: null }).where(eq(dataExportJobs.id, jobId));
  },
  saveFailure: async (jobId, status, error) => {
    await db.update(dataExportJobs).set({ status, lastError: error }).where(eq(dataExportJobs.id, jobId));
  },
};

/** Atomically move the oldest queued job to running (safe across instances). */
async function claimNext(now: Date): Promise<ClaimedJob | null> {
  const [candidate] = await db.select({ id: dataExportJobs.id }).from(dataExportJobs)
    .where(eq(dataExportJobs.status, "queued"))
    .orderBy(asc(dataExportJobs.requestedAt))
    .limit(1);
  if (!candidate) return null;
  const [claimed] = await db.update(dataExportJobs)
    .set({ status: "running", startedAt: now, attempts: sql`${dataExportJobs.attempts} + 1` })
    .where(and(eq(dataExportJobs.id, candidate.id), eq(dataExportJobs.status, "queued")))
    .returning();
  if (!claimed) return null;
  return { id: claimed.id, clerkId: claimed.clerkId, categories: claimed.categories ?? [], attempts: claimed.attempts };
}

/** Jobs stuck in `running` (process died mid-build) go back to queued, or fail out. */
async function recoverStale(now: Date): Promise<void> {
  const cutoff = new Date(now.getTime() - DATA_EXPORT_RUNNING_STALE_MS);
  const stale = await db.select().from(dataExportJobs)
    .where(and(eq(dataExportJobs.status, "running"), lt(dataExportJobs.startedAt, cutoff)));
  for (const job of stale) {
    await db.update(dataExportJobs)
      .set({ status: statusAfterFailure(job.attempts), lastError: "Timed out" })
      .where(and(eq(dataExportJobs.id, job.id), eq(dataExportJobs.status, "running")));
  }
}

/** Ready jobs past their 7 days: delete the stored file and drop the token. */
async function expireOld(now: Date): Promise<number> {
  const due = await db.select().from(dataExportJobs)
    .where(and(eq(dataExportJobs.status, "ready"), lt(dataExportJobs.expiresAt, now)));
  for (const job of due) {
    if (job.fileObjectKey) {
      try {
        await storage.deleteObjectEntity(job.fileObjectKey);
      } catch (err) {
        // A missing object is fine; anything else is retried next tick.
        if ((err as Error)?.name !== "ObjectNotFoundError") {
          logger.error({ err, job: "dataExport", jobId: job.id }, "Could not delete expired export file");
          continue;
        }
      }
    }
    await db.update(dataExportJobs)
      .set({ status: "expired", downloadTokenHash: null, fileObjectKey: null })
      .where(and(eq(dataExportJobs.id, job.id), eq(dataExportJobs.status, "ready")));
  }
  return due.length;
}

export async function runDataExportJobs(now = new Date(), deps: ProcessDeps = defaultDeps): Promise<number> {
  await recoverStale(now);
  await expireOld(now);
  let processed = 0;
  for (let i = 0; i < MAX_JOBS_PER_TICK; i++) {
    const job = await claimNext(now);
    if (!job) break;
    await processDataExportJob(job, deps);
    processed++;
  }
  return processed;
}

/** Fire-and-forget nudge so a fresh request does not wait for the next tick. */
export function kickDataExportJobs(): void {
  void runDataExportJobs().catch((err) =>
    logger.error({ err, job: "dataExport" }, "Data export job failed"),
  );
}

export function startDataExportJob(): void {
  setTimeout(() => {
    void runDataExportJobs().catch((err) =>
      logger.error({ err, job: "dataExport" }, "Data export job failed"),
    );
  }, 20_000);
  setInterval(() => {
    void runDataExportJobs().catch((err) =>
      logger.error({ err, job: "dataExport" }, "Data export job failed"),
    );
  }, INTERVAL_MS).unref?.();
  logger.info({ job: "dataExport", intervalMs: INTERVAL_MS }, "Data export job scheduled");
}
