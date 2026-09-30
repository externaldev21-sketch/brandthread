import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { Resend } from "resend";
import { logger } from "../logger";
import { isMailerConfigured } from "../mailer";
import { getSpendCaps } from "./catalogue";

type AlertInput = {
  day: string;
  clerkUserId: string;
  userSpent?: number;
  globalSpent?: number;
  blocked: "user_daily_cap" | "global_daily_cap" | "insufficient_credits" | null;
};

/** Records (once per day and level) and delivers a spend alert. Returns the alerts that fired. */
async function fireOnce(day: string, scope: string, threshold: number): Promise<boolean> {
  const res = await db.execute(sql`INSERT INTO ai_spend_alerts (day, scope, threshold) VALUES (${day}, ${scope}, ${threshold})
    ON CONFLICT DO NOTHING RETURNING threshold`);
  return res.rows.length > 0;
}

async function deliver(message: string, fields: Record<string, unknown>, severe: boolean): Promise<void> {
  // error level is forwarded to Sentry by the logger hook when SENTRY_DSN is set.
  if (severe) logger.error({ err: new Error(message), ...fields }, message);
  else logger.warn(fields, message);
  const hook = process.env.AI_ALERT_WEBHOOK_URL?.trim();
  if (hook) {
    try {
      await fetch(hook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: `${message} ${JSON.stringify(fields)}` }),
        signal: AbortSignal.timeout(5000),
      });
    } catch (err) {
      logger.warn({ err }, "AI spend alert webhook failed");
    }
  }
  const to = process.env.AI_ALERT_EMAIL?.trim();
  if (to && isMailerConfigured()) {
    try {
      const client = new Resend(process.env.RESEND_API_KEY);
      await client.emails.send({
        from: process.env.MAIL_FROM?.trim() || process.env.RESEND_FROM_EMAIL?.trim() || "alerts@brandthread.app",
        to: [to],
        subject: message,
        html: `<p>${message}</p><pre>${JSON.stringify(fields, null, 2)}</pre>`,
      });
    } catch (err) {
      logger.warn({ err }, "AI spend alert email failed");
    }
  }
}

export async function raiseSpendAlerts(input: AlertInput): Promise<void> {
  const caps = getSpendCaps();
  if (input.globalSpent != null) {
    const pct = (input.globalSpent / caps.globalDaily) * 100;
    for (const threshold of caps.alertThresholds) {
      if (pct >= threshold && (await fireOnce(input.day, "global", threshold))) {
        await deliver(`AI spend: global daily cap at ${threshold}%`, {
          day: input.day, spent: input.globalSpent, cap: caps.globalDaily,
        }, threshold >= 100);
      }
    }
  }
  if (input.blocked === "global_daily_cap" && (await fireOnce(input.day, "global", 101))) {
    await deliver("AI spend: global daily cap reached, AI calls are blocked", { day: input.day, cap: caps.globalDaily }, true);
  }
  if (input.blocked === "user_daily_cap" && (await fireOnce(input.day, `user:${input.clerkUserId}`, 100))) {
    await deliver("AI spend: a user hit the per-user daily cap", {
      day: input.day, userId: input.clerkUserId, cap: caps.perUserDaily,
    }, false);
  }
}
