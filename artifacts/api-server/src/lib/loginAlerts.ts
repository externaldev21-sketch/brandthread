import { db, loginAlertSessions } from "@workspace/db";
import { and, eq, ne, sql } from "drizzle-orm";
import { logger } from "./logger";
import { getUserAppSettings } from "./userAppSettingsStore";
import { escapeHtml, renderBrandthreadEmail, sendBrandthreadEmail } from "./brandthreadEmail";
import { describeDevice, shouldSendLoginAlert } from "./loginAlertRules";

/**
 * Records the current Clerk session for this account and, when it is a new
 * sign-in and Login alerts is on, emails the account owner. Never throws —
 * it runs after /auth/sync responds.
 */
export async function recordSignInAndAlert(opts: {
  userId: string;
  sessionId: string | null | undefined;
  email: string;
  name: string;
  userAgent?: string | null;
}): Promise<void> {
  if (!opts.sessionId) return;
  try {
    const inserted = await db.insert(loginAlertSessions)
      .values({ userId: opts.userId, sessionId: opts.sessionId, userAgent: opts.userAgent?.slice(0, 400) ?? null })
      .onConflictDoNothing()
      .returning({ sessionId: loginAlertSessions.sessionId });
    const isNewSession = inserted.length > 0;
    if (!isNewSession) return;

    const [{ count } = { count: 0 }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(loginAlertSessions)
      .where(and(eq(loginAlertSessions.userId, opts.userId), ne(loginAlertSessions.sessionId, opts.sessionId)));
    const { settings } = await getUserAppSettings(opts.userId);
    if (!shouldSendLoginAlert({ isNewSession, priorSessionCount: Number(count), loginAlertsEnabled: settings.loginAlerts })) return;

    const device = describeDevice(opts.userAgent);
    const when = new Date().toUTCString();
    const html = renderBrandthreadEmail({
      preheader: "New sign-in to your Brandthread account.",
      eyebrow: "Security",
      title: "New sign-in to your account",
      subtitle: `${device} · ${when}`,
      bodyHtml:
        `<p>Hi ${escapeHtml(opts.name)}, your Brandthread account was just signed in on a new device (${escapeHtml(device)}).</p>` +
        "<p>If this was you, there's nothing to do. If it wasn't, open Brandthread → Settings → Login activity to sign that device out, then change your password.</p>" +
        "<p>You can turn these emails off in Settings → Accounts Center → Password and security → Login alerts.</p>",
      cta: { label: "Open Brandthread", url: "https://brandthread.app" },
    });
    const sent = await sendBrandthreadEmail({
      to: opts.email,
      subject: "New sign-in to your Brandthread account",
      html,
      idempotencyKey: `login-alert/${opts.userId}/${opts.sessionId}`,
    });
    if (!sent) logger.warn({ userId: opts.userId }, "Login alert email was not delivered (is Resend configured?)");
  } catch (err) {
    logger.error({ err, userId: opts.userId }, "Login alert check failed");
  }
}
