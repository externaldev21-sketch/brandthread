/**
 * Team role resolution + enforcement.
 *
 * Every authenticated caller acts in the context of exactly one store:
 *  - If they are an ACTIVE team member of another seller's store, they act on
 *    that owner's store: `req.clerkUserId` is rewritten to the owner's Clerk id
 *    (so existing owner-scoped queries operate on the owner's data) while
 *    `req.actorClerkId` / `req.actorRole` keep the real caller for audit logs.
 *  - Otherwise they are the owner of their own store (TEAM_OWNER_BYPASS).
 *
 * `requireRole(minRole)` returns 403 when the caller's role in the target
 * store is below `minRole`. Hierarchy: staff < manager < owner.
 *
 * NOTE: mount `teamContext()` / `requireRole()` AFTER `requireAuth` inside a
 * router (they rewrite `req.clerkUserId`, which requireAuth sets).
 * `requireRole` is also safe standalone at mount level (it re-reads Clerk auth
 * internally, like requirePlan).
 */
import { getAuth } from "@clerk/express";
import type { Request, RequestHandler } from "express";
import { db, teamMembers, users } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { teamMembershipOrderBy } from "../lib/teamMembership";

export type TeamRole = "owner" | "manager" | "staff";

const ROLE_ORDER: Record<TeamRole, number> = { staff: 1, manager: 2, owner: 3 };

/** The account owner is always granted full access to their own store. */
export const TEAM_OWNER_BYPASS = true;

export interface TeamContext {
  /** Clerk id of who is actually making the request. */
  actorClerkId: string;
  /** Their role in the store they are acting on. */
  actorRole: TeamRole;
  /** Clerk id of the store owner whose data is being operated on. */
  storeOwnerId: string;
  /** team_members.id when the caller is a team member, else null. */
  teamMembershipId: string | null;
}

export class InvalidStoreContextError extends Error {
  constructor(message = "The selected store is not available to this account.") {
    super(message);
    this.name = "InvalidStoreContextError";
  }
}

function headerValue(req: Request, name: string): string | null {
  const value = (req.headers as Record<string, string | string[] | undefined>)[name];
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/**
 * Whether this caller runs a real store of their own (completed seller
 * onboarding), as opposed to being purely a joined team member elsewhere.
 *
 * Used only to pick a sane DEFAULT store context when the client hasn't said
 * which store it wants (see the header handling below). Never throws: a
 * lookup failure must not silently demote a real owner into someone else's
 * store, so it fails toward "this is their own store".
 */
async function callerRunsOwnStore(userId: string): Promise<boolean> {
  try {
    const [row] = await db
      .select({ onboardingComplete: users.onboardingComplete })
      .from(users)
      .where(eq(users.clerkId, userId))
      .limit(1);
    return row ? Boolean(row.onboardingComplete) : true;
  } catch {
    return true;
  }
}

export async function resolveTeamContext(req: Request): Promise<TeamContext | null> {
  const existing = (req as any).teamContext as TeamContext | undefined;
  if (existing) return existing;

  const { userId } = getAuth(req);
  if (!userId) return null;

  const ctx: TeamContext = {
    actorClerkId: userId,
    actorRole: "owner",
    storeOwnerId: userId,
    teamMembershipId: null,
  };

  // `own` is the user's store. A membership UUID explicitly selects one of
  // their joined stores. `joined` is an explicit request for the legacy
  // newest-membership behavior.
  //
  // An ABSENT header used to also mean "joined" for every caller. That
  // silently switched a real store owner into a store they'd merely joined
  // as staff/manager whenever they hadn't (or couldn't, on a fresh install)
  // persist an explicit "own" preference — locking them out of their own
  // owner-only screens (Payouts, Finance, Subscription) with a "store owner
  // access required" error even though they ARE the owner of their own
  // store. Callers who genuinely run their own store now default to it;
  // only callers with no store of their own keep the legacy joined default.
  const storeContextHeader = headerValue(req, "x-store-context");
  const explicitJoined = storeContextHeader === "joined";
  const selectedMembershipId =
    storeContextHeader && storeContextHeader !== "own" && !explicitJoined
      ? storeContextHeader
      : null;
  const wantsOwnStore =
    storeContextHeader === "own"
    || (!selectedMembershipId && !explicitJoined && await callerRunsOwnStore(userId));

  if (wantsOwnStore) {
    (req as any).teamContext = ctx;
    (req as any).actorClerkId = ctx.actorClerkId;
    (req as any).actorRole = ctx.actorRole;
    (req as any).clerkUserId = ctx.storeOwnerId;
    return ctx;
  }

  try {
    const [membership] = await db
      .select({
        id: teamMembers.id,
        ownerId: teamMembers.ownerId,
        role: teamMembers.role,
      })
      .from(teamMembers)
      .where(
        selectedMembershipId
          ? and(
              eq(teamMembers.id, selectedMembershipId),
              eq(teamMembers.memberClerkId, userId),
              eq(teamMembers.status, "active"),
            )
          : and(eq(teamMembers.memberClerkId, userId), eq(teamMembers.status, "active")),
      )
      .orderBy(...teamMembershipOrderBy())
      .limit(1);

    if (selectedMembershipId && (!membership || membership.ownerId === userId)) {
      throw new InvalidStoreContextError();
    }

    if (membership && membership.ownerId !== userId) {
      ctx.actorRole = (membership.role as TeamRole) ?? "staff";
      ctx.storeOwnerId = membership.ownerId;
      ctx.teamMembershipId = membership.id;
      // Touch lastActiveAt (fire & forget) — drives online/offline status.
      db.update(teamMembers)
        .set({ lastActiveAt: new Date() })
        .where(eq(teamMembers.id, membership.id))
        .then(() => {}, () => {});
    }
  } catch (err) {
    if (err instanceof InvalidStoreContextError) throw err;
    req.log.error({ err, actorClerkId: userId }, "Team membership lookup failed");
    // An explicit selection must never fall back to a different store. For
    // legacy/default resolution, preserve the existing owner-of-self fallback.
    if (selectedMembershipId) {
      throw new InvalidStoreContextError("Unable to verify the selected store. Please try again.");
    }
  }

  (req as any).teamContext = ctx;
  (req as any).actorClerkId = ctx.actorClerkId;
  (req as any).actorRole = ctx.actorRole;
  // Act on the target store: downstream owner-scoped handlers keep working.
  (req as any).clerkUserId = ctx.storeOwnerId;
  return ctx;
}

/** Resolve team context without enforcing a minimum role (for reads).
 * Typed as RequestHandler<any,…> so adding it to a route doesn't clobber the
 * route's own path-literal param inference. */
export function teamContext(): RequestHandler<any, any, any, any> {
  return async (req, res, next) => {
    try {
      await resolveTeamContext(req as Request);
    } catch (err) {
      if (err instanceof InvalidStoreContextError) {
        res.status(403).json({
          error: err.message,
          code: "STORE_CONTEXT_NOT_ALLOWED",
        });
        return;
      }
      throw err;
    }
    next();
  };
}

/**
 * Middleware factory enforcing a minimum team role on the target store.
 * Returns 403 with `{ error, code, requiredRole, currentRole }` when the
 * caller's role is insufficient.
 */
export function requireRole(minRole: TeamRole): RequestHandler<any, any, any, any> {
  return async (req, res, next) => {
    const { userId } = getAuth(req as Request);
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    let ctx: TeamContext | null;
    try {
      ctx = await resolveTeamContext(req as Request);
    } catch (err) {
      if (err instanceof InvalidStoreContextError) {
        res.status(403).json({
          error: err.message,
          code: "STORE_CONTEXT_NOT_ALLOWED",
        });
        return;
      }
      throw err;
    }
    const role = ctx?.actorRole ?? "owner";

    if (TEAM_OWNER_BYPASS && role === "owner") {
      next();
      return;
    }

    if ((ROLE_ORDER[role] ?? 0) < (ROLE_ORDER[minRole] ?? Number.MAX_SAFE_INTEGER)) {
      res.status(403).json({
        error: "Insufficient role",
        code: "ROLE_REQUIRED",
        requiredRole: minRole,
        currentRole: role,
        message: minRole === "owner"
          ? "Only the store owner can do this. Ask them to grant you a role with that access."
          : `This needs ${minRole} access or higher on this store. Ask the store owner to change your access.`,
      });
      return;
    }

    next();
  };
}
