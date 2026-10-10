import { db, users, accountProfiles } from "@workspace/db";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { isUniqueViolation, violatedConstraint } from "./dbErrors";

/**
 * One login = at most one buyer profile + one seller profile.
 *
 * A "login" is the Clerk user someone signs in with (email/password, Apple,
 * Google). Its second profile is a separate Clerk user with its own `users`
 * row, so @username, followers, posts, store, payouts, subscription, DMs and
 * notifications never mix. The second Clerk user has no password or social
 * login; the app reaches it with a short-lived sign-in token that only its
 * login (or a sibling profile) can mint. `account_profiles` (migration 270)
 * records who owns what; accounts that never added a profile have no rows and
 * behave exactly as before.
 */

export type ProfileRole = "buyer" | "seller";

export { LINKED_PROFILE_EMAIL_DOMAIN_DEFAULT, isLinkedProfileEmail, linkedProfileEmail, linkedProfileEmailDomain } from "./linkedProfileEmail";
import { isLinkedProfileEmail } from "./linkedProfileEmail";

export function asProfileRole(value: unknown): ProfileRole | null {
  return value === "buyer" || value === "seller" ? value : null;
}

/** The login that owns `clerkId`: itself unless it is someone's linked profile. */
export async function loginFor(clerkId: string): Promise<string> {
  const [row] = await db
    .select({ loginClerkId: accountProfiles.loginClerkId })
    .from(accountProfiles)
    .where(eq(accountProfiles.profileClerkId, clerkId))
    .limit(1);
  return row?.loginClerkId ?? clerkId;
}

/**
 * Key for limits that hold per PERSON rather than per profile (one free
 * trial, one onboarding AI sample, one daily Thread Cash reward, one
 * referral credit). For an account with no linked profile it is its own id.
 */
export const personKeyFor = loginFor;

export type GroupProfile = {
  profileClerkId: string;
  role: ProfileRole;
  deletedAt: Date | null;
  isLogin: boolean;
};

/** Every profile row (live and deleted) under the login that owns `clerkId`. */
export async function groupProfiles(clerkId: string): Promise<{ login: string; profiles: GroupProfile[] }> {
  const login = await loginFor(clerkId);
  const rows = await db
    .select()
    .from(accountProfiles)
    .where(eq(accountProfiles.loginClerkId, login));
  return {
    login,
    profiles: rows.map((row) => ({
      profileClerkId: row.profileClerkId,
      role: row.role as ProfileRole,
      deletedAt: row.deletedAt,
      isLogin: row.profileClerkId === login,
    })),
  };
}

/** Clerk ids of every profile owned by the same person, `clerkId` included. */
export async function personProfileIds(clerkId: string, opts: { includeDeleted?: boolean } = {}): Promise<string[]> {
  const { login, profiles } = await groupProfiles(clerkId);
  const ids = new Set<string>([clerkId, login]);
  for (const profile of profiles) {
    if (opts.includeDeleted || !profile.deletedAt) ids.add(profile.profileClerkId);
  }
  return [...ids];
}

/** Live sibling profiles (same login), excluding `clerkId` itself. */
export async function liveSiblingIds(clerkId: string): Promise<string[]> {
  const { profiles } = await groupProfiles(clerkId);
  return profiles.filter((p) => !p.deletedAt && p.profileClerkId !== clerkId).map((p) => p.profileClerkId);
}

export async function sameLogin(a: string, b: string): Promise<boolean> {
  if (a === b) return true;
  const [la, lb] = await Promise.all([loginFor(a), loginFor(b)]);
  return la === lb;
}

export class ProfileRoleTakenError extends Error {
  readonly code = "PROFILE_ROLE_EXISTS";
  constructor(readonly role: ProfileRole, readonly profileClerkId: string | null) {
    super(role === "seller"
      ? "This email already has a seller account."
      : "This email already has a buyer account.");
  }
}

/**
 * Throws ProfileRoleTakenError when another live profile under the same login
 * already has `role`. A no-op for accounts without linked profiles.
 */
export async function assertRoleAvailable(clerkId: string, role: ProfileRole): Promise<void> {
  const { profiles } = await groupProfiles(clerkId);
  const holder = profiles.find((p) => !p.deletedAt && p.role === role && p.profileClerkId !== clerkId);
  if (holder) throw new ProfileRoleTakenError(role, holder.profileClerkId);
}

/**
 * Keeps this profile's row in step with its accountType. The partial unique
 * index (login, role) is the final guard against two buyers or two sellers.
 */
export async function recordProfileRole(clerkId: string, role: ProfileRole): Promise<void> {
  const [row] = await db
    .select({ id: accountProfiles.id, role: accountProfiles.role, loginClerkId: accountProfiles.loginClerkId })
    .from(accountProfiles)
    .where(and(eq(accountProfiles.profileClerkId, clerkId), isNull(accountProfiles.deletedAt)))
    .limit(1);
  if (!row || row.role === role) return;
  try {
    await db.update(accountProfiles).set({ role }).where(eq(accountProfiles.id, row.id));
  } catch (err) {
    if (isUniqueViolation(err) && violatedConstraint(err) === "account_profiles_login_role_unique") {
      throw new ProfileRoleTakenError(role, null);
    }
    throw err;
  }
}

/** Marks a purged profile deleted so its role can be created again. */
export async function markProfileDeleted(clerkId: string, at = new Date()): Promise<void> {
  await db
    .update(accountProfiles)
    .set({ deletedAt: at })
    .where(and(eq(accountProfiles.profileClerkId, clerkId), isNull(accountProfiles.deletedAt)));
}

/**
 * Sibling profiles that are still in use: not purged and not waiting out a
 * deletion grace period. Used to keep a login alive for the profile it owns.
 */
export async function activeSiblingIds(clerkId: string): Promise<string[]> {
  const ids = await liveSiblingIds(clerkId);
  if (ids.length === 0) return [];
  const rows = await db
    .select({ clerkId: users.clerkId })
    .from(users)
    .where(and(inArray(users.clerkId, ids), isNull(users.deletedAt), isNull(users.deletionRequestedAt)));
  return rows.map((row) => row.clerkId);
}

/** True when `clerkId` is a login that still owns another profile in use. */
export async function isLoginWithLiveSiblings(clerkId: string): Promise<boolean> {
  if ((await loginFor(clerkId)) !== clerkId) return false;
  return (await activeSiblingIds(clerkId)).length > 0;
}

/**
 * Whoever should receive mail addressed to a linked profile's placeholder
 * email: the login's current email. Anything else is returned unchanged.
 */
export async function resolveDeliveryAddress(
  to: string,
  getLoginEmail: (loginClerkId: string) => Promise<string | null>,
): Promise<string> {
  if (!isLinkedProfileEmail(to)) return to;
  const [profile] = await db
    .select({ clerkId: users.clerkId })
    .from(users)
    .where(eq(users.email, to.trim().toLowerCase()))
    .limit(1);
  if (!profile) return to;
  const login = await loginFor(profile.clerkId);
  if (login === profile.clerkId) return to;
  return (await getLoginEmail(login)) ?? to;
}

/** Live users rows for a set of clerk ids (helper for listing profiles). */
export async function liveUsersByClerkIds(ids: string[]) {
  if (ids.length === 0) return [];
  return db
    .select({
      clerkId: users.clerkId,
      accountType: users.accountType,
      username: users.username,
      displayName: users.displayName,
      name: users.name,
      avatarUrl: users.avatarUrl,
      onboardingComplete: users.onboardingComplete,
      deletedAt: users.deletedAt,
      deletionRequestedAt: users.deletionRequestedAt,
      deletionScheduledFor: users.deletionScheduledFor,
    })
    .from(users)
    .where(inArray(users.clerkId, ids));
}
