import { createHash } from "node:crypto";
import { and, eq, lt, or } from "drizzle-orm";
import { db, onboardingAiSampleClaims } from "@workspace/db";

/**
 * The free onboarding AI logo sample is limited to one per *person/device*,
 * not just one per account: a fresh sign-up on the same phone or with the
 * same inbox must not get another generation. Three kinds of claim keys are
 * taken alongside the per-account reservation in routes/logo.ts:
 *
 *  - email:  the account's normalized email (plus-tags and Gmail dots removed)
 *  - device: the install id the app keeps in the Keychain/Keystore
 *  - ip:     one of IP_SLOTS_PER_DAY slots for the caller's IP per UTC day,
 *            so a script rotating emails and device ids still hits a ceiling
 *
 * Keys are stored hashed. A key held by another account (completed, or a
 * reservation still inside its lease) blocks the request.
 */

export const IP_SLOTS_PER_DAY = 3;

export type ClaimKind = "email" | "device" | "ip";
export interface ClaimKey { kind: ClaimKind; key: string }

const GMAIL_DOMAINS = new Set(["gmail.com", "googlemail.com"]);

export function normalizeEmailForClaim(email: string | null | undefined): string | null {
  if (!email || typeof email !== "string") return null;
  const trimmed = email.trim().toLowerCase();
  const at = trimmed.lastIndexOf("@");
  if (at <= 0 || at === trimmed.length - 1) return null;
  let local = trimmed.slice(0, at);
  let domain = trimmed.slice(at + 1);
  const plus = local.indexOf("+");
  if (plus >= 0) local = local.slice(0, plus);
  if (GMAIL_DOMAINS.has(domain)) {
    local = local.replace(/\./g, "");
    domain = "gmail.com";
  }
  if (!local) return null;
  return `${local}@${domain}`;
}

/** Install ids are random UUID-ish strings; anything else is ignored. */
export function normalizeDeviceId(deviceId: unknown): string | null {
  if (typeof deviceId !== "string") return null;
  const trimmed = deviceId.trim().toLowerCase();
  if (!/^[a-z0-9-]{16,128}$/.test(trimmed)) return null;
  return trimmed;
}

export function hashClaim(kind: ClaimKind, value: string): string {
  return `${kind}:${createHash("sha256").update(`bt-onboarding-sample:${kind}:${value}`).digest("hex")}`;
}

function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export function ipSlotKeys(ip: string | null | undefined, now: Date): string[] {
  if (!ip || ip === "unknown") return [];
  const base = hashClaim("ip", ip);
  const day = utcDay(now);
  return Array.from({ length: IP_SLOTS_PER_DAY }, (_, slot) => `${base}:${day}:${slot}`);
}

/** The unique (non-IP) person keys for a request. */
export function personClaimKeys(input: { email?: string | null; deviceId?: unknown }): ClaimKey[] {
  const keys: ClaimKey[] = [];
  const email = normalizeEmailForClaim(input.email);
  if (email) keys.push({ kind: "email", key: hashClaim("email", email) });
  const device = normalizeDeviceId(input.deviceId);
  if (device) keys.push({ kind: "device", key: hashClaim("device", device) });
  return keys;
}

export class OnboardingSampleClaimedError extends Error {
  code = "onboarding_sample_used" as const;
  constructor(public kind: ClaimKind) {
    super(
      kind === "ip"
        ? "Free samples from this network are used up for today."
        : "The free sample has already been used on this device or email.",
    );
  }
}

export interface ClaimRow {
  claimKey: string;
  kind: ClaimKind;
  accountId: string;
  reservationId: string;
  reservedAt: Date;
}

/**
 * Storage for claim keys. `take` succeeds when the key is new, is a
 * reservation of the same account, or is an abandoned reservation older than
 * `leaseCutoff`; it returns false when another account holds it.
 */
export interface ClaimStore {
  take(row: ClaimRow, leaseCutoff: Date): Promise<boolean>;
  release(reservationId: string): Promise<void>;
  complete(reservationId: string): Promise<void>;
}

export const dbClaimStore: ClaimStore = {
  async take(row, leaseCutoff) {
    const rows = await db
      .insert(onboardingAiSampleClaims)
      .values({ ...row, status: "reserved" })
      .onConflictDoUpdate({
        target: onboardingAiSampleClaims.claimKey,
        set: { accountId: row.accountId, reservationId: row.reservationId, status: "reserved", reservedAt: row.reservedAt, completedAt: null },
        where: or(
          and(eq(onboardingAiSampleClaims.accountId, row.accountId), eq(onboardingAiSampleClaims.status, "reserved")),
          and(eq(onboardingAiSampleClaims.status, "reserved"), lt(onboardingAiSampleClaims.reservedAt, leaseCutoff)),
        ),
      })
      .returning({ claimKey: onboardingAiSampleClaims.claimKey });
    return rows.length === 1;
  },
  async release(reservationId) {
    await db.delete(onboardingAiSampleClaims).where(and(
      eq(onboardingAiSampleClaims.reservationId, reservationId),
      eq(onboardingAiSampleClaims.status, "reserved"),
    ));
  },
  async complete(reservationId) {
    await db.update(onboardingAiSampleClaims)
      .set({ status: "completed", completedAt: new Date() })
      .where(and(
        eq(onboardingAiSampleClaims.reservationId, reservationId),
        eq(onboardingAiSampleClaims.status, "reserved"),
      ));
  },
};

/**
 * Take every person key plus one free IP slot. On any conflict the claims
 * already taken for this reservation are released and an
 * OnboardingSampleClaimedError is thrown.
 */
export async function claimOnboardingSampleKeys(args: {
  accountId: string;
  reservationId: string;
  email?: string | null;
  deviceId?: unknown;
  ip?: string | null;
  leaseMs: number;
  now?: Date;
  store?: ClaimStore;
}): Promise<void> {
  const store = args.store ?? dbClaimStore;
  const now = args.now ?? new Date();
  const leaseCutoff = new Date(now.getTime() - args.leaseMs);
  const take = (claimKey: string, kind: ClaimKind) => store.take(
    { claimKey, kind, accountId: args.accountId, reservationId: args.reservationId, reservedAt: now },
    leaseCutoff,
  );
  try {
    for (const { kind, key } of personClaimKeys(args)) {
      if (!(await take(key, kind))) throw new OnboardingSampleClaimedError(kind);
    }
    const slots = ipSlotKeys(args.ip, now);
    if (slots.length > 0) {
      let gotSlot = false;
      for (const slot of slots) {
        if (await take(slot, "ip")) { gotSlot = true; break; }
      }
      if (!gotSlot) throw new OnboardingSampleClaimedError("ip");
    }
  } catch (error) {
    await store.release(args.reservationId).catch(() => {});
    throw error;
  }
}

export function releaseOnboardingSampleKeys(reservationId: string, store: ClaimStore = dbClaimStore): Promise<void> {
  return store.release(reservationId);
}

export function completeOnboardingSampleKeys(reservationId: string, store: ClaimStore = dbClaimStore): Promise<void> {
  return store.complete(reservationId);
}
