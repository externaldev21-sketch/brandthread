/**
 * Revenue P1 3/7 — manufacturer trust:
 *  BT-456 terms at signup, BT-457 contact hidden until a paid order,
 *  BT-458 chat contact filter, BT-462 manufacturer emails,
 *  BT-463 private stays private, BT-464 light vetting.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { eq, inArray, like } from "drizzle-orm";
import {
  db, legalAcceptances, manufacturerContactSignals, manufacturerInviteTokens, manufacturerMessages,
  manufacturerRelationships, manufacturerThreads, manufacturers, sampleOrders, sellerQuoteRequests, sellerRfqs,
} from "@workspace/db";
import {
  MANUFACTURER_TERMS_VERSION, OFF_PLATFORM_NOTICE, refreshManufacturerVerification,
} from "../../lib/manufacturerTrust";
import { emailManufacturerNewMessage, emailManufacturerOrderPaid } from "../../lib/manufacturerNotifications";
import { OFF_PLATFORM_MASK } from "../../lib/contentModerator";

const auth = vi.hoisted(() => ({ userId: "" }));
const clerkUsers = vi.hoisted(() => new Map<string, { emailVerified: boolean; email: string }>());
const sent = vi.hoisted(() => ({ emails: [] as Array<{ to: string; subject: string; idempotencyKey?: string }>, notifications: [] as Array<Record<string, unknown>> }));

vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: auth.userId || null }),
  clerkClient: {
    users: {
      getUser: async (id: string) => {
        const user = clerkUsers.get(id);
        if (!user) throw new Error("not found");
        return {
          id,
          primaryEmailAddressId: "email_1",
          primaryEmailAddress: { emailAddress: user.email },
          emailAddresses: [{ id: "email_1", emailAddress: user.email, verification: { status: user.emailVerified ? "verified" : "unverified" } }],
        };
      },
    },
  },
}));
vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: () => void) => {
    if (!auth.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
    req.clerkUserId = auth.userId; next();
  },
  requirePlan: () => (_req: any, _res: any, next: () => void) => next(),
}));
vi.mock("../../middlewares/requireRole", () => ({
  teamContext: () => (_req: any, _res: any, next: () => void) => next(),
}));
vi.mock("../../routes/notifications-feed", () => ({
  publishNotification: async (n: Record<string, unknown>) => { sent.notifications.push(n); },
}));
vi.mock("../../lib/brandthreadEmail", () => ({
  sendManufacturerSignupEmail: async () => true,
  sendBrandthreadEmail: async (options: { to: string; subject: string; idempotencyKey?: string }) => {
    sent.emails.push({ to: options.to, subject: options.subject, idempotencyKey: options.idempotencyKey });
    return true;
  },
  renderBrandthreadEmail: (options: { title: string }) => `<html>${options.title}</html>`,
  escapeHtml: (value: unknown) => String(value ?? ""),
  formatCents: (cents: number) => `$${(cents / 100).toFixed(2)}`,
}));
vi.mock("../../lib/objectStorage", () => ({
  ObjectStorageService: class {
    async getObjectEntityDownloadURL(path: string) { return `https://objects.test${path}`; }
  },
}));
vi.mock("../../lib/stripe", () => ({
  PLATFORM_COMMISSION_RATE: 0.05,
  computeApplicationFeeCents: (amount: number) => Math.round(amount * 0.05),
  requireStripe: () => { throw Object.assign(new Error("Stripe disabled in this test"), { status: 503 }); },
}));

let server: Server;
let base = "";
const prefix = `mtrust-${crypto.randomBytes(6).toString("hex")}`;
const seller = `${prefix}-seller`;
const stranger = `${prefix}-stranger`;
const admin = `${prefix}-admin`;
const manufacturerIds: string[] = [];

async function call(path: string, method = "GET", body?: unknown, as?: string) {
  auth.userId = as ?? "";
  const response = await fetch(`${base}${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

function registration(name: string, extra: Record<string, unknown> = {}) {
  return {
    businessName: `${prefix} ${name}`, country: "Portugal", specialty: "Knitwear", yearsInBusiness: 9, moq: 100,
    priceRange: "$8 - $20", bulkTurnaround: "30 days", sampleTurnaround: "10 days",
    description: "Family knitwear mill with 40 machines. WhatsApp +351 912 345 678 for quick replies.",
    website: "https://example-mill.test", contactEmail: `${prefix}-${name.replace(/\s/g, "")}@example.test`,
    ...extra,
  };
}

async function seedFactory(overrides: Partial<typeof manufacturers.$inferInsert> = {}) {
  const [row] = await db.insert(manufacturers).values({
    verificationStatus: "verified",
    clerkId: `${prefix}-mfr-${manufacturerIds.length}`,
    businessName: `${prefix} Factory ${manufacturerIds.length}`,
    country: "Vietnam", specialty: "Cut & Sew", moq: 200, priceRange: "$5 - $9",
    bulkTurnaround: "35 days", sampleTurnaround: "7 days", status: "active", isPublicDirectory: true,
    website: "https://factory.test", contactEmail: `${prefix}-factory${manufacturerIds.length}@example.test`,
    contactPhone: "+84 90 123 4567",
    description: "Email sales@factory.test for the catalog.",
    ...overrides,
  }).returning();
  manufacturerIds.push(row.id);
  return row;
}

async function seedPaidOrder(manufacturerId: string, sellerId: string, status = "payment_received") {
  const [order] = await db.insert(sampleOrders).values({
    manufacturerId, sellerId, orderType: "sample", title: `${prefix} Sample`, quantity: 1, priceCents: 5000, status,
  }).returning();
  return order;
}

async function openThread(manufacturerId: string, sellerId = seller) {
  const thread = await call("/api/manufacturers/threads", "POST", { manufacturerId }, sellerId);
  expect([200, 201]).toContain(thread.status);
  return thread.body.id as string;
}

beforeAll(async () => {
  const [publicRouter, flowRouter, manufacturersRouter, sellerHubRouter, adminTrustRouter] = await Promise.all([
    import("../manufacturer-public"), import("../manufacturer-flow"), import("../manufacturers"),
    import("../seller-hub"), import("../admin/manufacturerTrust"),
  ]);
  const app = express();
  app.use((req, _res, next) => {
    (req as any).log = { error: () => undefined, warn: () => undefined, info: () => undefined };
    next();
  });
  app.use(express.json());
  app.use("/api/manufacturers/public", publicRouter.default);
  app.use("/api/manufacturers", flowRouter.default);
  app.use("/api/manufacturers", manufacturersRouter.default);
  app.use("/api/seller-hub", sellerHubRouter.default);
  app.use("/api/admin/manufacturer-trust", (req, _res, next) => { (req as any).clerkUserId = admin; next(); }, adminTrustRouter.default);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

beforeEach(() => {
  sent.emails.length = 0;
  sent.notifications.length = 0;
  clerkUsers.clear();
});

afterEach(async () => {
  auth.userId = "";
});

afterAll(async () => {
  if (manufacturerIds.length) {
    await db.delete(manufacturerContactSignals).where(inArray(manufacturerContactSignals.manufacturerId, manufacturerIds));
    await db.delete(sellerQuoteRequests).where(inArray(sellerQuoteRequests.manufacturerId, manufacturerIds));
    await db.delete(sampleOrders).where(inArray(sampleOrders.manufacturerId, manufacturerIds));
    await db.delete(manufacturerThreads).where(inArray(manufacturerThreads.manufacturerId, manufacturerIds));
    await db.delete(manufacturerRelationships).where(inArray(manufacturerRelationships.manufacturerId, manufacturerIds));
    await db.delete(manufacturerInviteTokens).where(like(manufacturerInviteTokens.sellerId, `${prefix}%`));
    await db.delete(manufacturers).where(inArray(manufacturers.id, manufacturerIds));
  }
  await db.delete(sellerRfqs).where(like(sellerRfqs.sellerId, `${prefix}%`));
  await db.delete(legalAcceptances).where(like(legalAcceptances.clerkId, `${prefix}%`));
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

describe("BT-456 manufacturer terms at signup", () => {
  it("rejects registration without accepting the current Manufacturer Terms", async () => {
    const user = `${prefix}-noterms`;
    const missing = await call("/api/manufacturers/register", "POST", registration("No Terms"), user);
    expect(missing.status).toBe(400);
    expect(missing.body).toMatchObject({ code: "TERMS_REQUIRED", termsVersion: MANUFACTURER_TERMS_VERSION });
    const stale = await call("/api/manufacturers/register", "POST", registration("No Terms", { acceptedTermsVersion: "2020-01-01" }), user);
    expect(stale.status).toBe(400);
    const [row] = await db.select().from(manufacturers).where(eq(manufacturers.clerkId, user));
    expect(row).toBeUndefined();
  });

  it("records the acceptance and starts the profile as pending verification", async () => {
    const user = `${prefix}-terms`;
    const created = await call("/api/manufacturers/register", "POST", registration("Terms Mill", { acceptedTermsVersion: MANUFACTURER_TERMS_VERSION }), user);
    expect(created.status).toBe(201);
    manufacturerIds.push(created.body.id);
    expect(created.body).toMatchObject({
      verificationStatus: "pending_verification", termsVersion: MANUFACTURER_TERMS_VERSION, isPublicDirectory: true, status: "active",
    });
    const history = await db.select().from(legalAcceptances).where(eq(legalAcceptances.clerkId, user));
    expect(history.map((row) => row.version)).toEqual([`manufacturer-terms/${MANUFACTURER_TERMS_VERSION}`]);
  });

  it("requires acceptance on register-via-invite for a new profile", async () => {
    const invite = await call("/api/manufacturers/invite-tokens", "POST", { companyName: "Invited Mill" }, seller);
    expect(invite.status).toBe(201);
    const user = `${prefix}-invited`;
    expect((await call(`/api/manufacturers/register-via-invite/${invite.body.token}`, "POST", registration("Invited Mill"), user)).status).toBe(400);
    const ok = await call(`/api/manufacturers/register-via-invite/${invite.body.token}`, "POST",
      registration("Invited Mill", { acceptedTermsVersion: MANUFACTURER_TERMS_VERSION }), user);
    expect(ok.status).toBe(201);
    manufacturerIds.push(ok.body.id);
    expect(ok.body).toMatchObject({ isPublicDirectory: false, verificationStatus: "pending_verification" });
    const history = await db.select().from(legalAcceptances).where(eq(legalAcceptances.clerkId, user));
    expect(history).toHaveLength(1);
  });
});

describe("BT-464 light vetting", () => {
  it("keeps a pending manufacturer out of the directory and blocks payable cards until verified", async () => {
    const user = `${prefix}-vetting`;
    const created = await call("/api/manufacturers/register", "POST",
      registration("Vetting Mill", { acceptedTermsVersion: MANUFACTURER_TERMS_VERSION, contactPhone: "" }), user);
    expect(created.status).toBe(201);
    const id = created.body.id as string;
    manufacturerIds.push(id);

    const directory = await call(`/api/manufacturers/public?q=${encodeURIComponent("Vetting Mill")}`);
    expect(directory.body.map((row: any) => row.id)).not.toContain(id);
    expect((await call(`/api/manufacturers/public/${id}`)).status).toBe(404);
    const hub = await call("/api/seller-hub/manufacturers?limit=100", "GET", undefined, stranger);
    expect(hub.body.map((row: any) => row.id)).not.toContain(id);

    clerkUsers.set(user, { emailVerified: false, email: "mill@example.test" });
    const pending = await call("/api/manufacturers/me/verification", "GET", undefined, user);
    expect(pending.body).toMatchObject({ status: "pending_verification", missing: ["email", "phone", "payouts"] });
    expect(pending.body.message).toBe("Verify your email, add a phone number and finish payout setup.");

    // A seller thread exists (the seller found them some other way), but no cards yet.
    await db.insert(manufacturerRelationships).values({ sellerId: seller, manufacturerId: id });
    const threadId = await openThread(id);
    const card = await call(`/api/manufacturers/me/threads/${threadId}/order-cards`, "POST", {
      orderType: "sample", title: "Rib knit sample", quantity: 1, priceCents: 4500, clientRequestId: crypto.randomUUID(),
    }, user);
    expect(card.status).toBe(403);
    expect(card.body).toMatchObject({ code: "VERIFICATION_PENDING", missing: ["email", "phone", "payouts"] });

    // Email verified + phone + Stripe ready → verified automatically.
    clerkUsers.set(user, { emailVerified: true, email: "mill@example.test" });
    await db.update(manufacturers).set({ contactPhone: "+351 912 345 678", paymentSetup: true }).where(eq(manufacturers.id, id));
    const verified = await call("/api/manufacturers/me/verification", "GET", undefined, user);
    expect(verified.body).toMatchObject({ status: "verified", missing: [], message: null });
    const listed = await call(`/api/manufacturers/public?q=${encodeURIComponent("Vetting Mill")}`);
    expect(listed.body.map((row: any) => row.id)).toContain(id);
    const cardAfter = await call(`/api/manufacturers/me/threads/${threadId}/order-cards`, "POST", {
      orderType: "sample", title: "Rib knit sample", quantity: 1, priceCents: 4500, clientRequestId: crypto.randomUUID(),
    }, user);
    expect(cardAfter.status).toBe(201);
  });

  it("verifies from the Stripe account.updated payload only when nothing is past due", async () => {
    const factory = await seedFactory({ verificationStatus: "pending_verification", contactPhone: "+84 90 123 4567" });
    clerkUsers.set(factory.clerkId!, { emailVerified: true, email: "f@example.test" });
    const pastDue = await refreshManufacturerVerification(factory.id, { stripeAccount: {
      charges_enabled: true, payouts_enabled: true, details_submitted: true, requirements: { past_due: ["external_account"] },
    } });
    expect(pastDue).toMatchObject({ status: "pending_verification", gaps: ["payouts"], changed: false });
    const recipient = await refreshManufacturerVerification(factory.id, { stripeAccount: {
      charges_enabled: false, payouts_enabled: true, details_submitted: true,
      capabilities: { transfers: "active" }, tos_acceptance: { service_agreement: "recipient" }, requirements: { past_due: [] },
    } });
    expect(recipient).toMatchObject({ status: "verified", changed: true });
    const [row] = await db.select().from(manufacturers).where(eq(manufacturers.id, factory.id));
    expect(row.verifiedAt).not.toBeNull();
    expect(row.verificationDecidedBy).toBe("system:auto");
  });

  it("lets an admin approve or reject, and never auto-verifies a rejected profile", async () => {
    const factory = await seedFactory({ verificationStatus: "pending_verification" });
    const rejected = await call(`/api/admin/manufacturer-trust/verification/${factory.id}`, "POST", { decision: "reject", note: "Fake photos" });
    expect(rejected.status).toBe(200);
    expect(rejected.body.verificationStatus).toBe("rejected");
    clerkUsers.set(factory.clerkId!, { emailVerified: true, email: "f@example.test" });
    await db.update(manufacturers).set({ paymentSetup: true }).where(eq(manufacturers.id, factory.id));
    expect((await refreshManufacturerVerification(factory.id)).status).toBe("rejected");
    const list = await call("/api/admin/manufacturer-trust/verification?status=rejected&limit=100");
    expect(list.body.items.map((row: any) => row.id)).toContain(factory.id);
    const approved = await call(`/api/admin/manufacturer-trust/verification/${factory.id}`, "POST", { decision: "approve" });
    expect(approved.body.verificationStatus).toBe("verified");
    expect((await call(`/api/admin/manufacturer-trust/verification/${factory.id}`, "POST", { decision: "maybe" })).status).toBe(400);
  });
});

describe("BT-463 private stays private", () => {
  it("lists private manufacturers only to sellers with a relationship and blocks RFQs / quote requests to them", async () => {
    const publicFactory = await seedFactory();
    const privateFactory = await seedFactory({ isPublicDirectory: false });
    const invitedFactory = await seedFactory({ isPublicDirectory: false });
    await db.insert(manufacturerInviteTokens).values({
      sellerId: seller, token: `${prefix}-tok-${crypto.randomBytes(4).toString("hex")}`, usedAt: new Date(), manufacturerId: invitedFactory.id,
    });

    const strangerList = (await call("/api/seller-hub/manufacturers?limit=100", "GET", undefined, stranger)).body.map((row: any) => row.id);
    expect(strangerList).toContain(publicFactory.id);
    expect(strangerList).not.toContain(privateFactory.id);
    expect(strangerList).not.toContain(invitedFactory.id);
    const sellerList = (await call("/api/seller-hub/manufacturers?limit=100", "GET", undefined, seller)).body.map((row: any) => row.id);
    expect(sellerList).toContain(invitedFactory.id);
    expect(sellerList).not.toContain(privateFactory.id);

    const rfq = await call("/api/seller-hub/rfqs", "POST", {
      garmentType: "Hoodie", quantity: 300, manufacturerIds: [privateFactory.id, invitedFactory.id],
    }, stranger);
    expect(rfq.status).toBe(404);
    const quote = await call("/api/seller-hub/quote-requests", "POST", {
      manufacturerId: privateFactory.id, productName: "Hoodie",
    }, stranger);
    expect(quote.status).toBe(404);
    expect((await call("/api/manufacturers/relationships", "POST", { manufacturerId: privateFactory.id }, stranger)).status).toBe(404);

    const mixed = await call("/api/seller-hub/rfqs", "POST", {
      garmentType: "Hoodie", quantity: 300, manufacturerIds: [publicFactory.id, privateFactory.id, invitedFactory.id],
    }, seller);
    expect(mixed.status).toBe(201);
    expect(mixed.body.manufacturersCount).toBe(2);
    const targeted = await db.select({ manufacturerId: sellerQuoteRequests.manufacturerId }).from(sellerQuoteRequests)
      .where(eq(sellerQuoteRequests.rfqId, mixed.body.id));
    expect(targeted.map((row) => row.manufacturerId).sort()).toEqual([publicFactory.id, invitedFactory.id].sort());
  });
});

describe("BT-457 contact details hidden until the first paid order", () => {
  it("hides website, email and phone (and masks them in the description) until the seller pays a card", async () => {
    const factory = await seedFactory();
    const before = await call(`/api/manufacturers/partners/${factory.id}`, "GET", undefined, seller);
    expect(before.status).toBe(200);
    expect(before.body).toMatchObject({ website: null, contactEmail: null, contactPhone: null, contactHidden: true, verified: true });
    expect(before.body.description).toContain(OFF_PLATFORM_MASK);
    expect(before.body.description).not.toContain("sales@factory.test");

    const hub = (await call("/api/seller-hub/manufacturers?limit=100", "GET", undefined, seller)).body.find((row: any) => row.id === factory.id);
    expect(hub).toMatchObject({ website: null, contactHidden: true, verified: true });
    expect(hub.contactEmail).toBeUndefined();

    const publicRow = (await call(`/api/manufacturers/public/${factory.id}`)).body;
    expect(publicRow).toMatchObject({ website: null, contactHidden: true, verified: true });
    expect(publicRow.contactEmail).toBeUndefined();

    await seedPaidOrder(factory.id, seller, "pending_payment");
    expect((await call(`/api/manufacturers/partners/${factory.id}`, "GET", undefined, seller)).body.contactHidden).toBe(true);
    await seedPaidOrder(factory.id, seller);
    const after = await call(`/api/manufacturers/partners/${factory.id}`, "GET", undefined, seller);
    expect(after.body).toMatchObject({
      website: "https://factory.test", contactPhone: "+84 90 123 4567", contactHidden: false,
      description: "Email sales@factory.test for the catalog.",
    });
    const hubAfter = (await call("/api/seller-hub/manufacturers?limit=100", "GET", undefined, seller)).body.find((row: any) => row.id === factory.id);
    expect(hubAfter.website).toBe("https://factory.test");
    // Another seller still sees nothing.
    expect((await call(`/api/manufacturers/partners/${factory.id}`, "GET", undefined, stranger)).body.website).toBeNull();
  });
});

describe("BT-458 chat contact filter", () => {
  it("masks contact details both ways before the first paid order, logs signals and posts one notice", async () => {
    const factory = await seedFactory();
    const threadId = await openThread(factory.id);

    const fromSeller = await call(`/api/manufacturers/threads/${threadId}/messages`, "POST", {
      content: "Can you email me at maya.studio (at) gmail (dot) com?", clientRequestId: crypto.randomUUID(),
    }, seller);
    expect(fromSeller.status).toBe(201);
    expect(fromSeller.body.content).toBe(`Can you email me at ${OFF_PLATFORM_MASK}?`);
    expect(fromSeller.body.contactFlags).toEqual(expect.arrayContaining(["email"]));

    const requestId = crypto.randomUUID();
    const fromFactory = await call(`/api/manufacturers/me/threads/${threadId}/messages`, "POST", {
      content: "Sure, WhatsApp me on +84 90 123 4567 and pay by PayPal to save fees", clientRequestId: requestId,
    }, factory.clerkId!);
    expect(fromFactory.status).toBe(201);
    expect(fromFactory.body.content).not.toContain("123 4567");
    expect(fromFactory.body.content).toContain(OFF_PLATFORM_MASK);
    expect(fromFactory.body.contactFlags).toEqual(expect.arrayContaining(["phone", "payment_app", "off_platform_payment"]));
    // A retry with the same request id is the same message, not a conflict.
    const retry = await call(`/api/manufacturers/me/threads/${threadId}/messages`, "POST", {
      content: "Sure, WhatsApp me on +84 90 123 4567 and pay by PayPal to save fees", clientRequestId: requestId,
    }, factory.clerkId!);
    expect(retry.status).toBe(200);
    expect(retry.body.id).toBe(fromFactory.body.id);

    const messages = await db.select().from(manufacturerMessages).where(eq(manufacturerMessages.threadId, threadId));
    expect(messages.filter((m) => m.content === OFF_PLATFORM_NOTICE && m.messageType === "system")).toHaveLength(1);
    expect(messages.some((m) => m.content.includes("gmail"))).toBe(false);

    const signals = await db.select().from(manufacturerContactSignals).where(eq(manufacturerContactSignals.threadId, threadId));
    expect(signals).toHaveLength(2);
    expect(signals.find((s) => s.senderRole === "seller")?.excerpt).toContain("gmail");
    expect(signals.every((s) => s.masked)).toBe(true);

    const adminView = await call("/api/admin/manufacturer-trust/contact-signals?days=1&limit=200");
    expect(adminView.status).toBe(200);
    expect(adminView.body.items.map((row: any) => row.threadId)).toContain(threadId);

    const clean = await call(`/api/manufacturers/threads/${threadId}/messages`, "POST", {
      content: "Sizes 36 38 40 42, MOQ 300 pcs, sample by 2026-11-02 at $14.50", clientRequestId: crypto.randomUUID(),
    }, seller);
    expect(clean.body.content).toBe("Sizes 36 38 40 42, MOQ 300 pcs, sample by 2026-11-02 at $14.50");
    expect(clean.body.contactFlags).toBeNull();
  });

  it("after the first paid order allows contact details but still flags payment steering", async () => {
    const factory = await seedFactory();
    const threadId = await openThread(factory.id);
    await seedPaidOrder(factory.id, seller);
    const contact = await call(`/api/manufacturers/threads/${threadId}/messages`, "POST", {
      content: "My number is +1 415 555 0134 for delivery questions", clientRequestId: crypto.randomUUID(),
    }, seller);
    expect(contact.body.content).toBe("My number is +1 415 555 0134 for delivery questions");
    expect(contact.body.contactFlags).toBeNull();
    const steering = await call(`/api/manufacturers/me/threads/${threadId}/messages`, "POST", {
      content: "For the bulk run you can pay us directly by bank transfer", clientRequestId: crypto.randomUUID(),
    }, factory.clerkId!);
    expect(steering.body.content).toBe("For the bulk run you can pay us directly by bank transfer");
    expect(steering.body.contactFlags).toEqual(expect.arrayContaining(["off_platform_payment"]));
    const signals = await db.select().from(manufacturerContactSignals).where(eq(manufacturerContactSignals.threadId, threadId));
    expect(signals).toHaveLength(1);
    expect(signals[0].masked).toBe(false);
  });
});

describe("BT-462 manufacturer notifications", () => {
  async function waitForEmails(count: number) {
    await vi.waitFor(() => expect(sent.emails.length).toBeGreaterThanOrEqual(count), { timeout: 3000 });
  }

  it("emails and notifies each RFQ target and quote-request recipient", async () => {
    const a = await seedFactory();
    const b = await seedFactory();
    const rfq = await call("/api/seller-hub/rfqs", "POST", {
      garmentType: "Crewneck", quantity: 500, manufacturerIds: [a.id, b.id],
    }, seller);
    expect(rfq.status).toBe(201);
    await waitForEmails(2);
    expect(sent.emails.map((e) => e.to).sort()).toEqual([a.contactEmail, b.contactEmail].sort());
    expect(sent.emails[0].subject).toMatch(/^New request for quote from /);
    expect(sent.notifications.filter((n) => n.type === "manufacturer_quote_request").map((n) => n.userId).sort())
      .toEqual([a.clerkId, b.clerkId].sort());

    sent.emails.length = 0;
    const quote = await call("/api/seller-hub/quote-requests", "POST", { manufacturerId: a.id, productName: "Tote", type: "sample" }, seller);
    expect(quote.status).toBe(201);
    await waitForEmails(1);
    expect(sent.emails[0]).toMatchObject({ to: a.contactEmail, idempotencyKey: `manufacturer-request/${quote.body.id}` });
    expect(sent.emails[0].subject).toMatch(/^New sample request/);
  });

  it("emails at most once per thread every 30 minutes for new seller messages", async () => {
    const factory = await seedFactory();
    const threadId = await openThread(factory.id);
    const now = new Date();
    expect(await emailManufacturerNewMessage({ threadId, manufacturerId: factory.id, sellerName: "Maya", preview: "Hi", now }))
      .toEqual({ emailed: true, throttled: false });
    expect(await emailManufacturerNewMessage({ threadId, manufacturerId: factory.id, sellerName: "Maya", preview: "Hi again", now: new Date(now.getTime() + 10 * 60_000) }))
      .toEqual({ emailed: false, throttled: true });
    expect(await emailManufacturerNewMessage({ threadId, manufacturerId: factory.id, sellerName: "Maya", preview: "Later", now: new Date(now.getTime() + 31 * 60_000) }))
      .toEqual({ emailed: true, throttled: false });

    // Through the route: two quick seller messages → one email.
    const routeThreadId = await openThread((await seedFactory()).id);
    sent.emails.length = 0;
    for (const content of ["First", "Second"]) {
      await call(`/api/manufacturers/threads/${routeThreadId}/messages`, "POST", { content, clientRequestId: crypto.randomUUID() }, seller);
    }
    await waitForEmails(1);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(sent.emails).toHaveLength(1);
    expect(sent.emails[0].subject).toMatch(/^New message from /);
  });

  it("emails the manufacturer when an order card is paid (idempotent key per order)", async () => {
    const factory = await seedFactory();
    const order = await seedPaidOrder(factory.id, seller);
    expect(await emailManufacturerOrderPaid(order.id)).toEqual({ emailed: true });
    expect(sent.emails[0]).toMatchObject({ to: factory.contactEmail, idempotencyKey: `manufacturer-order-paid/${order.id}` });
    expect(await emailManufacturerOrderPaid(crypto.randomUUID())).toEqual({ emailed: false });
  });

  it("falls back to the account email and skips quietly when there is none", async () => {
    const factory = await seedFactory({ contactEmail: null });
    clerkUsers.set(factory.clerkId!, { emailVerified: true, email: "owner@example.test" });
    const order = await seedPaidOrder(factory.id, seller);
    expect(await emailManufacturerOrderPaid(order.id)).toEqual({ emailed: true });
    expect(sent.emails[0].to).toBe("owner@example.test");
    const orphan = await seedFactory({ contactEmail: null });
    const orphanOrder = await seedPaidOrder(orphan.id, seller);
    expect(await emailManufacturerOrderPaid(orphanOrder.id)).toEqual({ emailed: false });
  });
});
