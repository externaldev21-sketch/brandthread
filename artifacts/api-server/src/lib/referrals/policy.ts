/**
 * Referral program policy: "Give $10, get $10" in Thread Cash.
 *
 * Timing (the ONE wording every surface must use):
 *   - Your friend gets $10 Thread Cash when they join with your link or code.
 *   - You get $10 Thread Cash when your friend completes their first order of
 *     $10 or more.
 *   - You still earn 500 loyalty points when your friend joins (unchanged).
 *
 * This file is pure (no DB) so the rules can be unit tested.
 */
import { randomInt } from "node:crypto";

/** All amounts are integer cents. */
export const REFERRAL_INVITEE_REWARD_CENTS = 1000;
export const REFERRAL_INVITER_REWARD_CENTS = 1000;
/** Loyalty points the inviter earns on join — pre-existing behaviour, unchanged. */
export const REFERRAL_JOIN_POINTS = 500;
/** The invitee's first order must be at least this much in real money (Thread Cash applied does not count) before the inviter is paid. */
export const REFERRAL_MIN_ORDER_CENTS = 1000;
/** An inviter is paid for at most this many qualified friends. */
export const REFERRAL_MAX_PAID_PER_INVITER = 50;

export type ReferralStatus = "pending" | "qualified" | "rewarded" | "capped";

// Unambiguous characters only — avoids 0/O, 1/I/L confusion.
export const INVITE_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
export const INVITE_CODE_LENGTH = 6;

/** Cryptographically secure invite code (existing Math.random codes stay valid). */
export function generateInviteCode(len = INVITE_CODE_LENGTH): string {
  return Array.from({ length: len }, () =>
    INVITE_CODE_ALPHABET[randomInt(INVITE_CODE_ALPHABET.length)],
  ).join("");
}

export function normalizeInviteCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.trim().toUpperCase();
  return /^[A-Z0-9]{4,12}$/.test(code) ? code : null;
}

export function inviteLink(code: string): string {
  return `https://brandthread.app/invite/${code}`;
}

/** Idempotency keys for the two cash credits of one referral (keyed by invitee). */
export function referralIdempotencyKey(inviteeId: string, role: "inviter" | "invitee"): string {
  return `referral:${inviteeId}:${role}`;
}

/** Canonical email so `a.b+x@gmail.com` and `ab@gmail.com` compare equal. */
export function canonicalEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const [rawLocal, rawDomain] = email.trim().toLowerCase().split("@");
  if (!rawLocal || !rawDomain) return null;
  let local = rawLocal.split("+")[0];
  let domain = rawDomain;
  if (domain === "googlemail.com") domain = "gmail.com";
  if (domain === "gmail.com") local = local.replace(/\./g, "");
  return local ? `${local}@${domain}` : null;
}

export type QualificationInput = {
  referral: { status: string; inviterId: string; inviteeId: string; joinedAt: Date };
  /** `paidCents` is what the buyer paid with real money: total minus any Thread Cash applied. */
  order: { buyerId: string | null; status: string; paidCents: number; createdAt: Date };
  inviterEmail: string | null;
  inviteeEmail: string | null;
  inviterRewardedCount: number;
};

export type QualificationDecision =
  | { action: "skip"; reason: string }
  | { action: "cap" }
  | { action: "reward"; amountCents: number };

export function decideQualification(input: QualificationInput): QualificationDecision {
  const { referral, order } = input;
  if (referral.status !== "pending") return { action: "skip", reason: "already_qualified" };
  if (!order.buyerId || order.buyerId !== referral.inviteeId) return { action: "skip", reason: "not_invitee_order" };
  if (referral.inviterId === referral.inviteeId) return { action: "skip", reason: "self_referral" };
  const a = canonicalEmail(input.inviterEmail);
  const b = canonicalEmail(input.inviteeEmail);
  if (a && b && a === b) return { action: "skip", reason: "same_person" };
  if (order.status === "refund_pending" || order.status === "cancelled" || order.status === "refunded") {
    return { action: "skip", reason: "order_not_paid" };
  }
  if (order.paidCents < REFERRAL_MIN_ORDER_CENTS) return { action: "skip", reason: "below_minimum" };
  if (order.createdAt.getTime() < referral.joinedAt.getTime()) return { action: "skip", reason: "order_before_join" };
  if (input.inviterRewardedCount >= REFERRAL_MAX_PAID_PER_INVITER) return { action: "cap" };
  return { action: "reward", amountCents: REFERRAL_INVITER_REWARD_CENTS };
}

/** Whole-dollar friendly money string for copy (integer cents in, "$10" out). */
export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}
