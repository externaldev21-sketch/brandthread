/**
 * Turns one stretch of a feed video being the active page into For You
 * ranking signals (POST /api/feed/events via feedEventsService):
 *  - `watch_time` with the completion fraction (0..1; 1 once the clip looped)
 *  - `rewatch` when the clip played past its end and started again
 *  - `skip` when the viewer moved on after barely any playback
 * Only real, advancing playback counts: seeks and paused time don't.
 */
export type WatchSignal =
  | { type: 'watch_time'; value: string }
  | { type: 'rewatch' }
  | { type: 'skip' };

/** Less than this much actual playback, with little of the clip seen, is a skip. */
export const SKIP_MAX_PLAYED_SECONDS = 1.5;
export const SKIP_MAX_COMPLETION = 0.2;

export function createWatchSession() {
  let previous: number | null = null;
  let played = 0;
  let maxFraction = 0;
  let looped = false;

  return {
    /** Feed every `timeUpdate` tick while the page is active. */
    onTime(currentTime: number, duration: number, playing: boolean): void {
      if (!Number.isFinite(currentTime)) return;
      if (playing && previous != null) {
        if (currentTime >= previous) {
          const delta = currentTime - previous;
          if (delta <= 1.5) played += delta; // larger jumps are seeks
        } else if (duration > 0 && previous >= duration * 0.75 && currentTime <= duration * 0.25) {
          looped = true; // wrapped from near the end back to the start
          played += Math.max(0, duration - previous) + currentTime;
        }
      }
      previous = currentTime;
      if (playing && duration > 0) maxFraction = Math.max(maxFraction, Math.min(1, currentTime / duration));
    },
    /** Signals for the session that just ended (empty when nothing played or loaded). */
    finish(): WatchSignal[] {
      const completion = looped ? 1 : maxFraction;
      if (previous == null) return [];
      if (played < SKIP_MAX_PLAYED_SECONDS && completion < SKIP_MAX_COMPLETION) return [{ type: 'skip' }];
      const signals: WatchSignal[] = [{ type: 'watch_time', value: completion.toFixed(2) }];
      if (looped) signals.push({ type: 'rewatch' });
      return signals;
    },
  };
}
