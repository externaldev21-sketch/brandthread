/**
 * App Store 5.2 / DMCA workflow against the real development database: public
 * notice intake, takedown, seller notification, strikes + repeat-infringer flag,
 * counter-notice and reinstatement.
 *
 * Only the Clerk boundary, rate limiter and outbound email are mocked.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { eq, inArray, like } from "drizzle-orm";
import { db, ipCaseAuditHistory, ipCases, products, users } from "@workspace/db";

const mail = vi.hoisted(() => ({ takedown: [] as any[], outcome: [] as any[] }));

vi.mock("../../middlewares/requireAuth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../middlewares/requireAuth")>();
  return {
    ...actual,
    requireAuth: (req: any, res: any, next: () => void) => {
      const userId = req.header("x-test-user-id");
      if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
      req.clerkUserId = userId;
      next();
    },
  };
});
vi.mock("../../middlewares/rateLimit", () => ({ rateLimit: () => (_req: any, _res: any, next: () => void) => next() }));
vi.mock("@clerk/express", () => ({
  getAuth: (req: any) => ({ userId: req.header?.("x-test-user-id") || null, sessionId: null }),
  clerkClient: { users: {} },
}));
vi.mock("../../lib/brandthreadEmail", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/brandthreadEmail")>();
  return {
    ...actual,
    sendIpCaseInformationRequestEmail: async () => true,
    sendIpTakedownSellerEmail: async (o: any) => { mail.takedown.push(o); return true; },
    sendIpCounterNoticeOutcomeEmail: async (o: any) => { mail.outcome.push(o); return true; },
  };
});

const RUN = `ipt${crypto.randomBytes(5).toString("hex")}`;
const SELLER = `${RUN}_seller`;
const ADMIN = `${RUN}_admin`;
const BUYER = `${RUN}_buyer`;
const productIds: string[] = [];
let server: Server;
let base = "";

async function call(path: string, options: { method?: string; user?: string | null; body?: unknown } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (options.user) headers["x-test-user-id"] = options.user;
  const response = await fetch(`${base}${path}`, {
    method: options.method ?? "GET", headers,
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
  return { status: response.status, body: await response.json().catch(() => null) as any };
}

const notice = (url: string, extra: Record<string, unknown> = {}) => ({
  channel: "web_notice", claimantName: "Rae Rights", claimantEmail: "rae@example.test", rightsType: "trademark",
  description: "This listing uses our registered trademark without permission.", listingUrl: url,
  goodFaithStatement: true, accuracyStatement: true, signature: "Rae Rights", ...extra,
});

async function newProduct(name: string): Promise<string> {
  const [row] = await db.insert(products).values({ ownerId: SELLER, name, status: "active" }).returning({ id: products.id });
  productIds.push(row.id);
  return row.id;
}

async function fileAndRemove(name: string) {
  const id = await newProduct(name);
  const created = await call("/api/ip-cases", { method: "POST", body: notice(`https://brandthread.app/product/${id}`) });
  expect(created.status).toBe(201);
  const caseId = (await db.select({ id: ipCases.id }).from(ipCases).where(eq(ipCases.publicReference, created.body.caseReference)))[0].id;
  const actioned = await call(`/api/ip-cases/${caseId}`, { method: "PATCH", user: ADMIN, body: { action: "remove_listing", moderatorNotes: "Confirmed" } });
  expect(actioned.status).toBe(200);
  return { id, caseId, reference: created.body.caseReference as string, actioned: actioned.body };
}

beforeAll(async () => {
  process.env.IP_REPEAT_INFRINGER_STRIKES = "2";
  await db.insert(users).values([
    { clerkId: SELLER, email: `${SELLER}@example.test`, name: "Seller", brandName: `Brand ${RUN}`, accountType: "seller", role: "owner", username: `${RUN}s` },
    { clerkId: ADMIN, email: `${ADMIN}@example.test`, name: "Moderator", accountType: "buyer", role: "admin" },
    { clerkId: BUYER, email: `${BUYER}@example.test`, name: "Buyer", accountType: "buyer", role: "buyer", username: `${RUN}b` },
  ]);
  const { default: ipRouter } = await import("../ip-cases");
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as any).log = { error: () => {}, warn: () => {}, info: () => {} }; next(); });
  app.use("/api/ip-cases", ipRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  delete process.env.IP_REPEAT_INFRINGER_STRIKES;
  const cases = await db.select({ id: ipCases.id }).from(ipCases).where(inArray(ipCases.listingProductId, productIds.length ? productIds : ["00000000-0000-0000-0000-000000000000"]));
  if (cases.length) await db.delete(ipCaseAuditHistory).where(inArray(ipCaseAuditHistory.caseId, cases.map((c) => c.id)));
  await db.delete(ipCases).where(eq(ipCases.sellerId, SELLER));
  if (productIds.length) await db.delete(products).where(inArray(products.id, productIds));
  await db.delete(users).where(like(users.clerkId, `${RUN}%`));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("public notice intake", () => {
  it("requires the DMCA statements and a signature on the web form", async () => {
    const id = await newProduct("Intake check");
    const url = `https://brandthread.app/product/${id}`;
    expect((await call("/api/ip-cases", { method: "POST", body: notice(url, { goodFaithStatement: false }) })).status).toBe(400);
    expect((await call("/api/ip-cases", { method: "POST", body: notice(url, { accuracyStatement: false }) })).status).toBe(400);
    expect((await call("/api/ip-cases", { method: "POST", body: notice(url, { signature: "" }) })).status).toBe(400);
  });

  it("creates an ip_case without an account and links the listing and seller from the URL", async () => {
    const id = await newProduct("Linked listing");
    const created = await call("/api/ip-cases", { method: "POST", body: notice(`https://brandthread.app/product/${id}`) });
    expect(created.status).toBe(201);
    expect(created.body.caseReference).toMatch(/^IP-/);
    const [row] = await db.select().from(ipCases).where(eq(ipCases.publicReference, created.body.caseReference));
    expect(row).toMatchObject({ listingProductId: id, sellerId: SELLER, channel: "web_notice", signature: "Rae Rights", goodFaithStatement: true });
    const status = await call(`/api/ip-cases/${created.body.caseReference}/status?token=${created.body.statusToken}`);
    expect(status.body.status).toBe("submitted");
  });

  it("keeps an unmatched URL as a case with no listing (manual review)", async () => {
    const created = await call("/api/ip-cases", { method: "POST", body: notice("https://example.com/somewhere") });
    expect(created.status).toBe(201);
    const [row] = await db.select().from(ipCases).where(eq(ipCases.publicReference, created.body.caseReference));
    expect(row.listingProductId).toBeNull();
    await db.delete(ipCases).where(eq(ipCases.id, row.id));
  });

  it("still accepts the in-app report without web-only statements", async () => {
    const id = await newProduct("App report");
    const created = await call("/api/ip-cases", {
      method: "POST",
      body: { claimantName: "App Claimant", claimantEmail: "a@example.test", rightsType: "counterfeit", description: "This is a counterfeit of our product.", listingProductId: id },
    });
    expect(created.status).toBe(201);
  });
});

describe("takedown, strikes and repeat-infringer flag", () => {
  let first: Awaited<ReturnType<typeof fileAndRemove>>;

  it("restricts moderation to moderators", async () => {
    expect((await call("/api/ip-cases", { user: BUYER })).status).toBe(403);
    expect((await call("/api/ip-cases/repeat-infringers", { user: BUYER })).status).toBe(403);
  });

  it("takes the listing down, notifies the seller, and applies one strike", async () => {
    mail.takedown.length = 0;
    first = await fileAndRemove("Takedown one");
    const [product] = await db.select().from(products).where(eq(products.id, first.id));
    expect(product).toMatchObject({ status: "archived", removalKind: "moderation_removed" });
    const [seller] = await db.select().from(users).where(eq(users.clerkId, SELLER));
    expect(seller.ipStrikeCount).toBe(1);
    expect(seller.ipRepeatInfringer).toBe(false);
    expect(mail.takedown).toHaveLength(1);
    expect(mail.takedown[0]).toMatchObject({ to: `${SELLER}@example.test`, caseReference: first.reference, strikeCount: 1 });
    const [row] = await db.select().from(ipCases).where(eq(ipCases.id, first.caseId));
    expect(row.takedownAt).not.toBeNull();
    expect(row.sellerNotifiedAt).not.toBeNull();
    expect(row.strikeAppliedAt).not.toBeNull();
    expect(first.actioned.sellerStanding).toMatchObject({ ipStrikeCount: 1, ipRepeatInfringer: false, threshold: 2 });
  });

  it("never counts the same case twice", async () => {
    const again = await call(`/api/ip-cases/${first.caseId}`, { method: "PATCH", user: ADMIN, body: { action: "hide_listing" } });
    expect(again.status).toBe(409);
    const [seller] = await db.select().from(users).where(eq(users.clerkId, SELLER));
    expect(seller.ipStrikeCount).toBe(1);
  });

  it("auto-flags the seller at the threshold and shows them to moderators", async () => {
    const second = await fileAndRemove("Takedown two");
    const [seller] = await db.select().from(users).where(eq(users.clerkId, SELLER));
    expect(seller.ipStrikeCount).toBe(2);
    expect(seller.ipRepeatInfringer).toBe(true);
    expect(seller.ipRepeatInfringerFlaggedAt).not.toBeNull();
    expect(second.actioned.sellerStanding.ipRepeatInfringer).toBe(true);
    expect(mail.takedown.at(-1)).toMatchObject({ flaggedRepeatInfringer: true });

    const list = await call("/api/ip-cases/repeat-infringers", { user: ADMIN });
    expect(list.status).toBe(200);
    expect(list.body.threshold).toBe(2);
    expect(list.body.sellers[0]).toMatchObject({ userId: SELLER, ipStrikeCount: 2, ipRepeatInfringer: true });

    const detail = await call(`/api/ip-cases/${second.caseId}`, { user: ADMIN });
    expect(detail.body.sellerStanding.ipRepeatInfringer).toBe(true);
  });

  it("lets a moderator clear the flag", async () => {
    const cleared = await call(`/api/ip-cases/repeat-infringers/${SELLER}/clear`, { method: "POST", user: ADMIN, body: {} });
    expect(cleared.status).toBe(200);
    const [seller] = await db.select().from(users).where(eq(users.clerkId, SELLER));
    expect(seller.ipRepeatInfringer).toBe(false);
    expect(seller.ipStrikeCount).toBe(2);
  });
});

describe("counter-notice", () => {
  it("rejects a counter-notice before any takedown and from anyone but the seller", async () => {
    const id = await newProduct("No takedown yet");
    const created = await call("/api/ip-cases", { method: "POST", body: notice(`https://brandthread.app/product/${id}`) });
    const statement = "This is my own design and I hold the rights to it.";
    const early = await call(`/api/ip-cases/seller/${created.body.caseReference}/counter-notice`, { method: "POST", user: SELLER, body: { statement, goodFaith: true } });
    expect(early.status).toBe(409);
    const stranger = await call(`/api/ip-cases/seller/${created.body.caseReference}/counter-notice`, { method: "POST", user: BUYER, body: { statement, goodFaith: true } });
    expect(stranger.status).toBe(404);
    expect((await call(`/api/ip-cases/seller/${created.body.caseReference}/counter-notice`, { method: "POST", body: { statement, goodFaith: true } })).status).toBe(401);
  });

  it("records the seller's counter-notice, then reinstating restores the listing and removes the strike", async () => {
    const removed = await fileAndRemove("Wrongly removed");
    const [before] = await db.select().from(users).where(eq(users.clerkId, SELLER));
    const statement = "This is my own design and I hold the rights to it.";
    expect((await call(`/api/ip-cases/seller/${removed.reference}/counter-notice`, { method: "POST", user: SELLER, body: { statement: "short", goodFaith: true } })).status).toBe(400);
    const filed = await call(`/api/ip-cases/seller/${removed.reference}/counter-notice`, { method: "POST", user: SELLER, body: { statement, goodFaith: true } });
    expect(filed.status).toBe(201);
    expect((await call(`/api/ip-cases/seller/${removed.reference}/counter-notice`, { method: "POST", user: SELLER, body: { statement, goodFaith: true } })).status).toBe(409);

    const queue = await call("/api/ip-cases?counterNotice=received", { user: ADMIN });
    expect(queue.body.map((c: any) => c.id)).toContain(removed.caseId);

    mail.outcome.length = 0;
    const resolved = await call(`/api/ip-cases/${removed.caseId}/counter-notice/resolve`, { method: "POST", user: ADMIN, body: { outcome: "reinstate", notes: "Seller provided proof of ownership" } });
    expect(resolved.status).toBe(200);
    expect(resolved.body).toMatchObject({ counterNoticeStatus: "reinstated", sellerStrikeCount: before.ipStrikeCount - 1 });
    const [product] = await db.select().from(products).where(eq(products.id, removed.id));
    expect(product).toMatchObject({ status: "active", removalKind: null, deletedAt: null });
    const [after] = await db.select().from(users).where(eq(users.clerkId, SELLER));
    expect(after.ipStrikeCount).toBe(before.ipStrikeCount - 1);
    expect(mail.outcome[0]).toMatchObject({ outcome: "reinstated", caseReference: removed.reference });
    expect((await call(`/api/ip-cases/${removed.caseId}/counter-notice/resolve`, { method: "POST", user: ADMIN, body: { outcome: "uphold" } })).status).toBe(409);
  });

  it("upholding keeps the listing down and the strike in place", async () => {
    const removed = await fileAndRemove("Rightly removed");
    const [before] = await db.select().from(users).where(eq(users.clerkId, SELLER));
    const recorded = await call(`/api/ip-cases/${removed.caseId}/counter-notice`, { method: "POST", user: ADMIN, body: { statement: "Seller emailed a counter-notice on Monday." } });
    expect(recorded.status).toBe(201);
    const resolved = await call(`/api/ip-cases/${removed.caseId}/counter-notice/resolve`, { method: "POST", user: ADMIN, body: { outcome: "uphold" } });
    expect(resolved.body.counterNoticeStatus).toBe("upheld");
    const [product] = await db.select().from(products).where(eq(products.id, removed.id));
    expect(product.removalKind).toBe("moderation_removed");
    const [after] = await db.select().from(users).where(eq(users.clerkId, SELLER));
    expect(after.ipStrikeCount).toBe(before.ipStrikeCount);
    const audit = await call(`/api/ip-cases/${removed.caseId}/audit`, { user: ADMIN });
    expect(audit.body.map((a: any) => a.action)).toEqual(expect.arrayContaining(["counter_notice_received", "counter_notice_upheld", "remove_listing", "seller_notified"]));
  });
});
