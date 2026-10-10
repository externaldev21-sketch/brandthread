/**
 * "Pause for a month" — a retention offer shown before cancelling (the
 * cancel sheet in Plan & billing). Stripe subscriptions only: App Store and
 * Google Play subscriptions are managed in the store.
 *
 * While paused, Stripe skips the invoices (pause_collection: void) and the
 * store is put on vacation mode until the pause ends, so buyers see "Back on
 * <date>" instead of a store that can't ship. One pause per 180 days, 30 days
 * long; it ends early with "Resume now".
 */
import type Stripe from "stripe";

export const PAUSE_DAYS = 30;
export const PAUSE_COOLDOWN_DAYS = 180;
const DAY_MS = 86_400_000;

export type PauseState =
  | { paused: true; resumesAt: Date }
  | { paused: false; canPause: boolean; nextPauseAt: Date | null };

/** Pure: is the subscription paused, and may it be paused now? */
export function pauseState(sub: Pick<Stripe.Subscription, "status" | "pause_collection" | "metadata">, now: Date): PauseState {
  const resumes = sub.pause_collection?.resumes_at;
  if (sub.pause_collection && resumes && resumes * 1000 > now.getTime()) {
    return { paused: true, resumesAt: new Date(resumes * 1000) };
  }
  const last = Number(sub.metadata?.lastPausedAt ?? 0);
  const next = last ? new Date(last + PAUSE_COOLDOWN_DAYS * DAY_MS) : null;
  const active = sub.status === "active";
  return { paused: false, canPause: active && (!next || next.getTime() <= now.getTime()), nextPauseAt: next && next.getTime() > now.getTime() ? next : null };
}

export function pauseEnd(now: Date): Date {
  return new Date(now.getTime() + PAUSE_DAYS * DAY_MS);
}

export function vacationMessage(resumesAt: Date): string {
  return `We're taking a short break. Back on ${resumesAt.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}.`;
}
