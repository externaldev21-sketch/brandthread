/**
 * Tells moderators about new reports, and escalates reports nobody has
 * actioned, so the 24-hour review promise (Community Guidelines, Terms,
 * REVIEW_NOTES.md) does not depend on someone opening the admin queue.
 *
 * Channels (each optional, each off when not configured, none can throw into
 * the caller):
 *   - Push to every platform moderator (users.role = 'admin', the same rule
 *     requireModerator uses). Turn off with MODERATION_ALERT_PUSH=off.
 *   - Email to MODERATION_ALERT_EMAIL (comma-separated; needs RESEND_API_KEY,
 *     sent from MAIL_FROM like every other server email).
 *   - Slack incoming webhook MODERATION_SLACK_WEBHOOK_URL.
 *
 * The functions here are pure or take their I/O as `deps`, so they are unit
 * tested without a database or network.
 */

export const ESCALATE_AFTER_HOURS = 12;
export const ESCALATION_BATCH_LIMIT = 50;
const EXCERPT_MAX = 140;
const SLACK_TIMEOUT_MS = 5_000;

export interface ReportForAlert {
  id: string;
  targetType: string;
  targetLabel?: string | null;
  reason: string;
  contentExcerpt?: string | null;
  createdAt: Date | string;
}

export interface ModeratorAlertConfig {
  emails: string[];
  slackWebhookUrl: string | null;
  push: boolean;
}

type Env = Record<string, string | undefined>;

export function moderatorAlertConfig(env: Env = process.env): ModeratorAlertConfig {
  const emails = (env.MODERATION_ALERT_EMAIL ?? "")
    .split(",")
    .map((e) => e.trim())
    .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
  const slack = env.MODERATION_SLACK_WEBHOOK_URL?.trim();
  const slackWebhookUrl = slack && /^https:\/\//.test(slack) ? slack : null;
  const pushFlag = (env.MODERATION_ALERT_PUSH ?? "").trim().toLowerCase();
  const push = !["off", "false", "0"].includes(pushFlag);
  return { emails, slackWebhookUrl, push };
}

export interface AlertMessage {
  /** Short line: push title, email subject. */
  title: string;
  /** One or two sentences: push body. */
  body: string;
  /** Plain-text detail for Slack and the email body. */
  text: string;
  reportIds: string[];
  kind: "new_report" | "escalation";
}

function excerpt(value: string | null | undefined): string | null {
  const clean = value?.replace(/\s+/g, " ").trim();
  if (!clean) return null;
  return clean.length > EXCERPT_MAX ? `${clean.slice(0, EXCERPT_MAX - 1)}…` : clean;
}

function hoursOld(createdAt: Date | string, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - new Date(createdAt).getTime()) / 3_600_000));
}

function describe(report: ReportForAlert): string {
  const target = report.targetType.replace(/_/g, " ");
  const label = report.targetLabel?.trim();
  return `${report.reason.replace(/_/g, " ")} report on ${label ? `${target} "${label}"` : `a ${target}`}`;
}

/** The alert sent once, right after a member files a report. */
export function buildNewReportAlert(report: ReportForAlert): AlertMessage {
  const what = describe(report);
  const quote = excerpt(report.contentExcerpt);
  const lines = [
    `New ${what}.`,
    quote ? `Reported content: "${quote}"` : null,
    `Report ID: ${report.id}`,
    "Review it in the app: Settings > Review reports (24-hour review promise).",
  ].filter(Boolean);
  return {
    kind: "new_report",
    title: "New report to review",
    body: `${what[0].toUpperCase()}${what.slice(1)}.`,
    text: lines.join("\n"),
    reportIds: [report.id],
  };
}

/** One digest for every report that crossed the escalation age in this run. */
export function buildEscalationAlert(reports: ReportForAlert[], now = new Date()): AlertMessage {
  const oldest = Math.max(...reports.map((r) => hoursOld(r.createdAt, now)));
  const count = reports.length;
  const listed = reports.slice(0, 10).map((r) => `- ${describe(r)} (${hoursOld(r.createdAt, now)}h old, ID ${r.id})`);
  const more = count > listed.length ? [`- and ${count - listed.length} more`] : [];
  return {
    kind: "escalation",
    title: count === 1 ? "Report waiting over 12 hours" : `${count} reports waiting over 12 hours`,
    body: `Oldest is ${oldest} hours old. Reports must be actioned within 24 hours.`,
    text: [
      `${count} open ${count === 1 ? "report has" : "reports have"} gone ${ESCALATE_AFTER_HOURS}+ hours without action (oldest ${oldest}h). The review promise is 24 hours.`,
      ...listed,
      ...more,
      "Review them in the app: Settings > Review reports.",
    ].join("\n"),
    reportIds: reports.map((r) => r.id),
  };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function alertEmailHtml(alert: AlertMessage): string {
  const paragraphs = alert.text.split("\n").map((line) => `<p style="margin:0 0 8px">${escapeHtml(line)}</p>`).join("");
  return `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:14px;color:#111">${paragraphs}</div>`;
}

export interface AlertDeps {
  listModeratorIds: () => Promise<string[]>;
  sendPush: (userId: string, alert: AlertMessage) => Promise<unknown>;
  sendEmail: (to: string, alert: AlertMessage) => Promise<boolean>;
  postSlack: (url: string, alert: AlertMessage) => Promise<boolean>;
  logError: (err: unknown, message: string) => void;
}

export interface AlertResult {
  pushed: number;
  emailed: number;
  slack: boolean;
}

/**
 * Sends one alert on every configured channel. Never throws: each channel's
 * failure is logged and the others still run.
 */
export async function sendModeratorAlert(
  alert: AlertMessage,
  deps: AlertDeps,
  config: ModeratorAlertConfig = moderatorAlertConfig(),
): Promise<AlertResult> {
  const result: AlertResult = { pushed: 0, emailed: 0, slack: false };
  const tasks: Promise<void>[] = [];

  if (config.push) {
    tasks.push((async () => {
      const ids = await deps.listModeratorIds();
      const sent = await Promise.allSettled(ids.map((id) => deps.sendPush(id, alert)));
      result.pushed = sent.filter((s) => s.status === "fulfilled").length;
    })());
  }
  for (const to of config.emails) {
    tasks.push((async () => {
      if (await deps.sendEmail(to, alert)) result.emailed += 1;
    })());
  }
  if (config.slackWebhookUrl) {
    const url = config.slackWebhookUrl;
    tasks.push((async () => {
      result.slack = await deps.postSlack(url, alert);
    })());
  }

  const settled = await Promise.allSettled(tasks);
  for (const s of settled) {
    if (s.status === "rejected") deps.logError(s.reason, "Moderator alert channel failed");
  }
  return result;
}

/** Posts to a Slack incoming webhook. Returns false on any failure. */
export async function postSlackWebhook(
  url: string,
  alert: AlertMessage,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SLACK_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: `*${alert.title}*\n${alert.text}` }),
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Escalation ───────────────────────────────────────────────────────────────

export interface EscalationDeps {
  /**
   * Atomically marks up to `limit` open reports created before `cutoff` that
   * were never escalated, and returns them. The marker (reports.escalated_at)
   * is set in the same statement, so two replicas running the job at once
   * never escalate the same report twice.
   */
  claimOverdue: (cutoff: Date, now: Date, limit: number) => Promise<ReportForAlert[]>;
  send: (alert: AlertMessage) => Promise<unknown>;
}

export function escalationCutoff(now: Date): Date {
  return new Date(now.getTime() - ESCALATE_AFTER_HOURS * 3_600_000);
}

/** Returns how many reports were escalated in this run. */
export async function runReportEscalation(now: Date, deps: EscalationDeps): Promise<number> {
  const claimed = await deps.claimOverdue(escalationCutoff(now), now, ESCALATION_BATCH_LIMIT);
  if (claimed.length === 0) return 0;
  await deps.send(buildEscalationAlert(claimed, now));
  return claimed.length;
}
