/** Shared team invite link and email helpers. */

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
  const key = process.env.RESEND_API_KEY;
  if (!key) return false;

  const subject = options.reminder
    ? `Reminder: your Brandthread team invite expires soon`
    : `${ownerName} invited you to join their team on Brandthread`;
  const html = options.reminder
    ? `<p>This is a reminder that ${ownerName} invited you to join their Brandthread team as <b>${role}</b>.</p><p>Your invite link expires in approximately 24 hours.</p><p><a href="${inviteUrl}">Accept the invite</a></p><p>Or paste this link into your browser:<br/>${inviteUrl}</p>`
    : `<p>${ownerName} invited you to join their Brandthread team as <b>${role}</b>.</p><p><a href="${inviteUrl}">Accept the invite</a></p><p>Or paste this link into your browser:<br/>${inviteUrl}</p>`;

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        ...(options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : {}),
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM_EMAIL ?? "Brandthread <onboarding@resend.dev>",
        to: [to],
        subject,
        html,
      }),
    });
    if (!response.ok) {
      console.error("[team] Resend email failed:", response.status, await response.text());
    }
    return response.ok;
  } catch (err) {
    console.error("[team] Resend email failed:", err);
    return false;
  }
}