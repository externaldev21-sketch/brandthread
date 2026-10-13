/**
 * fetch() with a hard ceiling (speed/offline polish #38: no infinite spinners).
 * Shared by lib/api.ts and the services that call the API directly.
 */
import { ApiError } from './networkNotice';

/**
 * Every request gets a hard ceiling so a hung connection (dead server, black
 * hole route, a device that fell asleep mid-request) always resolves into an
 * error a screen can show instead of leaving loading state stuck forever.
 */
export const REQUEST_TIMEOUT_MS = 15_000;

/**
 * File uploads send megabytes over a phone connection, so they get a longer
 * ceiling than an ordinary request — but still a ceiling, so a dead
 * connection fails with "Request timed out" instead of an endless spinner.
 */
export const IMAGE_UPLOAD_TIMEOUT_MS = 120_000;
export const VIDEO_UPLOAD_TIMEOUT_MS = 300_000;
/** Per chunk of a resumable video upload (a retry resumes from that chunk). */
export const UPLOAD_CHUNK_TIMEOUT_MS = 120_000;

export function timeoutError(): ApiError {
  return new ApiError(408, JSON.stringify({ error: { message: 'Request timed out. Please try again.', code: 'timeout' } }));
}

/**
 * fetch() with a hard timeout. Expo/RN's fetch never rejects or resolves on
 * its own if the connection just hangs — AbortController is the only way to
 * bound it. A timeout surfaces as ApiError(408) so it flows through the same
 * classification/retry path as a real server timeout.
 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number = REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  // A caller's own signal (e.g. a screen cancelling on unmount) still works.
  const callerSignal = init.signal;
  const onCallerAbort = () => controller.abort();
  if (callerSignal) {
    if (callerSignal.aborted) controller.abort();
    else callerSignal.addEventListener('abort', onCallerAbort);
  }
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (timedOut || (!callerSignal?.aborted && error instanceof Error && error.name === 'AbortError')) {
      throw timeoutError();
    }
    throw error;
  } finally {
    callerSignal?.removeEventListener('abort', onCallerAbort);
    clearTimeout(timer);
  }
}
