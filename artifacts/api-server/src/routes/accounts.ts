import { Router, type Request, type Response } from "express";
import { clerkClient } from "@clerk/express";
import crypto from "node:crypto";
import { db, users, accountProfiles } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { rateLimit } from "../middlewares/rateLimit";
import { bandMaySellOrEarn, AGE_RESTRICTED_MESSAGE } from "../lib/ageGate";
import { recordLegalAcceptance } from "../lib/legalAcceptance";
import {
  DELETION_GRACE_DAYS,
  getDeletionBlockers,
  hasDeletionConfirmation,
  isPendingDeletion,
  revokeAllSessions,
  scheduleAccountDeletion,
  verifyDeletionReauth,
} from "../lib/accountDeletion";
import {
  ProfileRoleTakenError,
  asProfileRole,
  groupProfiles,
  linkedProfileEmail,
  liveUsersByClerkIds,
  loginFor,
  sameLogin,
  type ProfileRole,
} from "../lib/accountProfiles";
import { isUniqueViolation, violatedConstraint } from "../lib/dbErrors";

// ─── /api/accounts ──────────────────────────────────────────────────────────
// One login (email/password, Apple, Google) holds at most one buyer profile
// and one seller profile. See lib/accountProfiles.ts for the model.

const router = Router();
router.use(requireAuth);

const SIGN_IN_TOKEN_TTL_SECONDS = 120;

function callerOf(req: Request): string {
  return (req as any).clerkUserId as string;
}

async function mintSignInToken(userId: string): Promise<string> {
  const token = await clerkClient.signInTokens.createSignInToken({ userId, expiresInSeconds: SIGN_IN_TOKEN_TTL_SECONDS });
  return token.token;
}

function roleTaken(res: Response, err: ProfileRoleTakenError) {
  res.status(409).json({
    error: `${err.message} Switch to it.`,
    code: err.code,
    role: err.role,
    profileClerkId: err.profileClerkId,
  });
}

// ─── GET /api/accounts/profiles ─────────────────────────────────────────────
// The caller's own profiles under one login, for the switcher and Settings.
// Only ever describes profiles owned by the caller's login.
router.get("/profiles", async (req, res) => {
  const caller = callerOf(req);
  try {
    const { login, profiles } = await groupProfiles(caller);
    const liveRows = profiles.filter((p) => !p.deletedAt);
    const ids = liveRows.length > 0 ? liveRows.map((p) => p.profileClerkId) : [caller];
    const rows = await liveUsersByClerkIds(ids);
    const byId = new Map(rows.map((row) => [row.clerkId, row]));
    const list = ids
      .map((clerkId) => {
        const row = byId.get(clerkId);
        if (!row || row.deletedAt) return null;
        const groupRow = liveRows.find((p) => p.profileClerkId === clerkId);
        const role = groupRow?.role ?? asProfileRole(row.accountType);
        return {
          clerkId,
          role,
          username: row.username,
          displayName: row.displayName || row.name,
          avatarUrl: row.avatarUrl,
          onboardingComplete: row.onboardingComplete,
          isLogin: clerkId === login,
          isCurrent: clerkId === caller,
          pendingDeletion: isPendingDeletion(row),
        };
      })
      .filter((p): p is NonNullable<typeof p> => p !== null);
    const taken = new Set(list.map((p) => p.role).filter(Boolean));
    res.json({
      profiles: list,
      canAdd: { buyer: !taken.has("buyer"), seller: !taken.has("seller") },
    });
  } catch (err) {
    req.log.error({ err }, "Failed to list account profiles");
    res.status(500).json({ error: "Couldn't load your profiles." });
  }
});

// ─── POST /api/accounts/profiles { role } ───────────────────────────────────
// "Start selling" (buyer → seller) and "Shop as a buyer" (seller → buyer).
// Creates the second profile under the SAME login: no new email, password or
// social sign-in. Returns a short-lived sign-in token the app exchanges for a
// session on the new profile, then continues into onboarding after the
// account step.
router.post("/profiles", rateLimit("authentication"), async (req, res) => {
  const caller = callerOf(req);
  const role = asProfileRole(req.body?.role);
  if (!role) {
    res.status(400).json({ error: "role must be 'buyer' or 'seller'." });
    return;
  }

  let createdClerkUserId: string | null = null;
  try {
    const [me] = await db.select().from(users).where(eq(users.clerkId, caller)).limit(1);
    if (!me || me.deletedAt || isPendingDeletion(me)) {
      res.status(404).json({ error: "Account record was not found." });
      return;
    }
    const myRole = asProfileRole(me.accountType);
    if (!myRole) {
      res.status(409).json({ error: "Finish setting up this account first.", code: "FINISH_SETUP" });
      return;
    }
    if (role === "seller" && !bandMaySellOrEarn(me.ageBand)) {
      res.status(403).json({ error: AGE_RESTRICTED_MESSAGE, code: "AGE_RESTRICTED" });
      return;
    }

    const login = await loginFor(caller);
    const result = await db.transaction(async (tx) => {
      // One creation at a time per login: a double tap must not make two.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`account_profiles:${login}`}))`);

      const existing = await tx.select().from(accountProfiles).where(eq(accountProfiles.loginClerkId, login));
      const live = existing.filter((row) => !row.deletedAt);
      if (live.length === 0) {
        // First linked profile: record the login's own profile and its role.
        const [loginUser] = login === caller
          ? [me]
          : await tx.select().from(users).where(eq(users.clerkId, login)).limit(1);
        const loginRole = asProfileRole(loginUser?.accountType);
        if (!loginRole) throw Object.assign(new Error("Finish setting up this account first."), { status: 409, code: "FINISH_SETUP" });
        await tx.insert(accountProfiles)
          .values({ loginClerkId: login, profileClerkId: login, role: loginRole })
          .onConflictDoNothing();
        live.push({ id: "", loginClerkId: login, profileClerkId: login, role: loginRole, createdAt: new Date(), deletedAt: null });
      }
      const holder = live.find((row) => row.role === role);
      if (holder) throw new ProfileRoleTakenError(role, holder.profileClerkId);

      const token = crypto.randomUUID().replace(/-/g, "");
      const email = linkedProfileEmail(token);
      const clerkUser = await clerkClient.users.createUser({
        externalId: `bt-profile-${token}`,
        emailAddress: [email],
        skipPasswordRequirement: true,
        skipLegalChecks: true,
        firstName: me.name?.split(" ")[0] || undefined,
      });
      createdClerkUserId = clerkUser.id;

      const name = me.name || "";
      await tx.insert(users).values({
        clerkId: clerkUser.id,
        email,
        name,
        displayName: me.displayName || name,
        role: "owner",
        accountType: role,
        ageBand: me.ageBand,
        ageVerifiedAt: me.ageVerifiedAt,
      });
      if (me.termsVersion) {
        await recordLegalAcceptance(tx as any, {
          clerkId: clerkUser.id,
          version: me.termsVersion,
          source: "signup",
          acceptedAt: me.termsAcceptedAt ?? new Date(),
        });
      }
      await tx.insert(accountProfiles).values({ loginClerkId: login, profileClerkId: clerkUser.id, role });
      return { profileClerkId: clerkUser.id };
    });

    const signInToken = await mintSignInToken(result.profileClerkId);
    res.status(201).json({ profile: { clerkId: result.profileClerkId, role }, signInToken });
  } catch (err: any) {
    if (createdClerkUserId) {
      await clerkClient.users.deleteUser(createdClerkUserId).catch(() => undefined);
    }
    if (err instanceof ProfileRoleTakenError) { roleTaken(res, err); return; }
    if (isUniqueViolation(err) && violatedConstraint(err) === "account_profiles_login_role_unique") {
      roleTaken(res, new ProfileRoleTakenError(role, null));
      return;
    }
    if (err?.status === 409 && err?.code === "FINISH_SETUP") {
      res.status(409).json({ error: err.message, code: err.code });
      return;
    }
    req.log.error({ err }, "Failed to create linked profile");
    res.status(502).json({ error: "Couldn't create the profile. Try again." });
  }
});

// ─── POST /api/accounts/profiles/:clerkId/sign-in-token ─────────────────────
// Switching to a profile of the same login that isn't signed in on this
// device yet (new phone, or after logging that profile out).
router.post("/profiles/:clerkId/sign-in-token", rateLimit("authentication"), async (req, res) => {
  const caller = callerOf(req);
  const target = String(req.params.clerkId ?? "");
  try {
    const { profiles } = await groupProfiles(caller);
    const row = profiles.find((p) => p.profileClerkId === target && !p.deletedAt);
    if (!row || !(await sameLogin(caller, target))) {
      res.status(404).json({ error: "Profile not found." });
      return;
    }
    const [account] = await db.select({ deletedAt: users.deletedAt }).from(users).where(eq(users.clerkId, target)).limit(1);
    if (!account || account.deletedAt) {
      res.status(404).json({ error: "Profile not found." });
      return;
    }
    res.json({ signInToken: await mintSignInToken(target) });
  } catch (err) {
    req.log.error({ err }, "Failed to mint profile sign-in token");
    res.status(502).json({ error: "Couldn't switch profiles. Try again." });
  }
});

// ─── DELETE /api/accounts/login ─────────────────────────────────────────────
// "Delete login": deletes the login and every profile it owns. Same rules as
// deleting one profile (typed DELETE, fresh password or emailed code, open
// obligations settled first, 30-day grace) applied to each profile.
router.delete("/login", rateLimit("authentication"), async (req, res) => {
  const caller = callerOf(req);
  if (!hasDeletionConfirmation(req.body)) {
    res.status(400).json({ error: "Type DELETE exactly to delete your login." });
    return;
  }
  try {
    const reauth = await verifyDeletionReauth(caller, req.body ?? {});
    if (!reauth.ok) {
      res.status(reauth.status).json({ error: reauth.error, code: reauth.code });
      return;
    }
    const { login, profiles } = await groupProfiles(caller);
    const ids = new Set<string>([login, caller]);
    for (const p of profiles) if (!p.deletedAt) ids.add(p.profileClerkId);

    const blockers = (await Promise.all([...ids].map(async (id) => getDeletionBlockers(id)))).flat();
    if (blockers.length > 0) {
      res.status(409).json({ error: "Settle the items below before deleting your login.", code: "DELETION_BLOCKED", blockers });
      return;
    }
    let scheduledFor: Date | null = null;
    for (const id of ids) {
      scheduledFor = (await scheduleAccountDeletion(id)) ?? scheduledFor;
    }
    for (const id of ids) {
      await revokeAllSessions(id).catch((err) => req.log.warn({ err }, "Could not revoke sessions after scheduling login deletion"));
    }
    res.json({ ok: true, profiles: ids.size, scheduledFor: scheduledFor?.toISOString() ?? null, graceDays: DELETION_GRACE_DAYS });
  } catch (err) {
    req.log.error({ err }, "Login deletion failed");
    res.status(502).json({ error: "We couldn't schedule your login deletion. Try again or contact support." });
  }
});

export default router;
export type { ProfileRole };
