/**
 * Team invite reminder job.
 *
 * Runs hourly and reminds pending invitees whose current link expires within
 * the next 24 hours. The conditional update claims an invite before sending,
 * so overlapping job runs or multiple API instances cannot send duplicates.
 * Claims expire after a short lease so a process crash cannot permanently
 * suppress a reminder before its delivery is confirmed.
 */
import { and, eq, gte, isNull, lt, lte, or } from "drizzle-orm";
import { db, teamMembers, users } from "@workspace/db";
import {
  inviteUrls,
  sendTeamInviteEmail,
  teamInviteReminderIdempotencyKey,
} from "../lib/teamInvites";

const REMINDER_WINDOW_MS = 24 * 60 * 60 * 1000;
const INTERVAL_MS = 60 * 60 * 1000;
const CLAIM_LEASE_MS = 15 * 60 * 1000;

export async function runTeamInviteReminder(): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.log("[teamInviteReminder] Skipped: RESEND_API_KEY is not configured");
    return;
  }

  const now = new Date();
  const expiresBefore = new Date(now.getTime() + REMINDER_WINDOW_MS);
  const staleClaimBefore = new Date(now.getTime() - CLAIM_LEASE_MS);

  try {
    const candidates = await db
      .select({
        id: teamMembers.id,
        email: teamMembers.email,
        role: teamMembers.role,
        inviteToken: teamMembers.inviteToken,
        expiresAt: teamMembers.expiresAt,
        ownerName: users.brandName,
        ownerDisplayName: users.displayName,
        ownerLegalName: users.name,
      })
      .from(teamMembers)
      .leftJoin(users, eq(users.clerkId, teamMembers.ownerId))
      .where(
        and(
          eq(teamMembers.status, "pending"),
          isNull(teamMembers.reminderSentAt),
          or(
            isNull(teamMembers.reminderClaimedAt),
            lt(teamMembers.reminderClaimedAt, staleClaimBefore),
          ),
          gte(teamMembers.expiresAt, now),
          lte(teamMembers.expiresAt, expiresBefore),
        ),
      );

    let reminded = 0;
    for (const candidate of candidates) {
      if (!candidate.inviteToken || !candidate.expiresAt) continue;

      // Claim only if the invite is still pending and has no live delivery
      // lease. This is the once-only boundary when API instances overlap.
      const claimed = await db
        .update(teamMembers)
        .set({ reminderClaimedAt: now, updatedAt: now })
        .where(
          and(
            eq(teamMembers.id, candidate.id),
            eq(teamMembers.status, "pending"),
            isNull(teamMembers.reminderSentAt),
            or(
              isNull(teamMembers.reminderClaimedAt),
              lt(teamMembers.reminderClaimedAt, staleClaimBefore),
            ),
            eq(teamMembers.inviteToken, candidate.inviteToken),
            gte(teamMembers.expiresAt, now),
            lte(teamMembers.expiresAt, expiresBefore),
          ),
        )
        .returning({ id: teamMembers.id });

      if (claimed.length === 0) continue;

      const { inviteUrl } = inviteUrls(candidate.inviteToken);
      const ownerName =
        candidate.ownerName ??
        candidate.ownerDisplayName ??
        candidate.ownerLegalName ??
        "A Brandthread seller";
      const sent = await sendTeamInviteEmail(
        candidate.email,
        ownerName,
        candidate.role,
        inviteUrl,
        {
          reminder: true,
          // Resend retains this key for 24 hours. If a worker crashes after
          // Resend accepts the request but before we persist sent state, a
          // retried lease resolves to the same delivery instead of resending.
          idempotencyKey: teamInviteReminderIdempotencyKey(
            candidate.id,
            candidate.inviteToken,
          ),
        },
      );

      if (sent) {
        const delivered = await db
          .update(teamMembers)
          .set({ reminderSentAt: now, reminderClaimedAt: null, updatedAt: new Date() })
          .where(
            and(
              eq(teamMembers.id, candidate.id),
              eq(teamMembers.status, "pending"),
              eq(teamMembers.inviteToken, candidate.inviteToken),
              isNull(teamMembers.reminderSentAt),
              eq(teamMembers.reminderClaimedAt, now),
            ),
          )
          .returning({ id: teamMembers.id });
        if (delivered.length > 0) reminded++;
      } else {
        // A failed delivery should be eligible on the next run. Only clear
        // the lease this worker claimed, never another worker's live lease.
        await db
          .update(teamMembers)
          .set({ reminderClaimedAt: null, updatedAt: new Date() })
          .where(
            and(
              eq(teamMembers.id, candidate.id),
              eq(teamMembers.inviteToken, candidate.inviteToken),
              eq(teamMembers.reminderClaimedAt, now),
            ),
          );
      }
    }

    if (reminded > 0) {
      console.log(`[teamInviteReminder] Sent ${reminded} invite reminder(s)`);
    }
  } catch (err) {
    console.error("[teamInviteReminder] Error:", err);
  }
}

export function startTeamInviteReminderJob(): void {
  // Check soon after startup so a deploy near an invite's reminder window
  // does not wait for the first full interval.
  setTimeout(() => void runTeamInviteReminder(), 5 * 60 * 1000);
  setInterval(() => void runTeamInviteReminder(), INTERVAL_MS);
  console.log("[teamInviteReminder] Job scheduled (runs every hour, first run in 5 min)");
}