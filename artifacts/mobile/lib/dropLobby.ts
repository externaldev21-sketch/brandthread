/**
 * Pure helpers for the drop lobby (components/products/LaunchCountdown.tsx).
 * No React, no clock reads: every function takes the time it needs.
 */

export function splitCountdown(ms: number): { days: number; hours: number; minutes: number; seconds: number } {
  const total = Math.max(0, Math.floor(ms / 1000));
  return {
    days: Math.floor(total / 86400),
    hours: Math.floor((total % 86400) / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
  };
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * "Starts in 2d 04:12:09" / "Starts in 04:12:09". Seconds round up so the
 * clock reads 00:00:01 for the final second and the drop opens as it would
 * read 00:00:00. `spoken` is the VoiceOver form.
 */
export function countdownText(ms: number, spoken = false): string {
  const t = splitCountdown(Math.ceil(Math.max(0, ms) / 1000) * 1000);
  if (spoken) {
    const parts = [
      t.days ? `${t.days} ${t.days === 1 ? 'day' : 'days'}` : null,
      t.hours ? `${t.hours} ${t.hours === 1 ? 'hour' : 'hours'}` : null,
      `${t.minutes} ${t.minutes === 1 ? 'minute' : 'minutes'}`,
    ].filter(Boolean);
    return `Starts in ${parts.join(' ')}`;
  }
  const clock = `${pad(t.hours)}:${pad(t.minutes)}:${pad(t.seconds)}`;
  return t.days > 0 ? `Starts in ${t.days}d ${clock}` : `Starts in ${clock}`;
}

/** "Available 10/16 at 10:00 AM" in the viewer's own timezone (SNKRS wording). */
export function lobbyDateLabel(iso: string, locale = 'en-US', timeZone?: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString(locale, { month: '2-digit', day: '2-digit', ...(timeZone ? { timeZone } : {}) });
  const time = d.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit', ...(timeZone ? { timeZone } : {}) });
  return `Available ${date} at ${time}`;
}

/** The real count only; nothing at zero (no "be the first" nudge). */
export function notifyCountLabel(count: number): string | null {
  if (!Number.isFinite(count) || count <= 0) return null;
  const n = Math.floor(count);
  return n === 1 ? '1 person has notifications on' : `${n.toLocaleString('en-US')} people have notifications on`;
}

/**
 * Delay until the next whole server second, or until launch if that comes
 * sooner, so the last tick lands on the launch instant. Never below 16ms
 * (one frame) so a tight loop can't spin.
 */
export function msUntilNextTick(serverNowMs: number, launchAtMs: number): number {
  const toSecond = 1000 - (((serverNowMs % 1000) + 1000) % 1000);
  const toLaunch = launchAtMs - serverNowMs;
  return Math.max(16, Math.min(toSecond, toLaunch > 0 ? toLaunch : toSecond));
}
