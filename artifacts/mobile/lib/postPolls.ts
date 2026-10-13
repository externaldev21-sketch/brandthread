/**
 * Thread polls — client rules and copy (X/Twitter poll pattern; the server
 * enforces the same limits in api-server lib/postPolls.ts).
 */

export const POLL_MIN_OPTIONS = 2;
export const POLL_MAX_OPTIONS = 4;
export const POLL_OPTION_MAX = 25;
export const POLL_MIN_MINUTES = 5;
export const POLL_MAX_DAYS = 7;
export const POLL_DEFAULT_MINUTES = 24 * 60;

export interface PollDraft {
  options: string[];
  durationMinutes: number;
}

export function emptyPollDraft(): PollDraft {
  return { options: ['', ''], durationMinutes: POLL_DEFAULT_MINUTES };
}

/** The draft as the server will store it, or null while it isn't postable yet. */
export function cleanPollDraft(draft: PollDraft | null | undefined): PollDraft | null {
  if (!draft) return null;
  const options = draft.options.map((o) => o.replace(/\s+/g, ' ').trim());
  if (options.length < POLL_MIN_OPTIONS || options.length > POLL_MAX_OPTIONS) return null;
  if (options.some((o) => !o || [...o].length > POLL_OPTION_MAX)) return null;
  const minutes = clampPollMinutes(draft.durationMinutes);
  return { options, durationMinutes: minutes };
}

export function clampPollMinutes(minutes: number): number {
  if (!Number.isFinite(minutes)) return POLL_DEFAULT_MINUTES;
  return Math.max(POLL_MIN_MINUTES, Math.min(POLL_MAX_DAYS * 24 * 60, Math.round(minutes)));
}

/** Days / hours / minutes parts of a poll length. */
export function splitMinutes(minutes: number): { days: number; hours: number; minutes: number } {
  const m = Math.max(0, Math.round(minutes));
  return { days: Math.floor(m / 1440), hours: Math.floor((m % 1440) / 60), minutes: m % 60 };
}

/** Builds a poll length from picker columns. X: 7 days is the maximum (hours/minutes reset to 0). */
export function joinMinutes(days: number, hours: number, minutes: number): number {
  if (days >= POLL_MAX_DAYS) return POLL_MAX_DAYS * 1440;
  return clampPollMinutes(days * 1440 + hours * 60 + minutes);
}

const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`;

/** "1 day", "2 days 3 hours", "45 minutes" — the composer's Poll length value. */
export function formatPollLength(minutes: number): string {
  const p = splitMinutes(minutes);
  const parts: string[] = [];
  if (p.days) parts.push(plural(p.days, 'day'));
  if (p.hours) parts.push(plural(p.hours, 'hour'));
  if (p.minutes) parts.push(plural(p.minutes, 'minute'));
  return parts.join(' ') || plural(0, 'minute');
}

/** X's footer copy: "1 day 23 hours left", "5 minutes left", "Final results". */
export function formatTimeLeft(endsAt: string | null, now: number = Date.now()): string {
  if (!endsAt) return '';
  const ms = new Date(endsAt).getTime() - now;
  if (ms <= 0) return 'Final results';
  const totalMinutes = Math.ceil(ms / 60_000);
  const p = splitMinutes(totalMinutes);
  if (p.days) return `${plural(p.days, 'day')}${p.hours ? ` ${plural(p.hours, 'hour')}` : ''} left`;
  if (p.hours) return `${plural(p.hours, 'hour')} left`;
  return `${plural(Math.max(1, p.minutes), 'minute')} left`;
}

export function formatVotes(total: number): string {
  return `${total.toLocaleString('en-US')} ${total === 1 ? 'vote' : 'votes'}`;
}
