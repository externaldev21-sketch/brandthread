/**
 * Pure helpers for the seller's drop waitlist screen (app/drop-waitlist.tsx)
 * and the countdown Story card. The public page lives at
 * https://brandthread.app/@handle/drop (rendered by server/dropWaitlistPage.js).
 */
import type { DropSmsBlastPreview } from '@/lib/api';
import { BRANDTHREAD_ORIGIN } from '@/lib/shareProfile';

export function buildDropWaitlistUrl(handle: string | null | undefined): string | null {
  if (!handle || !/^[A-Za-z0-9_]{3,30}$/.test(handle)) return null;
  return `${BRANDTHREAD_ORIGIN}/@${handle}/drop`;
}

/** The URL without the scheme, as printed on the Story card. */
export function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//, '');
}

/** "Drops in 2d 4h" / "Drops in 3h 12m" / "Drops in 9m" / "Live now". */
export function dropCountdownLabel(releaseAt: string | null | undefined, now = Date.now()): string | null {
  if (!releaseAt) return null;
  const at = Date.parse(releaseAt);
  if (Number.isNaN(at)) return null;
  const ms = at - now;
  if (ms <= 0) return 'Live now';
  const totalMinutes = Math.ceil(ms / 60_000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `Drops in ${days}d ${hours}h`;
  if (hours > 0) return `Drops in ${hours}h ${minutes}m`;
  return `Drops in ${minutes}m`;
}

/** "Sat, Oct 18 · 7:00 PM EDT" in the seller's launch timezone. */
export function dropLaunchLabel(releaseAt: string | null | undefined, timeZone?: string | null): string | null {
  if (!releaseAt) return null;
  const date = new Date(releaseAt);
  if (Number.isNaN(date.getTime())) return null;
  const format = (tz: string) => {
    const day = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: tz }).format(date);
    const time = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short', timeZone: tz }).format(date);
    return `${day} · ${time}`;
  };
  try {
    return format(timeZone || 'UTC');
  } catch {
    return format('UTC');
  }
}

/**
 * Why the one-tap text blast can't be sent right now, in plain language, or
 * null when it can. An already-sent blast is shown as its result instead.
 */
export function smsBlastBlockReason(preview: Pick<DropSmsBlastPreview, 'smsConfigured' | 'dropLive' | 'waitlistCount' | 'blast' | 'drop'>): string | null {
  if (preview.blast) return null;
  if (!preview.smsConfigured) return 'Texting isn’t set up on Brandthread yet. Signups are still being collected.';
  if (!preview.dropLive) {
    return preview.drop.status === 'active'
      ? 'You can text the waitlist once the drop is live.'
      : 'Only a live drop can be texted.';
  }
  if (preview.waitlistCount === 0) return 'No one is on the waitlist yet.';
  return null;
}

export function peopleLabel(count: number): string {
  return `${count.toLocaleString('en-US')} ${count === 1 ? 'person' : 'people'}`;
}
