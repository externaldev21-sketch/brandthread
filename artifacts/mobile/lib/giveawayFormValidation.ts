/**
 * Client-side checks for the giveaway form (app/seller-giveaway-create.tsx),
 * mirroring the server's limits in api-server lib/giveaways.ts
 * (validateGiveawayInput) so the seller sees the reason before submitting.
 * Pure: no I/O, `now` is injectable for tests.
 */
import type { GiveawayForm } from './giveawayEditForm';

export const GIVEAWAY_LIMITS = {
  title: 80,
  prize: 200,
  rules: 5000,
  eligibility: 300,
  region: 100,
  maxWinners: 50,
  maxDays: 90,
} as const;

const DAY_MS = 86_400_000;

/**
 * The first problem with the form, or null when it can be submitted.
 * `startsAt` is the saved start when editing; a new giveaway starts now.
 * Missing title / prize / rules are reported by the screen's own hint, so
 * they return null here.
 */
export function giveawayFormError(
  form: Pick<GiveawayForm, 'title' | 'prize' | 'winners' | 'days' | 'region' | 'eligibility' | 'rules'>,
  opts: { startsAt?: string | null; now?: number } = {},
): string | null {
  const L = GIVEAWAY_LIMITS;
  if (form.title.trim().length > L.title) return `Title must be ${L.title} characters or fewer.`;
  if (form.prize.trim().length > L.prize) return `Prize must be ${L.prize} characters or fewer.`;
  if (form.region.trim().length > L.region) return `Region must be ${L.region} characters or fewer.`;
  if (form.eligibility.trim().length > L.eligibility) return `Eligibility must be ${L.eligibility} characters or fewer.`;
  if (form.rules.trim().length > L.rules) return `Official rules must be ${L.rules} characters or fewer.`;

  const winners = Number(form.winners);
  if (!Number.isInteger(winners) || winners < 1 || winners > L.maxWinners) {
    return `Pick between 1 and ${L.maxWinners} winners.`;
  }
  const days = Number(form.days);
  if (!Number.isInteger(days) || days < 1 || days > L.maxDays) {
    return `A giveaway can run for 1 to ${L.maxDays} days.`;
  }

  const now = opts.now ?? Date.now();
  const start = opts.startsAt ? new Date(opts.startsAt).getTime() : now;
  if (Number.isNaN(start)) return 'This giveaway has no valid start date.';
  // A new giveaway starts now (never in the past); an edited one keeps its
  // saved start, so only the end is checked against the clock.
  const end = start + days * DAY_MS;
  if (end <= start) return 'The end must be after the start.';
  if (end <= now) return 'The end must be in the future. Pick a longer run.';
  return null;
}
