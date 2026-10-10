/**
 * Database / push / email / Slack wiring for lib/moderatorAlerts.ts.
 * notifyModeratorsOfReport() is fire-and-forget from POST /api/reports: it
 * never throws and never delays the response.
 */
import { db, users } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";
import { sendRawEmail } from "./mailer";
import { sendPushToUser } from "./push";
import {
  alertEmailHtml,
  buildNewReportAlert,
  postSlackWebhook,
  sendModeratorAlert,
  type AlertDeps,
  type AlertMessage,
  type ReportForAlert,
} from "./moderatorAlerts";

const MAX_MODERATORS = 50;

export const moderatorAlertDeps: AlertDeps = {
  async listModeratorIds() {
    const rows = await db.select({ id: users.clerkId }).from(users).where(eq(users.role, "admin")).limit(MAX_MODERATORS);
    return rows.map((r) => r.id).filter((id): id is string => typeof id === "string" && id.length > 0);
  },
  async sendPush(userId: string, alert: AlertMessage) {
    return sendPushToUser(userId, {
      title: alert.title,
      body: alert.body,
      kind: "transactional",
      data: { type: `moderation_${alert.kind}`, reportIds: alert.reportIds.slice(0, 20) },
    });
  },
  async sendEmail(to: string, alert: AlertMessage) {
    const result = await sendRawEmail({
      to,
      subject: `[Brandthread moderation] ${alert.title}`,
      html: alertEmailHtml(alert),
      text: alert.text,
    });
    return result.ok;
  },
  postSlack: (url, alert) => postSlackWebhook(url, alert),
  logError: (err, message) => logger.error({ err }, message),
};

export function sendModeratorAlertNow(alert: AlertMessage): Promise<unknown> {
  return sendModeratorAlert(alert, moderatorAlertDeps).catch((err) => {
    logger.error({ err }, "Moderator alert failed");
  });
}

/** Fire-and-forget: alert moderators about a report that was just filed. */
export function notifyModeratorsOfReport(report: ReportForAlert): void {
  try {
    void sendModeratorAlertNow(buildNewReportAlert(report));
  } catch (err) {
    logger.error({ err }, "Moderator alert could not be built");
  }
}
