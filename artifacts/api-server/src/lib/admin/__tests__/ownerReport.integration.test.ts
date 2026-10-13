/**
 * Owner reports against a real database: Monday numbers and the inactive
 * seller digest. Email sending is mocked. Data lives in March 2001 so other
 * rows in the shared test database can't change the numbers.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, like } from "drizzle-orm";
import { adminReportRuns, db, orders, products, sellerInactivityAlerts, users } from "@workspace/db";

const sent: { to: string; subject: string; html: string; idempotencyKey?: string }[] = [];
let sendOk = true;
let emailConfigured = true;
vi.mock("../../brandthreadEmail", async (orig) => ({
  ...(await orig<typeof import("../../brandthreadEmail")>()),
  isBrandthreadEmailConfigured: async () => emailConfigured,
  sendBrandthreadEmail: async (m: { to: string; subject: string; html: string; idempotencyKey?: string }) => {
    if (sendOk) sent.push(m);
    return sendOk;
  },
}));

import {
  parseRecipients, renderWeeklyEmail, reportHour, runInactiveSellerDigest, runWeeklyOwnerReport, weekOverWeek,
  buildWeeklyReport,
} from "../ownerReport";

const P = `own${process.pid}`;
const SELLER = `${P}-seller`, QUIET = `${P}-quiet`, BUYER = `${P}-buyer`;
const D = (iso: string) => new Date(iso);
// Monday March 12 2001, 08:00 in Chicago (CST, UTC-6).
const MONDAY_8AM = D("2001-03-12T14:00:00Z");
const WEEK_KEY = "2001-W10";
const DAY_KEY = "2001-03-12";

beforeAll(async () => {
  process.env.ADMIN_REPORT_EMAILS = "dev@example.test, Ops@Example.test, not-an-email";
  delete process.env.ADMIN_REPORT_HOUR;
  delete process.env.ADMIN_REPORT_TIMEZONE;
  await db.insert(users).values([
    { clerkId: SELLER, email: `${SELLER}@example.test`, name: "S", brandName: `${P} Northbound`, accountType: "seller", createdAt: D("2001-01-01T00:00:00Z") },
    { clerkId: QUIET, email: `${QUIET}@example.test`, name: "Q", brandName: `${P} Paper Moon`, username: `${P}moon`, accountType: "seller", createdAt: D("2001-01-01T00:00:00Z") },
    { clerkId: BUYER, email: `${BUYER}@example.test`, name: "B", accountType: "buyer", createdAt: D("2001-03-06T00:00:00Z") },
  ]);
  await db.insert(products).values([
    { ownerId: SELLER, name: `${P} Hoodie`, status: "active", updatedAt: D("2001-03-10T00:00:00Z") },
    { ownerId: QUIET, name: `${P} Cap`, status: "active", updatedAt: D("2001-02-20T00:00:00Z"), createdAt: D("2001-02-01T00:00:00Z") },
  ]);
  const o = (n: number, paidAt: string, total: number) => ({
    ownerId: SELLER, buyerId: BUYER, orderNumber: `${P}-${n}`, totalCents: total, subtotalCents: total,
    platformFeeCents: Math.round(total * 0.05), status: "shipped", paidAt: D(paidAt),
  });
  await db.insert(orders).values([
    o(1, "2001-03-06T18:00:00Z", 12_000), // reported week (Mar 5–11)
    o(2, "2001-03-09T18:00:00Z", 8_000),
    o(3, "2001-02-28T18:00:00Z", 10_000), // week before
  ]);
});

beforeEach(async () => {
  sent.length = 0; sendOk = true; emailConfigured = true;
  await db.delete(adminReportRuns).where(like(adminReportRuns.periodKey, "2001-%"));
});

afterAll(async () => {
  await db.delete(adminReportRuns).where(like(adminReportRuns.periodKey, "2001-%"));
  await db.delete(sellerInactivityAlerts).where(like(sellerInactivityAlerts.sellerId, `${P}-%`));
  await db.delete(orders).where(like(orders.orderNumber, `${P}-%`));
  await db.delete(products).where(like(products.ownerId, `${P}-%`));
  await db.delete(users).where(like(users.clerkId, `${P}-%`));
  delete process.env.ADMIN_REPORT_EMAILS;
});

describe("helpers", () => {
  it("parses recipients, de-duplicated and lower-cased, dropping junk", () => {
    expect(parseRecipients(" a@x.io, A@X.io ,nope, b@y.co ")).toEqual(["a@x.io", "b@y.co"]);
    expect(parseRecipients(undefined)).toEqual([]);
  });
  it("defaults the report hour to 8", () => {
    expect(reportHour(undefined)).toBe(8);
    expect(reportHour("7")).toBe(7);
    expect(reportHour("25")).toBe(8);
  });
  it("formats week-over-week change", () => {
    expect(weekOverWeek(120, 100)).toBe("+20%");
    expect(weekOverWeek(80, 100)).toBe("−20%");
    expect(weekOverWeek(5, 0)).toBe("new");
    expect(weekOverWeek(0, 0)).toBe("");
    expect(weekOverWeek(100, 100)).toBe("0%");
  });
});

describe("Monday numbers", () => {
  it("reports last Monday–Sunday against the week before", async () => {
    const r = await buildWeeklyReport(MONDAY_8AM, "America/Chicago");
    expect(r.weekKey).toBe(WEEK_KEY);
    expect(r.week.gmvCents).toBeGreaterThanOrEqual(20_000);
    const mine = r.topSellers.find((s) => s.name === `${P} Northbound`);
    expect(mine).toEqual({ name: `${P} Northbound`, gmvCents: 20_000, orders: 2 });
    const { subject, html } = renderWeeklyEmail(r);
    expect(subject).toMatch(/^Brandthread week of Mar 5 – Mar 11: /);
    expect(html).toContain("Gross sales");
    expect(html).toContain(`${P} Northbound`);
    expect(html).toContain("Watch list");
  });

  it("sends once per week to every recipient, only on Monday from the report hour", async () => {
    expect(await runWeeklyOwnerReport(D("2001-03-12T13:00:00Z"))).toBe("not_due"); // 7am
    expect(await runWeeklyOwnerReport(D("2001-03-13T15:00:00Z"))).toBe("not_due"); // Tuesday
    expect(await runWeeklyOwnerReport(MONDAY_8AM)).toBe("sent");
    expect(sent.map((s) => s.to).sort()).toEqual(["dev@example.test", "ops@example.test"]);
    expect(sent[0]!.idempotencyKey).toBe(`admin-weekly/${WEEK_KEY}/${sent[0]!.to}`);
    expect(await runWeeklyOwnerReport(D("2001-03-12T15:00:00Z"))).toBe("already_sent");
    expect(sent).toHaveLength(2);
    const [run] = await db.select().from(adminReportRuns)
      .where(and(eq(adminReportRuns.kind, "weekly"), eq(adminReportRuns.periodKey, WEEK_KEY)));
    expect(run!.sentAt).toBeInstanceOf(Date);
    expect(run!.recipients).toBe(2);
  });

  it("releases the claim when every send fails, so the next hour retries", async () => {
    sendOk = false;
    expect(await runWeeklyOwnerReport(MONDAY_8AM)).toBe("failed");
    sendOk = true;
    expect(await runWeeklyOwnerReport(D("2001-03-12T15:00:00Z"))).toBe("sent");
  });

  it("does nothing and claims nothing without email configured", async () => {
    emailConfigured = false;
    expect(await runWeeklyOwnerReport(MONDAY_8AM)).toBe("skipped_no_email");
    expect(await db.select().from(adminReportRuns).where(eq(adminReportRuns.periodKey, WEEK_KEY))).toHaveLength(0);
  });
});

describe("inactive seller digest", () => {
  it("reports a seller once per quiet streak, never an active one", async () => {
    expect(await runInactiveSellerDigest(MONDAY_8AM)).toBe("sent");
    const html = sent.map((s) => s.html).join("");
    expect(html).toContain(`${P} Paper Moon`);
    expect(html).not.toContain(`${P} Northbound`);
    expect(sent[0]!.subject).toMatch(/inactive for 14 days$/);

    // Next day: same streak, not reported again.
    sent.length = 0;
    expect(await runInactiveSellerDigest(D("2001-03-13T14:00:00Z"))).not.toBe("failed");
    expect(sent.map((s) => s.html).join("")).not.toContain(`${P} Paper Moon`);

    // Same day again: already claimed.
    expect(await runInactiveSellerDigest(D("2001-03-13T16:00:00Z"))).toBe("already_sent");

    const rows = await db.select().from(sellerInactivityAlerts).where(eq(sellerInactivityAlerts.sellerId, QUIET));
    expect(rows).toHaveLength(1);
  });

  it("puts sellers back for the next day when the email fails", async () => {
    await db.delete(sellerInactivityAlerts).where(eq(sellerInactivityAlerts.sellerId, QUIET));
    sendOk = false;
    expect(await runInactiveSellerDigest(D("2001-03-14T14:00:00Z"))).toBe("failed");
    expect(await db.select().from(sellerInactivityAlerts).where(eq(sellerInactivityAlerts.sellerId, QUIET))).toHaveLength(0);
    sendOk = true;
    expect(await runInactiveSellerDigest(D("2001-03-14T15:00:00Z"))).toBe("sent");
    expect(sent.map((s) => s.html).join("")).toContain(`${P} Paper Moon`);
  });

  it("waits for the report hour", async () => {
    expect(await runInactiveSellerDigest(D("2001-03-15T12:00:00Z"))).toBe("not_due");
  });
});
