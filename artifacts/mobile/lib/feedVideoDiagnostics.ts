import { PERF_MARKS } from './buildFlags';

type PlaybackFailure = { postId: string; source: string | null; message: string; at: number };
export function recordFeedVideoError(postId: string, source: string | null, message: string) {
  // AVPlayer errors can include bearer-signed query strings: never retain them.
  const sanitize = (text: string) => text.replace(/https?:\/\/[^\s"'<>]+/g, uri => {
    try { const u = new URL(uri); return `${u.origin}${u.pathname}`; } catch { return '[media URL]'; }
  }).slice(0, 1000);
  const failure: PlaybackFailure = { postId, source: source ? sanitize(source) : null, message: sanitize(message), at: performance.now() };
  console.warn('[Feed video playback error]', failure);
  if (PERF_MARKS) {
    const root = globalThis as typeof globalThis & { __brandthreadFeedVideoErrors?: PlaybackFailure[] };
    const errors = root.__brandthreadFeedVideoErrors ??= [];
    errors.push(failure);
    if (errors.length > 60) errors.shift();
  }
}
