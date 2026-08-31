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
import { db, teamMembers } from "@workspace/db";
import { and, eq, desc, asc } from "drizzle-orm";

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

async function resolveTeamContext(req: Request): Promise<TeamContext | null> {
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

  // If the client explicitly requests their own store context, skip team rewrite.
  const storeContextHeader = (req.headers as Record<string, string | string[] | undefined>)["x-store-context"];
  const wantsOwnStore =
    storeContextHeader === "own" ||
    (Array.isArray(storeContextHeader) && storeContextHeader[0] === "own");

  if (!wantsOwnStore) {
    try {
      const [membership] = await db
        .select({
          id: teamMembers.id,
          ownerId: teamMembers.ownerId,
          role: teamMembers.role,
        })
        .from(teamMembers)
        .where(and(eq(teamMembers.memberClerkId, userId), eq(teamMembers.status, "active")))
        // Keep selection aligned with /api/team/my-membership: newest first,
        // then stable owner/id tie-breakers for equal acceptance timestamps.
        .orderBy(desc(teamMembers.acceptedAt), asc(teamMembers.ownerId), asc(teamMembers.id))
        .limit(1);

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
      req.log.error({ err, actorClerkId: userId }, "Team membership lookup failed");
      // Fail open as owner-of-self — never lock a seller out of their own store.
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
  return async (req, _res, next) => {
    await resolveTeamContext(req as Request);
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

    const ctx = await resolveTeamContext(req as Request);
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
        message: `This action requires the ${minRole} role or higher. Ask the store owner to change your access.`,
      });
      return;
    }

    next();
  };
}
