/** Shared team invite link and email helpers. */
import { logger } from "./logger";
import { sendTeamInviteEmail as sendBrandedTeamInviteEmail } from "./brandthreadEmail";

/** Shareable invite links: web URL (expo web serves the domain root) + native deep link. */
export function inviteUrls(token: string) {
  const domain =
    process.env.REPLIT_DOMAINS?.split(",")[0] ?? process.env.REPLIT_DEV_DOMAIN ?? "";
  const deepLink = `mobile://team-invite?token=${token}`;
  return {
    inviteUrl: domain ? `https://${domain}/team-invite?token=${token}` : deepLink,
    deepLink,
  };
}

export function resetTeamInviteReminderTracking() {
  return { reminderSentAt: null, reminderClaimedAt: null };
}

export function teamInviteReminderIdempotencyKey(inviteId: string, inviteToken: string) {
  return `team-invite-reminder/${inviteId}/${inviteToken}`;
}

type TeamInviteEmailOptions = {
  reminder?: boolean;
  idempotencyKey?: string;
};

export async function sendTeamInviteEmail(
  to: string,
  ownerName: string,
  role: string,
  inviteUrl: string,
  options: TeamInviteEmailOptions = {},
): Promise<boolean> {
  try {
    return await sendBrandedTeamInviteEmail({
      to,
      ownerName,
      role,
      inviteUrl,
      reminder: options.reminder,
      idempotencyKey: options.idempotencyKey,
    });
  } catch (err) {
    logger.error({ err }, "Team invite email request failed");
    return false;
  }
}