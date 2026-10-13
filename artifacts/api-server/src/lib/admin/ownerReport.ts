/**
 * Internal owner reports, by email:
 * - Monday numbers: last Monday–Sunday against the week before. Monday at
 *   ADMIN_REPORT_HOUR (default 8) in ADMIN_REPORT_TIMEZONE.
 * - Inactive sellers: each day at that hour, sellers who just crossed 14 days
 *   with no activity. Each quiet streak is reported once.
 *
 * Recipients: ADMIN_REPORT_EMAILS (comma-separated), else every active admin's
 * email. Without Resend configured nothing is sent and nothing is claimed.
 * Numbers come from lib/admin/launchMetrics.ts, the same definitions as the
 * admin Metrics page.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import { adminReportRuns, db, sellerInactivityAlerts, users } from "@workspace/db";
import { logger } from "../logger";
import { escapeHtml, isBrandthreadEmailConfigured, renderBrandthreadEmail, sendBrandthreadEmail } from "../brandthreadEmail";
import {
  INACTIVE_SELLER_DAYS, acquisitionFunnel, activeSellerCount, inactiveSellers, repeatBuyerCohorts, salesTotals,
  sellerRefundChargebackRates, topProducts, topSellers, type InactiveSeller, type SalesTotals,
} from "./launchMetrics";
import { lastFullWeek, reportTimeZone, zonedDateKey, zonedParts } from "./reportCalendar";

const DAY_MS = 86_400_000;

export function reportHour(raw = process.env.ADMIN_REPORT_HOUR): number {
  const h = parseInt(String(raw ?? ""), 10);
  return Number.isInteger(h) && h >= 0 && h <= 23 ? h : 8;
}

export function parseRecipients(raw: string | undefined): string[] {
  return [...new Set((raw ?? "").split(",").map((s) => s.trim().toLowerCase()).filter((s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)))];
}

export async function reportRecipients(): Promise<string[]> {
  const fromEnv = parseRecipients(process.env.ADMIN_REPORT_EMAILS);
  if (fromEnv.length) return fromEnv;
  const admins = await db.select({ email: users.email }).from(users)
    .where(and(eq(users.role, "admin"), isNull(users.suspendedAt), isNull(users.deletedAt)));
  return parseRecipients(admins.map((a) => a.email).join(","));
}

function dashboardUrl(): string | null {
  const raw = process.env.ADMIN_DASHBOARD_URL?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return `${url.origin}${url.pathname.replace(/\/$/, "")}/metrics`;
  } catch {
    return null;
  }
}

// ── Monday numbers ────────────────────────────────────────────────────────────

export type WeeklyReport = {
  weekKey: string; from: Date; to: Date; timeZone: string;
  week: SalesTotals & { activeSellers: number };
  previous: SalesTotals & { activeSellers: number };
  funnel: Awaited<ReturnType<typeof acquisitionFunnel>>;
  latestCohort: { month: string; buyers: number; repeatRate: number } | null;
  topSellers: { name: string; gmvCents: number; orders: number }[];
  topProducts: { name: string; seller: string | null; revenueCents: number; units: number }[];
  flaggedSellers: { name: string; refundRate: number; chargebackRate: number }[];
  inactiveSellerCount: number;
};

export async function buildWeeklyReport(now: Date, tz = reportTimeZone()): Promise<WeeklyReport> {
  const { week, previous, key } = lastFullWeek(now, tz);
  const [w, p, wActive, pActive, funnel, cohorts, sellers, products, risk, inactive] = await Promise.all([
    salesTotals(week), salesTotals(previous), activeSellerCount(week.to), activeSellerCount(previous.to),
    acquisitionFunnel(week), repeatBuyerCohorts(week.to, 3),
    topSellers(week, 3), topProducts(week, 3),
    sellerRefundChargebackRates({ from: new Date(week.to.getTime() - 90 * DAY_MS), to: week.to }),
    inactiveSellers(week.to, { limit: 1000 }),
  ]);
  const mature = cohorts.find((c) => !c.maturing && c.repeatRate != null);
  return {
    weekKey: key, from: week.from, to: week.to, timeZone: tz,
    week: { ...w, activeSellers: wActive }, previous: { ...p, activeSellers: pActive },
    funnel,
    latestCohort: mature ? { month: mature.month, buyers: mature.buyers, repeatRate: mature.repeatRate! } : null,
    topSellers: sellers.map((s) => ({ name: s.name ?? "Unnamed seller", gmvCents: s.gmvCents, orders: s.orders })),
    topProducts: products.map((x) => ({ name: x.name, seller: x.seller, revenueCents: x.revenueCents, units: x.units })),
    flaggedSellers: risk.filter((r) => r.flagged).map((r) => ({ name: r.name ?? "Unnamed seller", refundRate: r.refundRate, chargebackRate: r.chargebackRate })),
    inactiveSellerCount: inactive.length,
  };
}

const usd = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
const monthLabel = (ym: string) => new Date(`${ym}-01T12:00:00Z`).toLocaleString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
const pct = (r: number) => `${(r * 100).toFixed(r > 0 && r < 0.1 ? 1 : 0)}%`;

/** "+12%", "−8%", "new" when last week was zero, "" when both are zero. */
export function weekOverWeek(current: number, previous: number): string {
  if (previous === 0) return current === 0 ? "" : "new";
  const change = (current - previous) / previous;
  const rounded = Math.round(change * 100);
  if (rounded === 0) return "0%";
  return `${rounded > 0 ? "+" : "−"}${Math.abs(rounded)}%`;
}

function rangeLabel(from: Date, to: Date, tz: string): string {
  const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: tz });
  return `${fmt(from)} – ${fmt(new Date(to.getTime() - 1))}`;
}

const ROW = "padding:10px 0;border-bottom:1px solid #eeeeee;";
function table(rows: [string, string, string?][]): string {
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">${rows.map(([label, value, note]) =>
    `<tr><td style="${ROW}color:#666666;vertical-align:top;">${escapeHtml(label)}</td><td align="right" style="${ROW}padding-left:12px;font-weight:700;white-space:nowrap;vertical-align:top;">${escapeHtml(value)}${note ? ` <span style="font-weight:400;color:#888888;">${escapeHtml(note)}</span>` : ""}</td></tr>`).join("")}</table>`;
}
const h = (t: string) => `<h3 style="margin:28px 0 4px;font-size:15px;line-height:20px;color:#111111;">${escapeHtml(t)}</h3>`;

export function renderWeeklyEmail(r: WeeklyReport): { subject: string; html: string } {
  const range = rangeLabel(r.from, r.to, r.timeZone);
  const totals = table([
    ["Gross sales", usd(r.week.gmvCents), weekOverWeek(r.week.gmvCents, r.previous.gmvCents)],
    ["Platform fees", usd(r.week.feesCents), weekOverWeek(r.week.feesCents, r.previous.feesCents)],
    ["Orders", r.week.orders.toLocaleString("en-US"), weekOverWeek(r.week.orders, r.previous.orders)],
    ["New buyers", r.week.newBuyers.toLocaleString("en-US"), weekOverWeek(r.week.newBuyers, r.previous.newBuyers)],
    ["Sign-ups", r.week.signups.toLocaleString("en-US"), weekOverWeek(r.week.signups, r.previous.signups)],
    ["Active sellers", r.week.activeSellers.toLocaleString("en-US"), weekOverWeek(r.week.activeSellers, r.previous.activeSellers)],
  ]);
  const f = r.funnel.installs;
  const funnel = table([
    ["Installs", f.installs.toLocaleString("en-US")],
    ["Signed up", f.signedUp.toLocaleString("en-US"), f.installs ? pct(f.signedUp / f.installs) : undefined],
    ["First purchase", f.purchased.toLocaleString("en-US"), f.signedUp ? pct(f.purchased / f.signedUp) : undefined],
  ]);
  const cohort = r.latestCohort
    ? table([[`Bought again within 30 days, ${monthLabel(r.latestCohort.month)} buyers`, pct(r.latestCohort.repeatRate), `of ${r.latestCohort.buyers.toLocaleString("en-US")}`]])
    : "";
  const sellers = r.topSellers.length ? table(r.topSellers.map((s) => [s.name, usd(s.gmvCents), plural(s.orders, "order")])) : `<p style="color:#666666;">No sales.</p>`;
  const products = r.topProducts.length ? table(r.topProducts.map((p) => [p.seller ? `${p.name} · ${p.seller}` : p.name, usd(p.revenueCents), `${p.units.toLocaleString("en-US")} sold`])) : "";
  const flagged = r.flaggedSellers.length
    ? table(r.flaggedSellers.slice(0, 5).map((s) => [s.name, `${pct(Math.max(s.refundRate, s.chargebackRate))}`, s.chargebackRate > s.refundRate ? "chargebacks" : "refunds"]))
    : "";
  const watch = table([
    ["Sellers over 2% refunds or chargebacks (90 days)", r.flaggedSellers.length.toLocaleString("en-US")],
    [`Sellers inactive ${INACTIVE_SELLER_DAYS}+ days`, r.inactiveSellerCount.toLocaleString("en-US")],
  ]);
  const url = dashboardUrl();
  const html = renderBrandthreadEmail({
    preheader: `${usd(r.week.gmvCents)} in sales, ${r.week.orders} orders, ${r.week.newBuyers} new buyers.`,
    eyebrow: "Monday numbers",
    title: `Week of ${range}`,
    bodyHtml: [totals, h("Install to first purchase"), funnel, cohort && h("Retention"), cohort,
      h("Top sellers"), sellers, products && h("Top products"), products, h("Watch list"), watch, flagged].filter(Boolean).join(""),
    ...(url ? { cta: { label: "Open Metrics", url } } : {}),
  });
  return { subject: `Brandthread week of ${range}: ${usd(r.week.gmvCents)} sales, ${r.week.orders} orders`, html };
}

// ── Inactive-seller digest ────────────────────────────────────────────────────

export function renderInactiveSellersEmail(sellers: InactiveSeller[]): { subject: string; html: string } {
  const n = sellers.length;
  const html = renderBrandthreadEmail({
    preheader: `${n} seller${n === 1 ? "" : "s"} with no activity for ${INACTIVE_SELLER_DAYS} days.`,
    eyebrow: "Inactive sellers",
    title: `${n} seller${n === 1 ? "" : "s"} went quiet`,
    subtitle: `No sale, product edit, post or app open for ${INACTIVE_SELLER_DAYS} days.`,
    bodyHtml: table(sellers.slice(0, 25).map((s) => [
      s.username ? `${s.name ?? "Unnamed seller"} (@${s.username})` : s.name ?? "Unnamed seller",
      `${s.daysInactive} days`,
      plural(s.activeProducts, "live product"),
    ])) + (n > 25 ? `<p style="color:#666666;">And ${n - 25} more on the Metrics page.</p>` : ""),
    ...(dashboardUrl() ? { cta: { label: "Open Metrics", url: dashboardUrl()! } } : {}),
  });
  return { subject: `${n} Brandthread seller${n === 1 ? "" : "s"} inactive for ${INACTIVE_SELLER_DAYS} days`, html };
}

// ── Claim + send ──────────────────────────────────────────────────────────────

async function claim(kind: string, periodKey: string): Promise<boolean> {
  const inserted = await db.insert(adminReportRuns).values({ kind, periodKey })
    .onConflictDoNothing().returning({ kind: adminReportRuns.kind });
  return inserted.length > 0;
}
async function release(kind: string, periodKey: string) {
  await db.delete(adminReportRuns).where(and(eq(adminReportRuns.kind, kind), eq(adminReportRuns.periodKey, periodKey), isNull(adminReportRuns.sentAt)));
}
async function markSent(kind: string, periodKey: string, recipients: number) {
  await db.update(adminReportRuns).set({ sentAt: new Date(), recipients })
    .where(and(eq(adminReportRuns.kind, kind), eq(adminReportRuns.periodKey, periodKey)));
}

async function sendToAll(recipients: string[], mail: { subject: string; html: string }, key: string): Promise<number> {
  let sent = 0;
  for (const to of recipients) {
    if (await sendBrandthreadEmail({ to, ...mail, idempotencyKey: `${key}/${to}` })) sent++;
  }
  return sent;
}

export type ReportOutcome = "sent" | "not_due" | "already_sent" | "skipped_no_email" | "skipped_no_recipients" | "nothing_new" | "failed";

/** Sends the Monday numbers once per week, at or after the report hour on Monday. */
export async function runWeeklyOwnerReport(now = new Date()): Promise<ReportOutcome> {
  const tz = reportTimeZone();
  const local = zonedParts(now, tz);
  if (local.weekday !== 1 || local.hour < reportHour()) return "not_due";
  if (!(await isBrandthreadEmailConfigured())) return "skipped_no_email";
  const recipients = await reportRecipients();
  if (!recipients.length) return "skipped_no_recipients";
  const { key } = lastFullWeek(now, tz);
  if (!(await claim("weekly", key))) return "already_sent";
  try {
    const mail = renderWeeklyEmail(await buildWeeklyReport(now, tz));
    const sent = await sendToAll(recipients, mail, `admin-weekly/${key}`);
    if (sent === 0) { await release("weekly", key); return "failed"; }
    await markSent("weekly", key, sent);
    logger.info({ job: "adminReports", week: key, recipients: sent }, "Monday numbers email sent");
    return "sent";
  } catch (err) {
    await release("weekly", key).catch(() => {});
    throw err;
  }
}

/**
 * Once a day at the report hour: sellers who are inactive for 14+ days and
 * haven't been reported for this quiet streak yet. A streak is identified by
 * the seller's last-activity time, so a seller who comes back and goes quiet
 * again is reported again.
 */
export async function runInactiveSellerDigest(now = new Date()): Promise<ReportOutcome> {
  const tz = reportTimeZone();
  if (zonedParts(now, tz).hour < reportHour()) return "not_due";
  if (!(await isBrandthreadEmailConfigured())) return "skipped_no_email";
  const recipients = await reportRecipients();
  if (!recipients.length) return "skipped_no_recipients";
  const day = zonedDateKey(now, tz);
  if (!(await claim("inactive_sellers", day))) return "already_sent";
  try {
    const all = await inactiveSellers(now, { limit: 1000 });
    const fresh: InactiveSeller[] = [];
    for (const s of all) {
      const inserted = await db.insert(sellerInactivityAlerts)
        .values({ sellerId: s.clerkId, inactiveSince: new Date(s.lastActiveAt) })
        .onConflictDoNothing().returning({ id: sellerInactivityAlerts.sellerId });
      if (inserted.length) fresh.push(s);
    }
    if (!fresh.length) { await markSent("inactive_sellers", day, 0); return "nothing_new"; }
    const mail = renderInactiveSellersEmail(fresh);
    const sent = await sendToAll(recipients, mail, `admin-inactive/${day}`);
    if (sent === 0) {
      // Let tomorrow's run report them: drop today's streak rows and the claim.
      await db.delete(sellerInactivityAlerts).where(sql`(seller_id, inactive_since) IN (${sql.join(
        fresh.map((s) => sql`(${s.clerkId}, ${new Date(s.lastActiveAt)}::timestamp)`), sql`, `)})`);
      await release("inactive_sellers", day);
      return "failed";
    }
    await markSent("inactive_sellers", day, sent);
    logger.info({ job: "adminReports", day, sellers: fresh.length, recipients: sent }, "Inactive seller digest sent");
    return "sent";
  } catch (err) {
    await release("inactive_sellers", day).catch(() => {});
    throw err;
  }
}
