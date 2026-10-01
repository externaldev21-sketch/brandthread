import { timingSafeEqual } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db, adminInviteCodes, adminInviteCodeUses, users } from "@workspace/db";

export const INVITE_ONLY_FLAG = "inviteOnlySignup";

type Reader = Pick<typeof db, "select" | "execute">;

/** A missing flag row means OFF — never throws for that. */
export async function isInviteOnlyEnabled(reader: Reader = db): Promise<boolean> {
  const result = await reader.execute(
    sql`SELECT enabled FROM feature_flags WHERE key = ${INVITE_ONLY_FLAG} LIMIT 1`,
  );
  const row = result.rows[0] as { enabled?: boolean } | undefined;
  return row?.enabled === true;
}

export async function hasRedeemedAccessCode(clerkId: string, reader: Reader = db): Promise<boolean> {
  const [row] = await reader
    .select({ id: adminInviteCodeUses.id })
    .from(adminInviteCodeUses)
    .where(eq(adminInviteCodeUses.userId, clerkId))
    .limit(1);
  return Boolean(row);
}

export type AccessStatus = {
  inviteOnly: boolean;
  redeemed: boolean;
  /** True only when this person must enter a code before finishing sign-up. */
  required: boolean;
};

/**
 * Who needs a code: only when the flag is on AND the account has not finished
 * onboarding (existing accounts are grandfathered) AND isn't platform staff
 * (users.role = 'admin') AND hasn't already redeemed one.
 */
export async function getAccessStatus(clerkId: string, reader: Reader = db): Promise<AccessStatus> {
  const inviteOnly = await isInviteOnlyEnabled(reader);
  if (!inviteOnly) return { inviteOnly: false, redeemed: false, required: false };
  const [account] = await reader
    .select({ role: users.role, onboardingComplete: users.onboardingComplete })
    .from(users)
    .where(eq(users.clerkId, clerkId))
    .limit(1);
  const redeemed = await hasRedeemedAccessCode(clerkId, reader);
  const exempt = account?.role === "admin" || account?.onboardingComplete === true;
  return { inviteOnly, redeemed, required: !exempt && !redeemed };
}

const CODE_SHAPE = /^[A-Z0-9]{6,16}$/;

/** Upper-cases and strips separators people type ("abcd-efgh"). Null if malformed. */
export function normalizeAccessCode(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 40) return null;
  const code = raw.replace(/[\s-]/g, "").toUpperCase();
  return CODE_SHAPE.test(code) ? code : null;
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** True only for a code that exists, isn't revoked/expired, and has uses left. */
export async function isRedeemableCode(rawCode: unknown, reader: Reader = db): Promise<boolean> {
  const code = normalizeAccessCode(rawCode);
  if (!code) return false;
  const [row] = await reader.select().from(adminInviteCodes).where(eq(adminInviteCodes.code, code)).limit(1);
  if (!row || !safeEqual(row.code, code)) return false;
  if (row.disabledAt) return false;
  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) return false;
  if (row.maxUses != null && row.uses >= row.maxUses) return false;
  return true;
}
