import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import {
  db, manufacturers, manufacturerInviteTokens, manufacturerPayments,
  manufacturerRelationships, sampleOrders, sellerQuoteRequests,
} from "@workspace/db";

const auth = vi.hoisted(() => ({ userId: "" }));
const stripeState = vi.hoisted(() => ({
  sessions: new Map<string, { id: string; url: string; payment_status: string; status: string }>(),
  created: 0,
}));

vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: auth.userId || null }),
  clerkClient: { users: { getUser: async () => null } },
}));
vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: () => void) => { req.clerkUserId = auth.userId; next(); },
  requirePlan: () => (_req: any, _res: any, next: () => void) => next(),
}));
vi.mock("../../middlewares/requireRole", () => ({
  teamContext: () => (_req: any, _res: any, next: () => void) => next(),
}));
vi.mock("../../routes/notifications-feed", () => ({ publishNotification: async () => undefined }));
vi.mock("../../lib/brandthreadEmail", () => ({ sendManufacturerSignupEmail: async () => undefined }));
vi.mock("../../lib/objectStorage", () => ({
  ObjectStorageService: class {
    async getObjectEntityDownloadURL(path: string) { return `https://objects.test${path}`; }
  },
}));
vi.mock("../../lib/stripe", () => ({
  PLATFORM_COMMISSION_RATE: 0.1,
  computeApplicationFeeCents: (amount: number) => Math.round(amount * 0.1),
  requireStripe: () => ({
    accounts: { retrieve: async () => ({ charges_enabled: true, payouts_enabled: true, details_submitted: true }) },
    checkout: {
      sessions: {
        create: async () => {
          const id = `cs_task252_${++stripeState.created}`;
          const session = { id, url: `https://stripe.test/${id}`, payment_status: "unpaid", status: "open" };
          stripeState.sessions.set(id, session);
          return session;
        },
        retrieve: async (id: string) => {
          const session = stripeState.sessions.get(id);
          if (!session) throw new Error(`Unknown session ${id}`);
          return session;
        },
      },
    },
    paymentIntents: { retrieve: async () => ({ status: "succeeded" }) },
  }),
}));

let server: Server;
let base = "";
const prefix = `task252-${crypto.randomBytes(8).toString("hex")}`;
const createdManufacturerIds: string[] = [];
const createdOrderIds: string[] = [];
const createdInviteIds: string[] = [];
const createdQuoteIds: string[] = [];

const users = {
  sellerA: `${prefix}-seller-a`, sellerB: `${prefix}-seller-b`,
  manufacturerA: `${prefix}-manufacturer-a`, manufacturerB: `${prefix}-manufacturer-b`,
};

async function request(path: string, method = "GET", body?: unknown) {
  return fetch(`${base}${path}`, {
    method, headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
function manufacturerBody(name: string) {
  return {
    businessName: name, country: "US", city: "New York", specialty: "Denim",
    description: "Small-batch denim manufacturing", yearsInBusiness: 8, moq: 50,
    priceRange: "$$", bulkTurnaround: "30 days", sampleTurnaround: "7 days",
    contactEmail: `${prefix}@example.test`,
  };
}
async function seedManufacturer(overrides: Partial<typeof manufacturers.$inferInsert> = {}) {
  const [row] = await db.insert(manufacturers).values({
    ...manufacturerBody(`${prefix}-factory-${createdManufacturerIds.length}`),
    clerkId: `${prefix}-mfr-${createdManufacturerIds.length}`,
    status: "active", isPublicDirectory: true, ...overrides,
  }).returning();
  createdManufacturerIds.push(row.id);
  return row;
}
async function seedOrder(manufacturerId: string, sellerId: string, status = "payment_received") {
  const [row] = await db.insert(sampleOrders).values({
    manufacturerId, sellerId, orderType: "sample", title: `${prefix} Sample`,
    quantity: 1, priceCents: 2500, status,
  }).returning();
  createdOrderIds.push(row.id);
  return row;
}

beforeAll(async () => {
  const [publicRouter, manufacturersRouter, sellerHubRouter, sampleOrdersRouter] = await Promise.all([
    import("../manufacturer-public"), import("../manufacturers"), import("../seller-hub"), import("../sample-orders"),
  ]);
  const app = express();
  app.use((req, _res, next) => { (req as any).log = { error: () => undefined }; next(); });
  app.use(express.json());
  app.use("/api/manufacturers/public", publicRouter.default);
  app.use("/api/manufacturers", manufacturersRouter.default);
  app.use("/api/seller-hub", sellerHubRouter.default);
  app.use("/api/sample-orders", sampleOrdersRouter.default);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  if (createdQuoteIds.length) await db.delete(sellerQuoteRequests).where(inArray(sellerQuoteRequests.id, createdQuoteIds.splice(0)));
  if (createdInviteIds.length) await db.delete(manufacturerInviteTokens).where(inArray(manufacturerInviteTokens.id, createdInviteIds.splice(0)));
  if (createdOrderIds.length) await db.delete(sampleOrders).where(inArray(sampleOrders.id, createdOrderIds.splice(0)));
  if (createdManufacturerIds.length) {
    const ids = createdManufacturerIds.splice(0);
    await db.delete(manufacturerRelationships).where(inArray(manufacturerRelationships.manufacturerId, ids));
    await db.delete(manufacturerPayments).where(inArray(manufacturerPayments.manufacturerId, ids));
    await db.delete(manufacturers).where(inArray(manufacturers.id, ids));
  }
  stripeState.sessions.clear();
  auth.userId = "";
});
afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

describe("Task 252 manufacturer route integration", () => {
  it("filters public manufacturers, validates details, and keeps applications idempotent/private", async () => {
    const visible = await seedManufacturer({ businessName: `${prefix} Denim USA`, specialty: "Denim" });
    const hidden = await seedManufacturer({ businessName: `${prefix} Hidden`, status: "pending", isPublicDirectory: true });
    const list = await request(`/api/manufacturers/public?q=${encodeURIComponent(prefix)}&country=US&specialty=den`);
    expect(list.status).toBe(200);
    expect((await list.json() as Array<{ id: string }>).map((row) => row.id)).toEqual([visible.id]);
    expect((await request("/api/manufacturers/public/not-a-uuid")).status).toBe(400);
    expect((await request(`/api/manufacturers/public/${hidden.id}`)).status).toBe(404);
    const invalid = await request("/api/manufacturers/public/apply", "POST", { businessName: "Missing fields" });
    expect(invalid.status).toBe(400);
    const payload = { ...manufacturerBody(`${prefix} Applicant`), clientRequestId: `${prefix}-application` };
    const first = await request("/api/manufacturers/public/apply", "POST", payload);
    expect(first.status).toBe(202);
    const result = await first.json() as { id: string; status: string; published: boolean };
    createdManufacturerIds.push(result.id);
    expect(result).toMatchObject({ status: "pending", published: false });
    const retry = await request("/api/manufacturers/public/apply", "POST", payload);
    expect(retry.status).toBe(202);
    expect((await retry.json() as { id: string }).id).toBe(result.id);
  });

  it("creates seller quote requests, validates active manufacturers, isolates sellers, and updates owned requests", async () => {
    const mfr = await seedManufacturer();
    auth.userId = users.sellerA;
    expect((await request("/api/seller-hub/quote-requests", "POST", { manufacturerId: mfr.id })).status).toBe(400);
    expect((await request("/api/seller-hub/quote-requests", "POST", { manufacturerId: crypto.randomUUID(), productName: "Jacket" })).status).toBe(404);
    const created = await request("/api/seller-hub/quote-requests", "POST", { manufacturerId: mfr.id, productName: "Jacket", type: "sample", quantity: 3 });
    expect(created.status).toBe(201);
    const quote = await created.json() as { id: string; status: string; sellerId: string };
    createdQuoteIds.push(quote.id);
    expect(quote).toMatchObject({ status: "submitted", sellerId: users.sellerA });
    auth.userId = users.sellerB;
    expect((await request(`/api/seller-hub/quote-requests/${quote.id}`)).status).toBe(404);
    expect((await request(`/api/seller-hub/quote-requests/${quote.id}`, "PATCH", { status: "cancelled" })).status).toBe(404);
    auth.userId = users.sellerA;
    const updated = await request(`/api/seller-hub/quote-requests/${quote.id}`, "PATCH", { status: "cancelled" });
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({ id: quote.id, status: "cancelled" });
  });

  it("enforces invite seller ownership and invite resolve/register boundaries", async () => {
    auth.userId = users.sellerA;
    const created = await request("/api/manufacturers/invite-tokens", "POST", {
      companyName: "Private Factory", contactName: "Ada", contactEmail: "ada@example.test", notes: "Hello",
    });
    expect(created.status).toBe(201);
    const invite = await created.json() as { id: string; token: string; sellerId: string };
    createdInviteIds.push(invite.id);
    expect(invite.sellerId).toBe(users.sellerA);
    auth.userId = users.sellerB;
    expect((await request("/api/manufacturers/invite-tokens")).status).toBe(200);
    expect(await (await request("/api/manufacturers/invite-tokens")).json()).toEqual([]);
    auth.userId = "";
    expect((await request(`/api/manufacturers/invite-tokens/resolve/${invite.token}`)).status).toBe(200);
    expect((await request(`/api/manufacturers/register-via-invite/${invite.token}`, "POST", manufacturerBody("Private Factory"))).status).toBe(401);
    auth.userId = users.manufacturerA;
    const registered = await request(`/api/manufacturers/register-via-invite/${invite.token}`, "POST", manufacturerBody("Private Factory"));
    expect(registered.status).toBe(201);
    const registeredBody = await registered.json() as { id: string; invitedBySellerId: string };
    createdManufacturerIds.push(registeredBody.id);
    expect(registeredBody.invitedBySellerId).toBe(users.sellerA);
    expect((await request(`/api/manufacturers/invite-tokens/resolve/${invite.token}`)).status).toBe(410);
  });

  it("scopes manufacturer sample orders, requires sequential status updates, and stores payment setup", async () => {
    const mfrA = await seedManufacturer({ clerkId: users.manufacturerA });
    const mfrB = await seedManufacturer({ clerkId: users.manufacturerB });
    const order = await seedOrder(mfrA.id, users.sellerA);
    auth.userId = users.manufacturerB;
    expect((await request(`/api/manufacturers/me/sample-orders/${order.id}`)).status).toBe(404);
    auth.userId = users.manufacturerA;
    expect((await request("/api/manufacturers/me/sample-orders")).status).toBe(200);
    expect((await request(`/api/manufacturers/me/sample-orders/${order.id}`)).status).toBe(200);
    expect((await request(`/api/manufacturers/me/sample-orders/${order.id}/status`, "PATCH", { status: "cut_and_sew", expectedRevision: 1 })).status).toBe(409);
    const advanced = await request(`/api/manufacturers/me/sample-orders/${order.id}/status`, "PATCH", { status: "processing", expectedRevision: 1 });
    expect(advanced.status).toBe(200);
    expect(await advanced.json()).toMatchObject({ status: "processing", revision: 2 });
    expect((await request("/api/manufacturers/me/payment")).status).toBe(200);
    const setup = await request("/api/manufacturers/me/payment", "POST", { method: "bank", accountNumber: "12345678", routingNumber: "110000", bankName: "Test Bank", currency: "USD" });
    expect(setup.status).toBe(200);
    expect(await setup.json()).toMatchObject({ isSetup: true, bankLast4: "5678", bankName: "Test Bank" });
    void mfrB;
  });

  it("handles fake-Stripe checkout/payment success, failure, ownership, and idempotent confirmation", async () => {
    const mfr = await seedManufacturer({ clerkId: users.manufacturerA, stripeAccountId: "acct_task252", paymentSetup: true });
    auth.userId = users.sellerA;
    const createBody = { clientRequestId: `${prefix}-order`, manufacturerId: mfr.id, orderType: "sample", title: "Test sample", quantity: 1, priceCents: 2500 };
    const create = await request("/api/sample-orders", "POST", createBody);
    expect(create.status).toBe(201);
    const order = await create.json() as { id: string; status: string };
    createdOrderIds.push(order.id);
    expect(order.status).toBe("pending_payment");
    const returnUrl = `brandthread://sample-detail?id=${order.id}&paymentReturn=1`;
    const checkout = await request(`/api/sample-orders/${order.id}/checkout-session`, "POST", { returnUrl });
    expect(checkout.status).toBe(201);
    const session = await checkout.json() as { sessionId: string };
    const retryCheckout = await request(`/api/sample-orders/${order.id}/checkout-session`, "POST", { returnUrl });
    expect(retryCheckout.status).toBe(200);
    expect((await retryCheckout.json() as { sessionId: string }).sessionId).toBe(session.sessionId);
    auth.userId = users.sellerB;
    expect((await request(`/api/sample-orders/${order.id}/pay`, "POST")).status).toBe(404);
    auth.userId = users.sellerA;
    const unpaid = await request(`/api/sample-orders/${order.id}/pay`, "POST");
    expect(unpaid.status).toBe(409);
    expect(await unpaid.json()).toMatchObject({ error: "Payment has not succeeded", paymentStatus: "unpaid" });
    stripeState.sessions.get(session.sessionId)!.payment_status = "paid";
    const paid = await request(`/api/sample-orders/${order.id}/pay`, "POST");
    expect(paid.status).toBe(200);
    expect(await paid.json()).toMatchObject({ status: "payment_received", paymentStatus: "paid" });
    const paidRetry = await request(`/api/sample-orders/${order.id}/pay`, "POST");
    expect(paidRetry.status).toBe(200);
    expect(await paidRetry.json()).toMatchObject({ status: "payment_received", paymentStatus: "paid" });
  });
});