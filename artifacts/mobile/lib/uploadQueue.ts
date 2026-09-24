/**
 * Brandthread — Generic Upload Progress / Retry State Machine
 *
 * Framework-agnostic (no RN imports) so it can run in a plain uploader
 * (e.g. product photos, video posts) and be unit tested in isolation.
 *
 * Model: each tracked item moves through
 *   pending -> uploading -> done
 *                        \-> error -> uploading (retry) -> ...
 *
 * `UploadQueue` drives real uploads with bounded concurrency, exponential
 * backoff on retry, and progress callbacks. The pure `uploadReducer` is
 * exported separately so state transitions can be tested without any
 * async/timer plumbing.
 */

export type UploadStatus = 'pending' | 'uploading' | 'done' | 'error';

export interface UploadItemState<TResult = unknown> {
  id: string;
  status: UploadStatus;
  progress: number;      // 0–100
  attempts: number;      // number of upload attempts made so far
  result?: TResult;
  error?: string;
}

export type UploadEvent<TResult = unknown> =
  | { type: 'start'; id: string }
  | { type: 'progress'; id: string; progress: number }
  | { type: 'success'; id: string; result: TResult }
  | { type: 'failure'; id: string; error: string }
  | { type: 'reset'; id: string }
  | { type: 'remove'; id: string };

export function createUploadItem<TResult = unknown>(id: string): UploadItemState<TResult> {
  return { id, status: 'pending', progress: 0, attempts: 0 };
}

/** Pure reducer over a map of upload items — no side effects, fully testable. */
export function uploadReducer<TResult = unknown>(
  state: Record<string, UploadItemState<TResult>>,
  event: UploadEvent<TResult>,
): Record<string, UploadItemState<TResult>> {
  const existing = state[event.id] ?? createUploadItem<TResult>(event.id);

  switch (event.type) {
    case 'start':
      return {
        ...state,
        [event.id]: { ...existing, status: 'uploading', progress: 0, error: undefined, attempts: existing.attempts + 1 },
      };
    case 'progress':
      return {
        ...state,
        [event.id]: { ...existing, status: 'uploading', progress: Math.max(0, Math.min(100, event.progress)) },
      };
    case 'success':
      return {
        ...state,
        [event.id]: { ...existing, status: 'done', progress: 100, result: event.result, error: undefined },
      };
    case 'failure':
      return {
        ...state,
        [event.id]: { ...existing, status: 'error', error: event.error },
      };
    case 'reset':
      return { ...state, [event.id]: createUploadItem<TResult>(event.id) };
    case 'remove': {
      const next = { ...state };
      delete next[event.id];
      return next;
    }
    default:
      return state;
  }
}

export function isUploading(state: Record<string, UploadItemState<any>>): boolean {
  return Object.values(state).some(item => item.status === 'uploading' || item.status === 'pending');
}

export function hasErrors(state: Record<string, UploadItemState<any>>): boolean {
  return Object.values(state).some(item => item.status === 'error');
}

export function allDone(state: Record<string, UploadItemState<any>>): boolean {
  const items = Object.values(state);
  return items.length > 0 && items.every(item => item.status === 'done');
}

// ─── Retry / backoff helpers ───────────────────────────────────────────────

export const DEFAULT_MAX_ATTEMPTS = 3;

/** Exponential backoff in ms: 500, 1000, 2000, capped at 8000. */
export function backoffDelayMs(attempt: number): number {
  return Math.min(500 * Math.pow(2, Math.max(0, attempt - 1)), 8000);
}

export function shouldRetry(item: UploadItemState<any>, maxAttempts = DEFAULT_MAX_ATTEMPTS): boolean {
  return item.status === 'error' && item.attempts < maxAttempts;
}

// ─── Async runner ────────────────────────────────────────────────────────

export interface RunUploadOptions<TResult> {
  id: string;
  upload: (onProgress: (pct: number) => void) => Promise<TResult>;
  onEvent: (event: UploadEvent<TResult>) => void;
  maxAttempts?: number;
}

/**
 * Drives a single upload through the state machine, retrying automatically
 * up to `maxAttempts` with exponential backoff. Emits events via `onEvent`
 * so a component (or a persisted queue) can render + record progress.
 */
export async function runUploadWithRetry<TResult>({
  id, upload, onEvent, maxAttempts = DEFAULT_MAX_ATTEMPTS,
}: RunUploadOptions<TResult>): Promise<TResult | null> {
  let attempt = 0;
  for (;;) {
    attempt += 1;
    onEvent({ type: 'start', id });
    try {
      const result = await upload(pct => onEvent({ type: 'progress', id, progress: pct }));
      onEvent({ type: 'success', id, result });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upload failed';
      onEvent({ type: 'failure', id, error: message });
      if (attempt >= maxAttempts) return null;
      await new Promise(resolve => setTimeout(resolve, backoffDelayMs(attempt)));
    }
  }
}
