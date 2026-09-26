/**
 * Pure helpers for the LIVE pager — no React Native / Expo imports so they
 * can be unit tested directly.
 */
import type { LiveChatMessage, LiveStream } from './types';

/**
 * Followed creators first, then by viewer count (desc), then earliest
 * started — the same order `GET /api/live/feed` returns, reapplied client
 * side after live viewer-count ticks so the list stays stable while it is
 * not on screen.
 */
export function orderLiveStreams<T extends Pick<LiveStream, 'id' | 'followedByViewer' | 'viewerCount' | 'startedAt'>>(
  streams: readonly T[],
): T[] {
  return [...streams].sort((a, b) =>
    Number(b.followedByViewer) - Number(a.followedByViewer)
    || b.viewerCount - a.viewerCount
    || a.startedAt - b.startedAt
    || a.id.localeCompare(b.id));
}

/**
 * Where the pager should land after the stream at `endedIndex` is removed
 * while the viewer is on `activeIndex`. Removing the active stream advances
 * to what was the next one (which now occupies the same index), or steps
 * back when it was the last page. Removing a stream above the active one
 * shifts the active index up by one so the viewer stays on the same stream.
 */
export function nextIndexAfterRemoval(activeIndex: number, endedIndex: number, lengthBefore: number): number {
  const lengthAfter = lengthBefore - 1;
  if (lengthAfter <= 0) return 0;
  if (endedIndex < activeIndex) return activeIndex - 1;
  if (endedIndex === activeIndex) return Math.min(activeIndex, lengthAfter - 1);
  return activeIndex;
}

/** Index of the stream to open first for a deep link (`streamId` or the
 *  host's `sellerId`), falling back to the top of the list. */
export function initialStreamIndex(
  streams: readonly Pick<LiveStream, 'id' | 'host'>[],
  target: { streamId?: string | null; hostId?: string | null },
): number {
  if (target.streamId) {
    const i = streams.findIndex(s => s.id === target.streamId);
    if (i >= 0) return i;
  }
  if (target.hostId) {
    const i = streams.findIndex(s => s.host.id === target.hostId);
    if (i >= 0) return i;
  }
  return 0;
}

/** The overlay only ever shows the last few messages (fading upward). */
export const LIVE_CHAT_VISIBLE = 5;
/** Keep a small buffer beyond what is visible so a burst doesn't drop
 *  messages mid-fade, without growing without bound. */
export const LIVE_CHAT_BUFFER = 40;

export function appendChat(prev: readonly LiveChatMessage[], incoming: readonly LiveChatMessage[]): LiveChatMessage[] {
  if (incoming.length === 0) return prev as LiveChatMessage[];
  const seen = new Set(prev.map(m => m.id));
  const merged = [...prev, ...incoming.filter(m => !seen.has(m.id))];
  return merged.slice(-LIVE_CHAT_BUFFER);
}

/** Compact viewer count: 987, 1.2K, 12.4K, 1.1M. */
export function formatViewerCount(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0';
  if (n < 1000) return String(Math.round(n));
  if (n < 1_000_000) {
    const k = n / 1000;
    return `${k >= 100 ? Math.round(k) : Math.round(k * 10) / 10}K`;
  }
  const m = n / 1_000_000;
  return `${m >= 100 ? Math.round(m) : Math.round(m * 10) / 10}M`;
}

/** "Today 7:00 PM" / "Tomorrow 11:30 AM" / "Sat 6:00 PM". */
export function formatUpcomingTime(startsAt: number, now: number): string {
  const d = new Date(startsAt);
  const n = new Date(now);
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const dayDiff = Math.round(
    (new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
      - new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime()) / 86_400_000,
  );
  if (dayDiff <= 0) return `Today ${time}`;
  if (dayDiff === 1) return `Tomorrow ${time}`;
  return `${d.toLocaleDateString('en-US', { weekday: 'short' })} ${time}`;
}
