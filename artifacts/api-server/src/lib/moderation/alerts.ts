/**
 * Moderator alerts for new reports (BT-369). Terms and the App Review notes
 * promise action within 24 hours, so a new report must reach a person, not
 * just sit in the queue.
 *
 * Channels (each optional, none can crash the report path):
 *   email  MODERATOR_ALERT_EMAILS (comma list); falls back to every active
 *          admin's email. Sent through the existing Resend email lib — skipped
 *          quietly when email isn't configured.
 *   push + in-app  every active admin, via publishNotification.
 *   Slack  MODERATION_SLACK_WEBHOOK_URL (incoming webhook). Off when unset.
 *
 * Throttle: the first report in a quiet period alerts immediately; any more
 * within ALERT_WINDOW_MINUTES collapse into one digest ("4 new reports") sent
 * by the moderation-alerts job when the window closes.
 *
 * Escalation: reports still open after ESCALATE_AFTER_HOURS re-alert once
 * each (report_escalations), hourly.
 */
import { and, asc, eq, isNull, lt, sql } from "drizzle-orm";
import { db, moderationAlertState, reportEscalations, reports, users } from "@workspace/db";
import { renderBrandthreadEmail, sendBrandthreadEmail, escapeHtml } from "../brandthreadEmail";
import { logger } from "../logger";
import { getWebOrigin } from "../webOrigin";

export const ALERT_WINDOW_MINUTES = 5;
export const ESCALATE_AFTER_HOURS = 12;

type ReportLike = { id: string; targetType: string; reason: string; contentExcerpt?: string | null; source?: string | null };

/** ADMIN_DASHBOARD_URL (e.g. https://brandthread.app/manufacturers/admin) overrides the default portal path. */
function adminQueueUrl(): string {
  const explicit = process.env.ADMIN_DASHBOARD_URL?.trim().replace(/\/$/, "");
  if (explicit) return `${explicit}/moderation`;
  const origin = getWebOrigin("");
  return origin ? `${origin.replace(/\/$/, "")}/manufacturers/admin/moderation` : "";
}

export function moderatorAlertEmailsFromEnv(raw = process.env.MODERATOR_ALERT_EMAILS): string[] {
  return [...new Set((raw ?? "").split(",").map((s) => s.trim().toLowerCase()).filter((s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)))];
}

async function activeAdmins(): Promise<{ clerkId: string; email: string | null }[]> {
  return db.select({ clerkId: users.clerkId, email: users.email }).from(users)
    .where(and(eq(users.role, "admin"), isNull(users.suspendedAt), isNull(users.deletedAt)));
}

const label = (s: string) => s.replaceAll("_", " ");

export type AlertMessage = { title: string; body: string; kind: "new" | "digest" | "escalation"; count: number; dedupeKey: string };

export function describeNewReports(count: number, sample: ReportLike | null): AlertMessage {
  if (count <= 1 && sample) {
    return {
      kind: "new", count: 1, dedupeKey: `report-alert/${sample.id}`,
      title: `New report: ${label(sample.targetType)} · ${label(sample.reason)}`,
      body: sample.contentExcerpt ? `"${sample.contentExcerpt.slice(0, 140)}"` : "Open the moderation queue to review it.",
    };
  }
  return {
    kind: "digest", count, dedupeKey: `report-digest/${Date.now()}`,
    title: `${count} new reports to review`,
    body: `${count} reports came in over the last few minutes.`,
  };
}

/** Sends one alert on every configured channel. Never throws. */
export async function sendModeratorAlert(msg: AlertMessage): Promise<{ emails: number; notified: number; slack: boolean }> {
  const out = { emails: 0, notified: 0, slack: false };
  let admins: { clerkId: string; email: string | null }[] = [];
  try { admins = await activeAdmins(); } catch (err) { logger.warn({ err }, "Moderator alert: admin lookup failed"); }
  const url = adminQueueUrl();

  // Email
  const configured = moderatorAlertEmailsFromEnv();
  const recipients = configured.length ? configured : [...new Set(admins.map((a) => a.email?.trim().toLowerCase()).filter((e): e is string => !!e))];
  if (recipients.length) {
    let html = "";
    try {
      html = renderBrandthreadEmail({
        preheader: msg.title,
        eyebrow: "Moderation",
        title: msg.title,
        bodyHtml: `<p>${escapeHtml(msg.body)}</p><p>Reports must be reviewed within 24 hours.</p>`,
        ...(url ? { cta: { label: "Open the queue", url } } : {}),
      });
    } catch (err) { logger.warn({ err }, "Moderator alert: email render failed"); }
    if (html) {
      const results = await Promise.all(recipients.map((to) =>
        sendBrandthreadEmail({ to, subject: msg.title, html, idempotencyKey: `${msg.dedupeKey}/${to}` }).catch(() => false)));
      out.emails = results.filter(Boolean).length;
    }
  }

  // Push + in-app to every admin. Loaded lazily: the report paths that call
  // this sit underneath the notifications router's own imports.
  const { publishNotification } = await import("../../routes/notifications-feed");
  const sent = await Promise.all(admins.map((a) => publishNotification({
    userId: a.clerkId,
    category: "system",
    type: "moderation_alert",
    title: msg.title,
    body: msg.body,
    targetType: "moderation",
    cta: "Review",
    pushCategory: "announcement",
    pushKind: "transactional",
  }).then(() => true).catch((err) => { logger.warn({ err, userId: a.clerkId }, "Moderator alert: notification failed"); return false; })));
  out.notified = sent.filter(Boolean).length;

  // Slack (optional)
  const hook = process.env.MODERATION_SLACK_WEBHOOK_URL?.trim();
  if (hook) {
    try {
      const r = await fetch(hook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: `*${msg.title}*\n${msg.body}${url ? `\n<${url}|Open the queue>` : ""}` }),
        signal: AbortSignal.timeout(5_000),
      });
      out.slack = r.ok;
    } catch (err) { logger.warn({ err }, "Moderator alert: Slack webhook failed"); }
  }
  return out;
}

async function lockedState(tx: any) {
  await tx.insert(moderationAlertState).values({ id: "default" }).onConflictDoNothing();
  const [row] = await tx.select().from(moderationAlertState).where(eq(moderationAlertState.id, "default")).for("update").limit(1);
  return row as typeof moderationAlertState.$inferSelect;
}

/**
 * Called after every report insert. Alerts at once when the window is quiet,
 * otherwise adds to the pending digest. Never throws.
 */
export async function alertModeratorsOfReport(report: ReportLike, now = new Date()): Promise<"sent" | "queued" | "failed"> {
  try {
    const decision = await db.transaction(async (tx) => {
      const state = await lockedState(tx);
      const windowOpen = state.lastSentAt && now.getTime() - state.lastSentAt.getTime() < ALERT_WINDOW_MINUTES * 60_000;
      if (windowOpen) {
        await tx.update(moderationAlertState).set({
          pendingCount: state.pendingCount + 1, pendingSince: state.pendingSince ?? now, updatedAt: now,
        }).where(eq(moderationAlertState.id, "default"));
        return { send: false as const };
      }
      const count = state.pendingCount + 1;
      await tx.update(moderationAlertState).set({ lastSentAt: now, pendingCount: 0, pendingSince: null, updatedAt: now })
        .where(eq(moderationAlertState.id, "default"));
      return { send: true as const, count };
    });
    if (!decision.send) return "queued";
    await sendModeratorAlert(describeNewReports(decision.count, report));
    return "sent";
  } catch (err) {
    logger.error({ err, reportId: report.id }, "Moderator alert failed");
    return "failed";
  }
}

/** Fire-and-forget wrapper for report insert paths. */
export function notifyModerators(report: ReportLike): void {
  void alertModeratorsOfReport(report);
}

/** Job step (every minute): send the collapsed digest once its window has closed. */
export async function flushModeratorAlertDigest(now = new Date()): Promise<number> {
  const count = await db.transaction(async (tx) => {
    const state = await lockedState(tx);
    if (state.pendingCount <= 0) return 0;
    if (state.lastSentAt && now.getTime() - state.lastSentAt.getTime() < ALERT_WINDOW_MINUTES * 60_000) return 0;
    await tx.update(moderationAlertState).set({ lastSentAt: now, pendingCount: 0, pendingSince: null, updatedAt: now })
      .where(eq(moderationAlertState.id, "default"));
    return state.pendingCount;
  });
  if (count > 0) await sendModeratorAlert(describeNewReports(count, null));
  return count;
}

/**
 * Job step (hourly): re-alert once for every report still open after
 * ESCALATE_AFTER_HOURS. Advisory try-lock so concurrent instances don't both send.
 */
export async function escalateOverdueReports(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - ESCALATE_AFTER_HOURS * 3_600_000);
  const claimed = await db.transaction(async (tx) => {
    const lock = await tx.execute(sql`SELECT pg_try_advisory_xact_lock(hashtext('job:moderation-escalation')) AS ok`);
    if (!(lock as any).rows?.[0]?.ok) return [];
    const due = await tx.select({ id: reports.id, targetType: reports.targetType, reason: reports.reason, createdAt: reports.createdAt })
      .from(reports)
      .leftJoin(reportEscalations, eq(reportEscalations.reportId, reports.id))
      .where(and(eq(reports.status, "pending"), lt(reports.createdAt, cutoff), isNull(reportEscalations.reportId)))
      .orderBy(asc(reports.createdAt)).limit(500);
    if (due.length === 0) return [];
    const inserted = await tx.insert(reportEscalations).values(due.map((d) => ({ reportId: d.id, escalatedAt: now })))
      .onConflictDoNothing().returning({ reportId: reportEscalations.reportId });
    const ids = new Set(inserted.map((r) => r.reportId));
    return due.filter((d) => ids.has(d.id));
  });
  if (claimed.length === 0) return 0;
  const oldestHours = Math.floor((now.getTime() - claimed[0]!.createdAt.getTime()) / 3_600_000);
  const kinds = [...new Set(claimed.map((c) => label(c.targetType)))].slice(0, 4).join(", ");
  await sendModeratorAlert({
    kind: "escalation", count: claimed.length, dedupeKey: `report-escalation/${claimed.map((c) => c.id).sort()[0]}/${claimed.length}`,
    title: `${claimed.length} report${claimed.length === 1 ? "" : "s"} waiting over ${ESCALATE_AFTER_HOURS} hours`,
    body: `Oldest is ${oldestHours} hours old (${kinds}). Reports must be handled within 24 hours.`,
  });
  return claimed.length;
}


