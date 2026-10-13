/**
 * Small pure formatters for Discover's tiles and rows (video duration,
 * People mutuals line, Drops countdown + date). No react-native imports,
 * so they are unit-testable (tests/discover-format.test.ts).
 */

/** "0:42", "3:05", "1:02:09" — or null when the length isn't known. */
export function formatVideoDuration(seconds?: number | null): string | null {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return null;
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/**
 * The People row's mutuals line — only when the suggestion is backed by real
 * mutual follows (the API's `mutualCount`, or its own "Followed by …"
 * reason). Generic reasons ("Suggested for you", "New on Brandthread")
 * return null so the row omits the line.
 */
export function mutualsLine(person: { reason?: string | null; mutualCount?: number | null }): string | null {
  const reason = (person.reason ?? '').trim();
  const isMutualReason = /^followed by\b/i.test(reason);
  if (isMutualReason) return reason;
  if (typeof person.mutualCount === 'number' && person.mutualCount > 0) {
    return `${person.mutualCount} mutual${person.mutualCount === 1 ? '' : 's'}`;
  }
  return null;
}

/**
 * Countdown to a future release: "2d 04h 09m", "04h 09m", "09m". Null once
 * the time has passed or when there is no date.
 */
export function formatDropCountdown(iso?: string | null, now = Date.now()): string | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - now;
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const totalMin = Math.max(1, Math.floor(ms / 60_000));
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  const hh = String(h).padStart(2, '0');
  const mm = String(m).padStart(2, '0');
  if (d > 0) return `${d}d ${hh}h ${mm}m`;
  if (h > 0) return `${hh}h ${mm}m`;
  return `${mm}m`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Sep 21 · 16:30" in the device's local time — numerals only, so they line up in tabular figures. */
export function formatDropDate(iso?: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${MONTHS[d.getMonth()]} ${String(d.getDate()).padStart(2, '0')} · ${hh}:${mm}`;
}
