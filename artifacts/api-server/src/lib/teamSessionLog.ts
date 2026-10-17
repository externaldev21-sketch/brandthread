/**
 * Team member store sign-ins for the owner's Security → User activity logs.
 * Kept out of lib/activityLog.ts so route tests that mock that module are
 * unaffected by middlewares/requireRole importing this.
 */
import { db, teamMembers } from "@workspace/db";
import { and, eq, isNull, lt, or } from "drizzle-orm";
import type { TeamRole } from "../middlewares/requireRole";
import { logActivity } from "./activityLog";
import { logger } from "./logger";

/** A team member returning after this long counts as a new store sign-in. */
export const TEAM_SESSION_GAP_MS = 30 * 60 * 1000;

/**
 * Touch a team member's lastActiveAt (drives online status) and, when they
 * were inactive for longer than TEAM_SESSION_GAP_MS (or never active),
 * record a "Signed in to the store" entry (resourceType "session") in the
 * team audit log. The conditional update is atomic, so concurrent requests
 * log only once. Best-effort: never throws.
 */
export async function touchTeamMemberActivity(
  membershipId: string,
  ownerClerkId: string,
  actorClerkId: string,
  actorRole: TeamRole | string,
  now: Date = new Date(),
): Promise<void> {
  try {
    const cutoff = new Date(now.getTime() - TEAM_SESSION_GAP_MS);
    const started = await db.update(teamMembers)
      .set({ lastActiveAt: now })
      .where(and(
        eq(teamMembers.id, membershipId),
        or(isNull(teamMembers.lastActiveAt), lt(teamMembers.lastActiveAt, cutoff)),
      ))
      .returning({ id: teamMembers.id });
    if (started.length > 0) {
      await logActivity(ownerClerkId, actorClerkId, actorRole, "Signed in to the store", "session", membershipId);
      return;
    }
    await db.update(teamMembers).set({ lastActiveAt: now }).where(eq(teamMembers.id, membershipId));
  } catch (err) {
    logger.error({ err, membershipId }, "Failed to record team member activity");
  }
}
