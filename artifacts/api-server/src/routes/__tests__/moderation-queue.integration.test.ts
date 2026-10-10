/**
 * Moderation queue + moderator alerts (Revenue P1 5/7, BT-369), real Postgres
 * and real routers. Email, push/in-app and Slack senders are recorded, never
 * sent. Covers: permissions, alert on report insert with burst throttle and
 * digest, fallbacks when env is unset, the 12-hour escalation (once per
 * report), warn / timed suspend / ban + expiry, bulk dismiss, DM context
 * limited to the reported conversation, SLA flag, audit rows, problem sellers.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  adminAuditLog, conversations, db, disputes, messages, orders, reportEscalations, reports, userModerationActions, users,
} from "@workspace/db";

vi.hoisted(() => {
  process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ??= "http://127.0.0.1:1";
  process.env.AI_INTEGRATIONS_OPENAI_API_KEY ??= "test-key";
});

const emails: Array<{ to: string; subject: string }> = [];
const notices: Array<{ userId: string; type: string; title: string }> = [];
const slack: Array<{ url: string; body: any }> = [];
let emailThrows = false;

vi.mock("../../middlewares/requireAuth", async (orig) => ({
  ...(await orig<typeof import("../../middlewares/requireAuth")>()),
  requireAuth: (req: any, res: any, next: () => void) => {
    const who = req.headers["x-test-acting-as"];
    if (!who) { res.status(401).json({ error: "Unauthorized" }); return; }
    req.clerkUserId = who;
    next();
  },
}));
vi.mock("@clerk/express", async (orig) => ({
  ...(await orig<typeof import("@clerk/express")>()),
  clerkClient: { users: { banUser: async () => {}, unbanUser: async () => {} } },
}));
vi.mock("../../lib/brandthreadEmail", async (orig) => ({
  ...(await orig<typeof import("../../lib/brandthreadEmail")>()),
  sendBrandthreadEmail: async (o: { to: string; subject: string }) => {
    if (emailThrows) throw new Error("smtp down");
    emails.push({ to: o.to, subject: o.subject });
    return true;
  },
}));
vi.mock("../notifications-feed", async (orig) => ({
  ...(await orig<typeof import("../notifications-feed")>()),
  publishNotification: async (n: { userId: string; type: string; title: string }) => { notices.push({ userId: n.userId, type: n.type, title: n.title }); },
}));

import moderationRouter from "../moderation";
import reportsRouter from "../reports";
import adminRouter from "../admin";
import { auditModerationActions } from "../../lib/admin/moderationAudit";
import {
  ALERT_WINDOW_MINUTES, alertModeratorsOfReport, escalateOverdueReports, flushModeratorAlertDigest, moderatorAlertEmailsFromEnv,
} from "../../lib/moderation/alerts";
import { liftExpiredSuspensions } from "../../lib/moderation/userActions";

const P = `modq${process.pid}${Date.now().toString(36)}`;
const U = (n: string) => `${P}-${n}`;
const ADMIN = U("admin"), MEMBER = U("member"), SELLER = U("seller"), TROLL = U("troll"), FRIEND = U("friend"), STRANGER = U("stranger");

let server: Server;
let base = "";
const realFetch = globalThis.fetch;

function call(user: string | null, path: string, init: RequestInit = {}): Promise<Omit<Response, "json"> & { json(): Promise<any> }> {
  return realFetch(`${base}/api${path}`, { ...init, headers: { "content-type": "application/json", ...(user ? { "x-test-acting-as": user } : {}) } });
}
const get = (u: string | null, p: string) => call(u, p);
const post = (u: string | null, p: string, body?: unknown) => call(u, p, { method: "POST", body: JSON.stringify(body ?? {}) });

async function seedReport(values: Partial<typeof reports.$inferInsert> & { targetType: string; targetId: string }) {
  const [row] = await db.insert(reports).values({ reporterId: MEMBER, reason: "harassment", ...values }).returning();
  return row!;
}
const resetAlerts = () => db.execute(sql`DELETE FROM moderation_alert_state`);
const settle = () => new Promise((r) => setTimeout(r, 150));

beforeAll(async () => {
  vi.stubGlobal("fetch", async (url: any, init?: any) => {
    if (String(url).startsWith("https://hooks.slack.test/")) { slack.push({ url: String(url), body: JSON.parse(init.body) }); return new Response("ok"); }
    return realFetch(url, init);
  });
  const mk = (clerkId: string, extra: Partial<typeof users.$inferInsert> = {}) => ({ clerkId, email: `${clerkId}@example.test`, name: clerkId, ...extra });
  await db.insert(users).values([
    mk(ADMIN, { role: "admin" }),
    mk(MEMBER, { role: "buyer", accountType: "buyer" }),
    mk(SELLER, { role: "owner", accountType: "seller", brandName: "Shady Tees" }),
    mk(TROLL, { role: "buyer", accountType: "buyer", displayName: "Troll" }),
    mk(FRIEND, { role: "buyer", accountType: "buyer", displayName: "Friend" }),
    mk(STRANGER, { role: "buyer", accountType: "buyer" }),
  ]);
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => { req.log = { error() {}, warn() {}, info() {} }; next(); });
  app.use("/api/reports", reportsRouter);
  app.use("/api/moderation", auditModerationActions, moderationRouter);
  app.use("/api/admin", adminRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  delete process.env.MODERATOR_ALERT_EMAILS;
  delete process.env.MODERATION_SLACK_WEBHOOK_URL;
  await resetAlerts();
});

beforeEach(async () => {
  emails.length = 0; notices.length = 0; slack.length = 0; emailThrows = false;
  delete process.env.MODERATOR_ALERT_EMAILS;
  delete process.env.MODERATION_SLACK_WEBHOOK_URL;
  await resetAlerts();
});

describe("permissions", () => {
  it("non-admins get 403 on the new moderation and admin endpoints", async () => {
    const r = await seedReport({ targetType: "profile", targetId: TROLL, targetOwnerId: TROLL });
    expect((await post(MEMBER, "/moderation/reports/bulk-dismiss", { ids: [r.id] })).status).toBe(403);
    expect((await get(MEMBER, `/moderation/reports/${r.id}/context`)).status).toBe(403);
    expect((await post(MEMBER, `/moderation/reports/${r.id}/resolve`, { action: "ban" })).status).toBe(403);
    expect((await get(MEMBER, "/admin/problem-sellers")).status).toBe(403);
    expect((await get(null, "/admin/problem-sellers")).status).toBe(401);
  });
});

describe("moderator alerts (BT-369)", () => {
  it("alerts on a new report by email, push/in-app and Slack, then collapses a burst into one digest", async () => {
    process.env.MODERATOR_ALERT_EMAILS = "safety@brandthread.test, ops@brandthread.test,not-an-email";
    process.env.MODERATION_SLACK_WEBHOOK_URL = "https://hooks.slack.test/T000/B000";
    const [post1] = await db.execute(sql`INSERT INTO posts (user_id, media_url, caption) VALUES (${TROLL}, 'https://example.test/a.jpg', 'buy followers here') RETURNING id`).then((r: any) => r.rows);
    const created = await post(MEMBER, "/reports", { targetType: "post", targetId: post1.id, reason: "spam" });
    expect(created.status).toBe(201);
    await settle();
    expect(emails.map((e) => e.to).sort()).toEqual(["ops@brandthread.test", "safety@brandthread.test"]);
    expect(emails[0]!.subject).toMatch(/New report: post/);
    expect(notices.filter((n) => n.userId === ADMIN && n.type === "moderation_alert")).toHaveLength(1);
    expect(slack).toHaveLength(1);
    expect(slack[0]!.body.text).toContain("New report");

    // Burst: two more inside the window are queued, not sent.
    const t0 = new Date();
    expect(await alertModeratorsOfReport({ id: randomUUID(), targetType: "comment", reason: "hate" }, new Date(t0.getTime() + 60_000))).toBe("queued");
    expect(await alertModeratorsOfReport({ id: randomUUID(), targetType: "message", reason: "scam" }, new Date(t0.getTime() + 120_000))).toBe("queued");
    expect(emails).toHaveLength(2);
    expect(await flushModeratorAlertDigest(new Date(t0.getTime() + 2 * 60_000))).toBe(0); // window still open
    expect(await flushModeratorAlertDigest(new Date(t0.getTime() + (ALERT_WINDOW_MINUTES + 1) * 60_000))).toBe(2);
    expect(emails.at(-1)!.subject).toBe("2 new reports to review");
    expect(await flushModeratorAlertDigest(new Date(t0.getTime() + (ALERT_WINDOW_MINUTES + 2) * 60_000))).toBe(0);
  });

  it("falls back to admin emails, skips Slack when unset, and never throws", async () => {
    expect(moderatorAlertEmailsFromEnv("")).toEqual([]);
    expect(await alertModeratorsOfReport({ id: randomUUID(), targetType: "profile", reason: "scam" })).toBe("sent");
    expect(emails.map((e) => e.to)).toContain(`${ADMIN}@example.test`.toLowerCase());
    expect(slack).toHaveLength(0);

    await resetAlerts();
    emailThrows = true;
    expect(await alertModeratorsOfReport({ id: randomUUID(), targetType: "profile", reason: "scam" })).toBe("sent");
    expect(notices.length).toBeGreaterThan(0); // push still went out
  });

  it("escalates reports open longer than 12 hours exactly once each", async () => {
    const old = await seedReport({ targetType: "profile", targetId: STRANGER, targetOwnerId: STRANGER, createdAt: new Date(Date.now() - 13 * 3_600_000) });
    const fresh = await seedReport({ targetType: "profile", targetId: FRIEND, targetOwnerId: FRIEND });
    const n = await escalateOverdueReports();
    expect(n).toBeGreaterThanOrEqual(1);
    const [esc] = await db.select().from(reportEscalations).where(eq(reportEscalations.reportId, old.id));
    expect(esc).toBeTruthy();
    expect(await db.select().from(reportEscalations).where(eq(reportEscalations.reportId, fresh.id))).toHaveLength(0);
    expect(emails.some((e) => /waiting over 12 hours/.test(e.subject))).toBe(true);
    const before = emails.length;
    expect(await escalateOverdueReports()).toBe(0);
    expect(emails.length).toBe(before);
  });
});

describe("queue actions", () => {
  it("flags overdue reports and filters by type", async () => {
    await seedReport({ targetType: "product", targetId: randomUUID(), targetOwnerId: SELLER, createdAt: new Date(Date.now() - 30 * 3_600_000) });
    const res = await (await get(ADMIN, "/moderation/reports?status=open&type=product&limit=100")).json();
    expect(res.items.every((i: any) => i.targetType === "product")).toBe(true);
    expect(res.items.some((i: any) => i.overdue === true)).toBe(true);
    expect(res.summary.overdue).toBeGreaterThanOrEqual(1);
  });

  it("warns, suspends for a set time (lifted on expiry), bans — each audited", async () => {
    const warnReport = await seedReport({ targetType: "profile", targetId: TROLL, targetOwnerId: TROLL, reason: "harassment" });
    const warned = await post(ADMIN, `/moderation/reports/${warnReport.id}/resolve`, { action: "warn", note: "Keep it civil." });
    expect(warned.status).toBe(200);
    expect(notices.some((n) => n.userId === TROLL && n.type === "moderation_warning")).toBe(true);
    const [troll1] = await db.select().from(users).where(eq(users.clerkId, TROLL));
    expect(troll1!.suspendedAt).toBeNull();

    const badDays = await seedReport({ targetType: "profile", targetId: TROLL, targetOwnerId: TROLL, reporterId: FRIEND });
    expect((await post(ADMIN, `/moderation/reports/${badDays.id}/resolve`, { action: "suspend_user", durationDays: 5 })).status).toBe(400);
    const timed = await post(ADMIN, `/moderation/reports/${badDays.id}/resolve`, { action: "suspend_user", durationDays: 7, note: "Second strike" });
    expect(timed.status).toBe(200);
    const actions = await db.select().from(userModerationActions).where(eq(userModerationActions.userId, TROLL));
    const suspend = actions.find((a) => a.kind === "suspend")!;
    expect(actions.some((a) => a.kind === "warn")).toBe(true);
    expect(suspend.endsAt!.getTime() - Date.now()).toBeGreaterThan(6.9 * 86_400_000);
    expect((await db.select().from(users).where(eq(users.clerkId, TROLL)))[0]!.suspendedAt).not.toBeNull();

    expect(await liftExpiredSuspensions(new Date(Date.now() + 8 * 86_400_000))).toBe(1);
    expect((await db.select().from(users).where(eq(users.clerkId, TROLL)))[0]!.suspendedAt).toBeNull();

    const banReport = await seedReport({ targetType: "profile", targetId: STRANGER, targetOwnerId: STRANGER, reporterId: FRIEND, reason: "scam" });
    expect((await post(ADMIN, `/moderation/reports/${banReport.id}/resolve`, { action: "ban", note: "Scam ring" })).status).toBe(200);
    const [ban] = await db.select().from(userModerationActions).where(and(eq(userModerationActions.userId, STRANGER), eq(userModerationActions.kind, "ban")));
    expect(ban!.endsAt).toBeNull();
    expect(await liftExpiredSuspensions(new Date(Date.now() + 365 * 86_400_000))).toBe(0);

    await settle();
    const logged = await db.select().from(adminAuditLog).where(and(eq(adminAuditLog.actorClerkId, ADMIN), eq(adminAuditLog.action, "moderation.resolve")));
    const ids = logged.map((l) => l.targetId);
    expect(ids).toEqual(expect.arrayContaining([warnReport.id, badDays.id, banReport.id]));
    expect(logged.find((l) => l.targetId === badDays.id)!.metadata).toMatchObject({ action: "suspend_user", durationDays: 7 });
  });

  it("bulk-dismisses open reports and audits it", async () => {
    const a = await seedReport({ targetType: "profile", targetId: FRIEND, targetOwnerId: FRIEND, reporterId: STRANGER, reason: "spam" });
    const b = await seedReport({ targetType: "product", targetId: randomUUID(), targetOwnerId: SELLER, reason: "spam" });
    expect((await post(ADMIN, "/moderation/reports/bulk-dismiss", { ids: ["nope"] })).status).toBe(400);
    const res = await post(ADMIN, "/moderation/reports/bulk-dismiss", { ids: [a.id, b.id], note: "Not violations" });
    expect(await res.json()).toMatchObject({ ok: true });
    const rows = await db.select().from(reports).where(inArray(reports.id, [a.id, b.id]));
    expect(rows.every((r) => r.status === "dismissed")).toBe(true);
    await settle();
    const [audit] = await db.select().from(adminAuditLog).where(and(eq(adminAuditLog.actorClerkId, ADMIN), eq(adminAuditLog.action, "moderation.bulk_dismiss")));
    expect((audit!.metadata as any).ids).toEqual(expect.arrayContaining([a.id, b.id]));
  });

  it("shows a reported DM with only a few lines of context from that conversation", async () => {
    const [conv] = await db.insert(conversations).values({ type: "buyer_to_buyer" }).returning();
    const [other] = await db.insert(conversations).values({ type: "buyer_to_buyer" }).returning();
    const t = Date.now() - 3_600_000;
    const ids: string[] = [];
    for (let i = 0; i < 9; i++) {
      const [m] = await db.insert(messages).values({ conversationId: conv!.id, senderId: i % 2 ? FRIEND : TROLL, body: `line ${i}`, createdAt: new Date(t + i * 1000) } as any).returning();
      ids.push(m!.id);
    }
    await db.insert(messages).values({ conversationId: other!.id, senderId: TROLL, body: "private elsewhere", createdAt: new Date(t + 4500) } as any);
    const r = await seedReport({ targetType: "message", targetId: ids[4]!, targetOwnerId: TROLL, reporterId: FRIEND });
    const ctx = await (await get(ADMIN, `/moderation/reports/${r.id}/context`)).json();
    expect(ctx.messages.map((m: any) => m.body)).toEqual(["line 1", "line 2", "line 3", "line 4", "line 5", "line 6", "line 7"]);
    expect(ctx.messages.find((m: any) => m.reported).body).toBe("line 4");
    expect(ctx.messages.some((m: any) => m.body === "private elsewhere")).toBe(false);
    const nonDm = await (await get(ADMIN, `/moderation/reports/${(await seedReport({ targetType: "profile", targetId: SELLER, targetOwnerId: SELLER, reporterId: FRIEND })).id}/context`)).json();
    expect(nonDm.messages).toBeNull();
  });
});

describe("problem sellers", () => {
  it("ranks sellers by reports, disputes, refunds and late shipments", async () => {
    await seedReport({ targetType: "product", targetId: randomUUID(), targetOwnerId: SELLER, reason: "ip_counterfeit" });
    await seedReport({ targetType: "product", targetId: randomUUID(), targetOwnerId: SELLER, reason: "scam", source: "auto_filter", reporterId: "system:auto-filter" });
    const [o1] = await db.insert(orders).values({ ownerId: SELLER, buyerId: MEMBER, orderNumber: U("o1"), totalCents: 5000, subtotalCents: 5000, paidAt: new Date(), refundedCents: 5000, status: "cancelled" }).returning();
    await db.insert(orders).values({ ownerId: SELLER, buyerId: MEMBER, orderNumber: U("o2"), totalCents: 5000, subtotalCents: 5000, paidAt: new Date(), status: "processing", deliverBy: new Date(Date.now() - 86_400_000) });
    await db.insert(disputes).values({ stripeDisputeId: U("dp"), sellerId: SELLER, orderId: o1!.id, amountCents: 5000 });
    const res = await (await get(ADMIN, "/admin/problem-sellers?days=30&limit=100")).json();
    const row = res.items.find((i: any) => i.clerkId === SELLER);
    expect(row).toMatchObject({ disputes: 1, refundedOrders: 1, orders: 2, lateShipments: 1, filterHits: 1 });
    expect(row.reports.open).toBeGreaterThanOrEqual(2);
    expect(row.refundRate).toBe(0.5);
    expect(row.score).toBeGreaterThan(0);
    const idx = res.items.findIndex((i: any) => i.clerkId === SELLER);
    expect(res.items.slice(0, idx).every((i: any) => i.score >= row.score)).toBe(true);
  });
});

