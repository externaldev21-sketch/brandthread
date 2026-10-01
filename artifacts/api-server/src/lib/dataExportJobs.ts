import crypto from "node:crypto";

/** Download links and the stored file live for 7 days after the export is ready. */
export const DATA_EXPORT_LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** One request per account per 24 hours (failed jobs do not count). */
export const DATA_EXPORT_RATE_WINDOW_MS = 24 * 60 * 60 * 1000;
export const DATA_EXPORT_MAX_ATTEMPTS = 3;
/** A job stuck in `running` longer than this is considered abandoned. */
export const DATA_EXPORT_RUNNING_STALE_MS = 15 * 60 * 1000;

export type DataExportStatus = "queued" | "running" | "ready" | "failed" | "expired";

const TRANSITIONS: Record<DataExportStatus, DataExportStatus[]> = {
  queued: ["running", "failed"],
  running: ["ready", "failed", "queued"], // queued = retry after a failed attempt
  ready: ["expired"],
  failed: [],
  expired: [],
};

export function canTransition(from: DataExportStatus, to: DataExportStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

/** After a failed attempt: retry (back to queued) until attempts run out. */
export function statusAfterFailure(attempts: number): DataExportStatus {
  return attempts >= DATA_EXPORT_MAX_ATTEMPTS ? "failed" : "queued";
}

export function generateDownloadToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function hashDownloadToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function isValidTokenShape(token: unknown): token is string {
  return typeof token === "string" && /^[0-9a-f]{64}$/.test(token);
}

/** True when a ready job's link/file can still be used at `now`. */
export function isDownloadable(
  job: { status: string; expiresAt: Date | string | null },
  now: Date = new Date(),
): boolean {
  if (job.status !== "ready" || !job.expiresAt) return false;
  return new Date(job.expiresAt).getTime() > now.getTime();
}

/** When the next request is allowed, or null if one can be made now. */
export function nextExportRequestAt(
  lastRequestedAt: Date | string | null | undefined,
  now: Date = new Date(),
): Date | null {
  if (!lastRequestedAt) return null;
  const next = new Date(new Date(lastRequestedAt).getTime() + DATA_EXPORT_RATE_WINDOW_MS);
  return next.getTime() > now.getTime() ? next : null;
}
