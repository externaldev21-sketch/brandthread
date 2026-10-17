/**
 * Viewer-side live video connection state for buyer-live.
 *
 * Previously the viewer sat on "Connecting…" forever when the Agora engine
 * failed to start, the join returned no app id, or the host's video never
 * arrived. The screen now tracks an explicit state, gives up after a timeout
 * and offers a retry.
 */
export type LiveVideoState = 'connecting' | 'connected' | 'failed' | 'unsupported';

/** How long the viewer waits for the host's video before showing the error. */
export const LIVE_VIDEO_CONNECT_TIMEOUT_MS = 20_000;

export function liveVideoPlaceholderText(state: LiveVideoState): string {
  switch (state) {
    case 'unsupported':
      return 'Live video works in the Brandthread app.';
    case 'failed':
      return 'Couldn’t connect to the live video. Check your connection and try again.';
    case 'connected':
    case 'connecting':
    default:
      return 'Connecting…';
  }
}

/** Retry is offered only for a real failure (not on web, not while connecting). */
export function canRetryLiveVideo(state: LiveVideoState): boolean {
  return state === 'failed';
}
