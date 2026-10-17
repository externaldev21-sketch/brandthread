/** Real first-frame events only. Bounded development diagnostics, no production
 * analytics or network writes. Warm surfaces can legitimately report 0 ms. */
import { PERF_MARKS } from './buildFlags';
type Sample = { postId: string; activationToFirstFrameMs: number };
type Token = { postId: string; started: number; complete: boolean };
const now = () => performance.now();
export function beginFeedVideoTiming(postId: string): Token {
  return { postId, started: now(), complete: false };
}
export function completeFeedVideoTiming(token: Token): Sample | null {
  if (token.complete) return null;
  token.complete = true;
  const sample = { postId: token.postId, activationToFirstFrameMs: Math.max(0, now() - token.started) };
  if (PERF_MARKS) {
    const root = globalThis as typeof globalThis & { __brandthreadFeedVideoTiming?: Sample[] };
    const samples = root.__brandthreadFeedVideoTiming ??= [];
    samples.push(sample);
    if (samples.length > 60) samples.shift();
    console.info("[Feed video TTFF]", JSON.stringify(sample));
  }
  return sample;
}
