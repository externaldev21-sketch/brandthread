/**
 * Goal alerts for the seller analytics goals (Analytics → Goals).
 *
 * Runs hourly. For every goal's current period it tells the seller, once:
 *  - "reached" when the period-to-date actual hits the target;
 *  - "behind"  when at least half the period has elapsed and the actual is
 *              below 80% of where an even pace would be by now.
 *
 * The seller_goal_alerts unique key (goal, kind, period start, target) is
 * claimed before publishing, so overlapping runs or several API instances
 * never send twice. Editing a goal's target re-arms it once for that target.
 *
 * Delivery goes through publishNotification under the "goals" category, so
 * the seller's Goal alerts switches (push / in-app), quiet hours and the push
 * master switch all apply. Feed rows and pushes open /analytics-goals.
 *
 * Periods use the seller's local calendar when their quiet-hours timezone is
 * known, else UTC (the goals screen uses the device's offset).
 */
import { eq } from "drizzle-orm";
import { db, sellerGoalAlerts, sellerGoalTargets, users } from "@workspace/db";
import { logger } from "../lib/logger";
import { goalPacing, goalWindow, type GoalMetric, type GoalPeriod, GOAL_METRICS, GOAL_PERIODS } from "../lib/sellerInsights";
import { goalActual } from "../routes/analytics-insights";
import { publishNotification } from "../routes/notifications-feed";

const INTERVAL_MS = 60 * 60 * 1000;
/** "Behind" only once at least this share of the period has elapsed. */
export const BEHIND_AFTER_FRACTION = 0.5;
/** "Behind" when the actual is below this share of the even-pace expectation. */
export const BEHIND_PACE_RATIO = 0.8;

export type GoalAlertKind = "reached" | "behind";

/** Minutes east of UTC for an IANA zone at `now`; 0 when unknown. */
export function tzOffsetForZone(zone: string | null | undefined, now: Date): number {
  if (!zone) return 0;
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    }).formatToParts(now);
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
    const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"));
    const floored = Math.floor(now.getTime() / 60_000) * 60_000;
    return Math.round((asUtc - floored) / 60_000);
  } catch {
    return 0;
  }
}

/** Which alert (if any) a goal's current numbers call for. */
export function goalAlertKind(actual: number, target: number, now: Date, window: { start: Date; end: Date }): GoalAlertKind | null {
  if (target <= 0) return null;
  if (actual >= target) return "reached";
  const total = window.end.getTime() - window.start.getTime();
  const frac = total > 0 ? Math.min(1, Math.max(0, (now.getTime() - window.start.getTime()) / total)) : 0;
  if (frac < BEHIND_AFTER_FRACTION || frac >= 1) return null;
  return actual < target * frac * BEHIND_PACE_RATIO ? "behind" : null;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "October", "this week", "Q4", "2026" — the period in the seller's calendar. */
export function periodLabel(period: GoalPeriod, start: Date, tzOffsetMinutes: number): string {
  const local = new Date(start.getTime() + tzOffsetMinutes * 60_000);
  if (period === "week") return "this week";
  if (period === "quarter") return `Q${Math.floor(local.getUTCMonth() / 3) + 1}`;
  if (period === "year") return String(local.getUTCFullYear());
  return MONTHS[local.getUTCMonth()];
}

const METRIC_NOUN: Record<GoalMetric, string> = {
  revenue: "revenue", orders: "orders", units: "units sold", visits: "visits", followers: "new followers",
};

export function formatGoalValue(metric: GoalMetric, value: number): string {
  if (metric === "revenue") {
    const dollars = value / 100;
    return `$${dollars.toLocaleString("en-US", { minimumFractionDigits: Number.isInteger(dollars) ? 0 : 2, maximumFractionDigits: 2 })}`;
  }
  return Math.round(value).toLocaleString("en-US");
}

export function buildGoalAlertMessage(input: {
  kind: GoalAlertKind; metric: GoalMetric; period: GoalPeriod; actual: number; target: number; periodStart: Date; tzOffsetMinutes: number; daysLeft: number;
}): { title: string; body: string } {
  const label = periodLabel(input.period, input.periodStart, input.tzOffsetMinutes);
  const of = `${formatGoalValue(input.metric, input.actual)} of ${formatGoalValue(input.metric, input.target)}`;
  const noun = METRIC_NOUN[input.metric];
  const scope = input.period === "week" ? "weekly" : label;
  if (input.kind === "reached") {
    return { title: "Goal reached", body: `You hit your ${scope} ${noun} goal: ${of}.` };
  }
  const left = input.daysLeft === 1 ? "1 day left" : `${input.daysLeft} days left`;
  return { title: `Behind pace for ${label}`, body: `${of} ${noun}, ${left}.` };
}

export async function runGoalAlerts(now = new Date()): Promise<{ sent: number }> {
  let sent = 0;
  try {
    const goals = await db.select({
      id: sellerGoalTargets.id,
      sellerId: sellerGoalTargets.sellerId,
      metric: sellerGoalTargets.metric,
      period: sellerGoalTargets.period,
      target: sellerGoalTargets.targetValue,
      timezone: users.quietHoursTimezone,
    }).from(sellerGoalTargets)
      .innerJoin(users, eq(users.clerkId, sellerGoalTargets.sellerId))
      .where(eq(users.accountType, "seller"));

    for (const goal of goals) {
      const metric = goal.metric as GoalMetric;
      const period = goal.period as GoalPeriod;
      if (!(GOAL_METRICS as readonly string[]).includes(metric) || !(GOAL_PERIODS as readonly string[]).includes(period)) continue;
      try {
        const tz = tzOffsetForZone(goal.timezone, now);
        const window = goalWindow(period, now, tz);
        const actual = await goalActual(goal.sellerId, metric, window);
        const kind = goalAlertKind(actual, goal.target, now, window);
        if (!kind) continue;

        const [claimed] = await db.insert(sellerGoalAlerts).values({
          goalId: goal.id, sellerId: goal.sellerId, kind, periodStart: window.start, targetValue: goal.target, actualValue: actual,
        }).onConflictDoNothing().returning({ id: sellerGoalAlerts.id });
        if (!claimed) continue;

        const message = buildGoalAlertMessage({
          kind, metric, period, actual, target: goal.target, periodStart: window.start, tzOffsetMinutes: tz,
          daysLeft: goalPacing(actual, goal.target, now, window).daysLeft,
        });
        try {
          await publishNotification({
            userId: goal.sellerId,
            category: "goals",
            type: kind === "reached" ? "goal_reached" : "goal_behind_pace",
            title: message.title,
            body: message.body,
            targetId: goal.id,
            targetType: "analytics_goal",
            cta: "View goals",
          });
          sent += 1;
        } catch (err) {
          // Release the claim so the next run retries this alert.
          await db.delete(sellerGoalAlerts).where(eq(sellerGoalAlerts.id, claimed.id));
          throw err;
        }
      } catch (err) {
        logger.warn({ err, job: "goalAlerts", goalId: goal.id }, "Goal alert failed");
      }
    }
  } catch (err) {
    logger.error({ err, job: "goalAlerts" }, "Goal alert job failed");
  }
  return { sent };
}

export function startGoalAlertsJob(): void {
  setTimeout(() => { void runGoalAlerts(); }, 7 * 60 * 1000);
  setInterval(() => { void runGoalAlerts(); }, INTERVAL_MS);
  logger.info({ job: "goalAlerts", intervalMs: INTERVAL_MS }, "Goal alert job scheduled");
}
