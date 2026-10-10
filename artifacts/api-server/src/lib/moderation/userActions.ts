/**
 * Account-level moderation actions from the queue: warn, suspend (temporary
 * or permanent) and ban. Every action is recorded in user_moderation_actions;
 * temporary suspensions are lifted by the moderation-alerts job.
 */
import { and, eq, gt, isNull, lte, or, sql } from "drizzle-orm";
import { clerkClient } from "@clerk/express";
import { db, userModerationActions, users } from "@workspace/db";
import { logger } from "../logger";

export const SUSPENSION_DAY_OPTIONS = [1, 3, 7, 30] as const;

export function parseSuspensionDays(raw: unknown): number | null | "invalid" {
  if (raw === undefined || raw === null || raw === "" || raw === "permanent") return null;
  const n = Number(raw);
  return (SUSPENSION_DAY_OPTIONS as readonly number[]).includes(n) ? n : "invalid";
}

type Executor = Pick<typeof db, "insert" | "update" | "select">;

export async function recordUserAction(tx: Executor, input: {
  userId: string; kind: "warn" | "suspend" | "ban"; reason: string | null; reportId: string | null; actor: string; endsAt?: Date | null;
}): Promise<void> {
  await tx.insert(userModerationActions).values({
    userId: input.userId, kind: input.kind, reason: input.reason, reportId: input.reportId,
    actorClerkId: input.actor, endsAt: input.endsAt ?? null,
  });
}

/** Tell the member about a warning (in-app + push). Never throws. */
export async function notifyWarnedUser(userId: string, reason: string): Promise<void> {
  try {
    const { publishNotification } = await import("../../routes/notifications-feed");
    await publishNotification({
      userId,
      category: "system",
      type: "moderation_warning",
      title: "A warning about your content",
      body: `${reason} Repeated violations of the Community Guidelines can lead to suspension.`,
      targetType: "guidelines",
      pushCategory: "announcement",
      pushKind: "transactional",
    });
  } catch (err) {
    logger.warn({ err, userId }, "Could not notify warned user");
  }
}

/**
 * Lifts temporary suspensions whose time is up, unless the person has a ban
 * or another suspension that hasn't ended. Returns how many accounts were
 * reinstated.
 */
export async function liftExpiredSuspensions(now = new Date()): Promise<number> {
  const due = await db.select().from(userModerationActions)
    .where(and(eq(userModerationActions.kind, "suspend"), isNull(userModerationActions.liftedAt), lte(userModerationActions.endsAt, now)))
    .limit(200);
  let reinstated = 0;
  for (const action of due) {
    const lifted = await db.transaction(async (tx) => {
      const [claimed] = await tx.update(userModerationActions).set({ liftedAt: now, liftedBy: "system:suspension-expiry" })
        .where(and(eq(userModerationActions.id, action.id), isNull(userModerationActions.liftedAt))).returning({ id: userModerationActions.id });
      if (!claimed) return false;
      const [stillActive] = await tx.select({ id: userModerationActions.id }).from(userModerationActions)
        .where(and(
          eq(userModerationActions.userId, action.userId),
          isNull(userModerationActions.liftedAt),
          or(eq(userModerationActions.kind, "ban"),
            and(eq(userModerationActions.kind, "suspend"), or(isNull(userModerationActions.endsAt), gt(userModerationActions.endsAt, now)))),
        )).limit(1);
      if (stillActive) return false;
      const rows = await tx.update(users)
        .set({ suspendedAt: null, suspensionReason: null, activeStanding: true, updatedAt: now })
        .where(and(eq(users.clerkId, action.userId), sql`${users.suspendedAt} IS NOT NULL`)).returning({ id: users.id });
      return rows.length > 0;
    });
    if (lifted) {
      reinstated += 1;
      try { await clerkClient.users.unbanUser(action.userId); }
      catch (err) { logger.warn({ err, userId: action.userId }, "Clerk unban failed after suspension expiry"); }
    }
  }
  return reinstated;
}
