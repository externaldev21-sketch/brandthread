/**
 * Shared team activity logger — appends attributed entries to
 * team_activity_logs. Used by the team routes plus the key seller-side
 * mutations (products create/update/delete, order status/tracking changes,
 * inventory adjustments). Best-effort: never throws, safe to call unawaited.
 */
import { db, teamActivityLogs, teamMembers, users } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import type { Request } from "express";
import type { TeamRole } from "../middlewares/requireRole";
import { logger } from "./logger";

export async function logActivity(
  ownerClerkId: string,
  actorClerkId: string,
  actorRole: TeamRole | string,
  action: string,
  resourceType?: string,
  resourceId?: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  try {
    let actorName: string | null = null;
    let memberId: string | null = null;

    // Team member acting on the owner's store → resolve their member record.
    if (actorClerkId && actorClerkId !== ownerClerkId) {
      const [m] = await db
        .select({ id: teamMembers.id, name: teamMembers.name, email: teamMembers.email })
        .from(teamMembers)
        .where(and(eq(teamMembers.ownerId, ownerClerkId), eq(teamMembers.memberClerkId, actorClerkId)))
        .limit(1);
      if (m) {
        memberId = m.id;
        actorName = m.name ?? m.email;
      }
    }
    if (!actorName) {
      const [u] = await db
        .select({ name: users.name, displayName: users.displayName })
        .from(users)
        .where(eq(users.clerkId, actorClerkId))
        .limit(1);
      actorName = u?.displayName ?? u?.name ?? (actorRole === "owner" ? "Owner" : "Team member");
    }

    await db.insert(teamActivityLogs).values({
      ownerId: ownerClerkId,
      memberId: memberId ?? undefined,
      actorClerkId,
      actorRole: String(actorRole),
      actorName,
      action,
      resourceType: resourceType ?? undefined,
      resourceId: resourceId ?? undefined,
      metadata: metadata ?? {},
    });
  } catch (err) {
    logger.error({ err, action, resourceType, resourceId }, "Failed to record team activity");
  }
}

/**
 * Pull (ownerClerkId, actorClerkId, actorRole) off a request that went
 * through requireAuth (+ optionally teamContext/requireRole). Falls back to
 * treating the caller as the owner when no team context was resolved.
 */
export function reqActor(req: Request): {
  ownerClerkId: string;
  actorClerkId: string;
  actorRole: string;
} {
  const ownerClerkId = (req as any).clerkUserId as string;
  return {
    ownerClerkId,
    actorClerkId: ((req as any).actorClerkId as string) ?? ownerClerkId,
    actorRole: ((req as any).actorRole as string) ?? "owner",
  };
}
