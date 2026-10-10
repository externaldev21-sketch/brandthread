import { describe, expect, it, vi } from "vitest";
import {
  ESCALATE_AFTER_HOURS,
  ESCALATION_BATCH_LIMIT,
  alertEmailHtml,
  buildEscalationAlert,
  buildNewReportAlert,
  escalationCutoff,
  moderatorAlertConfig,
  postSlackWebhook,
  runReportEscalation,
  sendModeratorAlert,
  type AlertDeps,
  type ReportForAlert,
} from "../moderatorAlerts";

const now = new Date("2026-10-10T12:00:00Z");
const report = (over: Partial<ReportForAlert> = {}): ReportForAlert => ({
  id: "r1",
  targetType: "post",
  targetLabel: "Summer drop",
  reason: "nudity",
  contentExcerpt: "some reported caption",
  createdAt: new Date(now.getTime() - 13 * 3_600_000),
  ...over,
});

function deps(over: Partial<AlertDeps> = {}): AlertDeps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    listModeratorIds: async () => ["mod_1", "mod_2"],
    sendPush: async (id) => { calls.push(`push:${id}`); return true; },
    sendEmail: async (to) => { calls.push(`email:${to}`); return true; },
    postSlack: async (url) => { calls.push(`slack:${url}`); return true; },
    logError: vi.fn(),
    ...over,
  };
}

describe("moderatorAlertConfig", () => {
  it("is push-only by default and parses optional email and Slack env", () => {
    expect(moderatorAlertConfig({})).toEqual({ emails: [], slackWebhookUrl: null, push: true });
    expect(moderatorAlertConfig({
      MODERATION_ALERT_EMAIL: "safety@brandthread.app, bad-address , ops@brandthread.app",
      MODERATION_SLACK_WEBHOOK_URL: "https://hooks.slack.com/services/T/B/x",
      MODERATION_ALERT_PUSH: "off",
    })).toEqual({
      emails: ["safety@brandthread.app", "ops@brandthread.app"],
      slackWebhookUrl: "https://hooks.slack.com/services/T/B/x",
      push: false,
    });
    expect(moderatorAlertConfig({ MODERATION_SLACK_WEBHOOK_URL: "http://insecure" }).slackWebhookUrl).toBeNull();
  });
});

describe("alert text", () => {
  it("describes a new report without the reporter's identity", () => {
    const alert = buildNewReportAlert(report({ contentExcerpt: "x".repeat(400) }));
    expect(alert.kind).toBe("new_report");
    expect(alert.body).toBe('Nudity report on post "Summer drop".');
    expect(alert.text).toContain("Report ID: r1");
    expect(alert.text).toContain("Settings > Review reports");
    expect(alert.text.split("\n")[1].length).toBeLessThan(170);
  });

  it("summarizes overdue reports in one digest", () => {
    const many = Array.from({ length: 12 }, (_, i) => report({ id: `r${i}`, createdAt: new Date(now.getTime() - (13 + i) * 3_600_000) }));
    const alert = buildEscalationAlert(many, now);
    expect(alert.title).toBe("12 reports waiting over 12 hours");
    expect(alert.body).toContain("Oldest is 24 hours old");
    expect(alert.text).toContain("and 2 more");
    expect(alert.reportIds).toHaveLength(12);
    expect(buildEscalationAlert([report()], now).title).toBe("Report waiting over 12 hours");
  });

  it("escapes HTML in the email body", () => {
    const html = alertEmailHtml(buildNewReportAlert(report({ contentExcerpt: "<script>x</script>" })));
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("sendModeratorAlert", () => {
  it("pushes to every moderator and uses each configured channel", async () => {
    const d = deps();
    const result = await sendModeratorAlert(buildNewReportAlert(report()), d, {
      emails: ["safety@brandthread.app"], slackWebhookUrl: "https://hooks.slack.test/x", push: true,
    });
    expect(result).toEqual({ pushed: 2, emailed: 1, slack: true });
    expect(d.calls.sort()).toEqual(["email:safety@brandthread.app", "push:mod_1", "push:mod_2", "slack:https://hooks.slack.test/x"]);
  });

  it("does nothing when every channel is off", async () => {
    const d = deps();
    expect(await sendModeratorAlert(buildNewReportAlert(report()), d, { emails: [], slackWebhookUrl: null, push: false }))
      .toEqual({ pushed: 0, emailed: 0, slack: false });
    expect(d.calls).toEqual([]);
  });

  it("never throws when a channel fails, and the other channels still run", async () => {
    const d = deps({
      listModeratorIds: async () => { throw new Error("db down"); },
      sendEmail: async () => { throw new Error("resend down"); },
    });
    const result = await sendModeratorAlert(buildNewReportAlert(report()), d, {
      emails: ["safety@brandthread.app"], slackWebhookUrl: "https://hooks.slack.test/x", push: true,
    });
    expect(result.slack).toBe(true);
    expect(d.logError).toHaveBeenCalledTimes(2);
  });
});

describe("postSlackWebhook", () => {
  it("posts JSON text and reports failures as false", async () => {
    const fetchOk = vi.fn(async () => new Response("ok", { status: 200 }));
    expect(await postSlackWebhook("https://hooks.slack.test/x", buildNewReportAlert(report()), fetchOk as never)).toBe(true);
    const [, init] = fetchOk.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body)).text).toContain("New report to review");
    expect(await postSlackWebhook("https://x", buildNewReportAlert(report()), (async () => { throw new Error("net"); }) as never)).toBe(false);
    expect(await postSlackWebhook("https://x", buildNewReportAlert(report()), (async () => new Response("", { status: 500 })) as never)).toBe(false);
  });
});

describe("runReportEscalation", () => {
  it("claims reports older than 12 hours and sends one digest", async () => {
    const claimOverdue = vi.fn(async () => [report(), report({ id: "r2" })]);
    const send = vi.fn(async () => undefined);
    expect(await runReportEscalation(now, { claimOverdue, send })).toBe(2);
    expect(claimOverdue).toHaveBeenCalledWith(escalationCutoff(now), now, ESCALATION_BATCH_LIMIT);
    expect(escalationCutoff(now).getTime()).toBe(now.getTime() - ESCALATE_AFTER_HOURS * 3_600_000);
    expect(send).toHaveBeenCalledTimes(1);
    expect((send.mock.calls[0] as unknown as [{ reportIds: string[] }])[0].reportIds).toEqual(["r1", "r2"]);
  });

  it("is idempotent: nothing claimed means nothing sent", async () => {
    const send = vi.fn();
    expect(await runReportEscalation(now, { claimOverdue: async () => [], send })).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });
});
