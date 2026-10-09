/**
 * Shared upload policy for every upload point (lib/api.ts `sendUploadBody`).
 *
 * Files up to SINGLE_SHOT_MAX_BYTES go up in one request, retried with
 * backoff on network errors and transient server errors. Anything larger goes
 * through a resumable chunked session (POST /api/upload-sessions, chunks with
 * per-chunk retry; see lib/createPost/chunkedUpload.ts and the API's
 * lib/uploadSessions.ts) and is then handed to the same route with an
 * `X-Upload-Id` header, so every route keeps its own validation.
 *
 * The session id is persisted (AsyncStorage) under a key derived from the
 * file, so retrying the same file after a failure, a background kill or an
 * app restart asks the server which chunks it already has and sends only the
 * rest. Uploads do not continue while the app is suspended by the OS.
 *
 * Pure and transport-free so it is unit tested without RN.
 */
import { UploadAbortedError } from '@/lib/createPost/chunkedUpload';

/** Above this, an upload uses a resumable chunked session. */
export const SINGLE_SHOT_MAX_BYTES = 5 * 1024 * 1024;

export type UploadStrategy = 'single' | 'session';

export function uploadStrategy(size: number): UploadStrategy {
  return Number.isFinite(size) && size > SINGLE_SHOT_MAX_BYTES ? 'session' : 'single';
}

const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

/** Network failures (no status) and transient server answers are worth another try. */
export function isRetryableUploadError(error: unknown): boolean {
  if (!error || typeof error !== 'object' || error instanceof UploadAbortedError) return false;
  const status = (error as { status?: unknown }).status;
  if (status === undefined || status === 0) return true;
  return typeof status === 'number' && RETRYABLE_STATUSES.has(status);
}

/** 800ms, 1.6s, 3.2s … capped at 8s. */
export function uploadBackoffMs(attempt: number): number {
  return Math.min(800 * 2 ** Math.max(0, attempt), 8000);
}

export async function withUploadRetry<T>(
  run: (attempt: number) => Promise<T>,
  {
    retries = 2,
    backoffMs = uploadBackoffMs,
    sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  }: { retries?: number; backoffMs?: (attempt: number) => number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await run(attempt);
    } catch (error) {
      if (attempt >= retries || !isRetryableUploadError(error)) throw error;
      await sleep(backoffMs(attempt));
    }
  }
}

/** Stable per-file key so a retry of the same file resumes its session. */
export function uploadResumeKey(path: string, uri: string, size: number, contentType: string): string {
  return `session|${path.split('?')[0]}|${uri}|${size}|${contentType}`;
}

/** Progress for the session path: chunks are 0–97%, the hand-off request the rest. */
export function sessionProgress(chunkFraction: number): number {
  const f = Number.isFinite(chunkFraction) ? Math.min(1, Math.max(0, chunkFraction)) : 0;
  return f * 0.97;
}
