/**
 * Packer seat (item 58): a team member who only sees and ships orders.
 *
 * The routers are mounted exactly as routes/index.ts mounts them (index-level
 * `tc` where index adds it), so the central deny-by-default guard in
 * middlewares/packerAccess.ts is exercised through the real team-context
 * middlewares — not a mock of them.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import crypto from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { inArray } from "drizzle-orm";
import { customers, db, orderItems, orders, teamMembers, users } from "@workspace/db";

vi.mock("@clerk/express", () => ({
  getAuth: (req: any) => ({ userId: req.header?.("x-test-user-id") ?? req.headers?.["x-test-user-id"] ?? null }),
}));
vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: () => void) => {
    const id = req.header("x-test-user-id");
    if (!id) { res.status(401).json({ error: "Unauthorized" }); return; }
    req.clerkUserId = id;
    next();
  },
  requirePlan: () => (_req: any, _res: any, next: () => void) => next(),
}));

const sfx = crypto.randomBytes(5).toString("hex");
const id = (name: string) => `packer-${sfx}-${name}`;
const OWNER = id("owner");
const PACKER = id("packer");
const ORDERS_ROLE = id("orders");
const VIEWER = id("viewer");
const BUYER = id("buyer");
const BUYER_EMAIL = `${BUYER}@buyer.test`;
const ALL_USERS = [OWNER, PACKER, ORDERS_ROLE, VIEWER, BUYER];

let server: Server;
let base = "";
let orderId = "";
let cancelOrderId = "";
let customerId = "";
const membershipIds: string[] = [];

const realFetch = globalThis.fetch;

async function call(method: string, path: string, as: string, body?: unknown) {
  const r = await realFetch(`${base}/api${path}`, {
    method,
    headers: { "Content-Type": "application/json", "x-test-user-id": as },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => null) as any };
}

beforeAll(async () => {
  // Never reach the network (carrier tracking registration, emails).
  vi.stubGlobal("fetch", async (input: any, init?: any) => {
    const url = typeof input === "string" ? input : input.url;
    if (url.startsWith("http://127.0.0.1")) return realFetch(input, init);
    return new Response("{}", { status: 200 });
  });

  await db.insert(users).values(ALL_USERS.map((clerkId) => ({
    clerkId,
    email: clerkId === BUYER ? BUYER_EMAIL : `${clerkId}@test.local`,
    name: clerkId,
    accountType: clerkId === OWNER ? "seller" : "buyer",
    role: clerkId === OWNER ? "owner" : "buyer",
    // Team members have no store of their own, so they act in the joined store.
    onboardingComplete: clerkId === OWNER,
  })));

  const members = await db.insert(teamMembers).values([
    { ownerId: OWNER, memberClerkId: PACKER, email: `${PACKER}@test.local`, name: "Pat Packer", role: "packer", status: "active", acceptedAt: new Date() },
    { ownerId: OWNER, memberClerkId: ORDERS_ROLE, email: `${ORDERS_ROLE}@test.local`, name: "Olly Orders", role: "orders", status: "active", acceptedAt: new Date() },
    { ownerId: OWNER, memberClerkId: VIEWER, email: `${VIEWER}@test.local`, name: "Vic Viewer", role: "viewer", status: "active", acceptedAt: new Date() },
  ]).returning({ id: teamMembers.id });
  membershipIds.push(...members.map((m) => m.id));

  const [customer] = await db.insert(customers).values({
    ownerId: OWNER, name: "Bea Buyer", email: BUYER_EMAIL, phone: "+15550001111",
  } as any).returning({ id: customers.id });
  customerId = customer.id;

  const shippingAddress = {
    name: "Bea Buyer", line1: "1 Parcel Lane", city: "Packton", state: "CA", zip: "90001", country: "US",
    phone: "+15550001111", email: BUYER_EMAIL,
  };
  const [order] = await db.insert(orders).values({
    ownerId: OWNER, buyerId: BUYER, customerId, orderNumber: `PK-${sfx}-1`, status: "pending",
    totalCents: 4200, subtotalCents: 4200, paidAt: new Date(), shippingAddress,
  } as any).returning({ id: orders.id });
  orderId = order.id;
  const [cancelOrder] = await db.insert(orders).values({
    ownerId: OWNER, buyerId: BUYER, orderNumber: `PK-${sfx}-2`, status: "pending",
    totalCents: 1000, subtotalCents: 1000, paidAt: new Date(), shippingAddress,
  } as any).returning({ id: orders.id });
  cancelOrderId = cancelOrder.id;
  await db.insert(orderItems).values({ orderId, productName: "Heavyweight tee", quantity: 2, priceCents: 2100 } as any);

  const { teamContext, requireRole } = await import("../../middlewares/requireRole");
  const tc = teamContext();
  const { default: ordersRouter } = await import("../orders");
  const { default: productsRouter } = await import("../products");
  const { default: customersRouter } = await import("../customers");
  const { default: analyticsRouter } = await import("../analytics");
  const { default: financeRouter } = await import("../finance");
  const { default: teamRouter } = await import("../team");
  const { default: discountCodesRouter } = await import("../discount-codes");
  const { default: shippingLabelsRouter } = await import("../shipping-labels");

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).log = { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} };
    next();
  });
  // Same mounts as routes/index.ts.
  app.use("/api/products", tc, productsRouter);
  app.use("/api/orders", tc, ordersRouter);
  app.use("/api/customers", tc, customersRouter);
  app.use("/api/analytics", tc, analyticsRouter);
  app.use("/api/shipping-labels", shippingLabelsRouter);
  app.use("/api/discount-codes", tc, discountCodesRouter);
  app.use("/api/finance", financeRouter);
  app.use("/api/seller/connect", requireRole("owner"), (_req, res) => { res.json({ ok: true }); });
  app.use("/api/team", teamRouter);
  // Also served under /api/v1 in production.
  app.use("/api/v1/orders", tc, ordersRouter);
  app.use("/api/v1/products", tc, productsRouter);

  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  await db.delete(orders).where(inArray(orders.id, [orderId, cancelOrderId].filter(Boolean)));
  if (customerId) await db.delete(customers).where(inArray(customers.id, [customerId]));
  await db.delete(teamMembers).where(inArray(teamMembers.id, membershipIds));
  await db.delete(users).where(inArray(users.clerkId, ALL_USERS));
});

function expectPackerDenied(res: { status: number; body: any }) {
  expect(res.status).toBe(403);
  expect(res.body).toMatchObject({
    code: "PERMISSION_REQUIRED",
    currentRole: "packer",
    restriction: "PACKER_ORDERS_ONLY",
  });
  expect(typeof res.body.message).toBe("string");
}

describe("packer seat — allowed", () => {
  it("resolves the packer role for the joined store", async () => {
    const res = await call("GET", "/team/context", PACKER);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ role: "packer", storeOwnerId: OWNER });
  });

  it("lists the store's orders with buyer email redacted", async () => {
    const res = await call("GET", "/orders", PACKER);
    expect(res.status).toBe(200);
    const row = res.body.find((o: any) => o.id === orderId);
    expect(row).toBeTruthy();
    expect(row.orderNumber).toBe(`PK-${sfx}-1`);
    expect(row.customerName).toBe("Bea Buyer");
    expect(row.customerEmail).toBeNull();
    expect(JSON.stringify(res.body)).not.toContain(BUYER_EMAIL);
  });

  it("opens an order with items and the shipping address, minus email and phone", async () => {
    const res = await call("GET", `/orders/${orderId}`, PACKER);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({ productName: "Heavyweight tee", quantity: 2 });
    expect(res.body.shippingAddress).toMatchObject({
      name: "Bea Buyer", line1: "1 Parcel Lane", city: "Packton", zip: "90001", country: "US",
    });
    expect(res.body.shippingAddress.phone).toBeNull();
    expect(res.body.shippingAddress.email).toBeNull();
    expect(res.body.customer.name).toBe("Bea Buyer");
    expect(res.body.customer.email).toBeNull();
    expect(res.body.customer.phone).toBeNull();
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain(BUYER_EMAIL);
    expect(raw).not.toContain("+15550001111");
  });

  it("works under /api/v1 too", async () => {
    const res = await call("GET", `/v1/orders/${orderId}`, PACKER);
    expect(res.status).toBe(200);
    expect(res.body.customer.email).toBeNull();
  });

  it("checks off picking and packing", async () => {
    const res = await call("PATCH", `/orders/${orderId}/fulfillment-checklist`, PACKER, { isPicked: true, isPacked: true });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ fulfillmentPicked: true, fulfillmentPacked: true });
  });

  it("moves the order to processing", async () => {
    const res = await call("PATCH", `/orders/${orderId}/status`, PACKER, { status: "processing" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("processing");
    expect(JSON.stringify(res.body)).not.toContain(BUYER_EMAIL);
  });

  it("adds tracking", async () => {
    const res = await call("PATCH", `/orders/${orderId}/tracking`, PACKER, { trackingNumber: "1Z999AA10123456784", carrier: "UPS" });
    expect(res.status).not.toBe(403);
    expect(res.status).toBeLessThan(500);
  });

  it("reaches the label endpoints (not blocked by the packer guard)", async () => {
    const res = await call("GET", `/shipping-labels/${orderId}/parcel-suggestion`, PACKER);
    expect(res.status).not.toBe(403);
  });
});

describe("packer seat — denied", () => {
  const denied: Array<[string, string, unknown?]> = [
    ["GET", "/products"],
    ["GET", "/v1/products"],
    ["GET", "/customers"],
    ["GET", "/analytics/dashboard"],
    ["GET", "/analytics/revenue"],
    ["GET", "/finance/balance"],
    ["GET", "/discount-codes"],
    ["GET", "/seller/connect/status"],
    ["GET", "/team/members"],
    ["GET", "/team/roles"],
    ["GET", "/team/activity"],
    ["POST", "/orders", { items: [] }],
    ["POST", "/team/invite", { email: "x@test.local", role: "admin" }],
  ];
  for (const [method, path, body] of denied) {
    it(`${method} ${path} → 403`, async () => {
      expectPackerDenied(await call(method, path, PACKER, body));
    });
  }

  it("cannot cancel an order (cancelling refunds the buyer)", async () => {
    expectPackerDenied(await call("PATCH", `/orders/${cancelOrderId}/status`, PACKER, { status: "cancelled", reason: "other" }));
    const check = await call("GET", `/orders/${cancelOrderId}`, OWNER);
    expect(check.body.status).toBe("pending");
  });

  it("cannot move an order back to pending", async () => {
    expectPackerDenied(await call("PATCH", `/orders/${cancelOrderId}/status`, PACKER, { status: "pending" }));
  });
});

describe("other roles are unchanged", () => {
  it("owner still sees the buyer's email", async () => {
    const res = await call("GET", `/orders/${orderId}`, OWNER);
    expect(res.status).toBe(200);
    expect(res.body.customer.email).toBe(BUYER_EMAIL);
    const list = await call("GET", "/orders", OWNER);
    expect(list.body.find((o: any) => o.id === orderId).customerEmail).toBe(BUYER_EMAIL);
  });

  it("orders role still reads products and customers, with contact details", async () => {
    expect((await call("GET", "/products", ORDERS_ROLE)).status).toBe(200);
    expect((await call("GET", "/customers", ORDERS_ROLE)).status).toBe(200);
    const detail = await call("GET", `/orders/${orderId}`, ORDERS_ROLE);
    expect(detail.body.customer.email).toBe(BUYER_EMAIL);
  });

  it("viewer keeps its existing access", async () => {
    expect((await call("GET", "/orders", VIEWER)).status).toBe(200);
    expect((await call("GET", "/products", VIEWER)).status).toBe(200);
    expect((await call("GET", "/team/members", VIEWER)).status).toBe(200);
    // and its existing denials keep their own shape (no packer marker)
    const finance = await call("GET", "/finance/balance", VIEWER);
    expect(finance.status).toBe(403);
    expect(finance.body.restriction).toBeUndefined();
  });

  it("roles list offers Packer with its permission summary", async () => {
    const res = await call("GET", "/team/roles", OWNER);
    expect(res.status).toBe(200);
    const packer = res.body.find((r: any) => r.key === "packer");
    expect(packer).toMatchObject({
      name: "Packer",
      description: "Sees orders to pack and ship. No sales, payouts, customers' contact details or store settings.",
      staffCount: 1,
    });
  });

  it("owner can change a member's role to packer and back", async () => {
    const orderMembership = membershipIds[1];
    const toPacker = await call("PATCH", `/team/members/${orderMembership}`, OWNER, { role: "packer" });
    expect(toPacker.status).toBe(200);
    expect(toPacker.body.role).toBe("packer");
    expectPackerDenied(await call("GET", "/products", ORDERS_ROLE));
    const back = await call("PATCH", `/team/members/${orderMembership}`, OWNER, { role: "orders" });
    expect(back.status).toBe(200);
    expect((await call("GET", "/products", ORDERS_ROLE)).status).toBe(200);
  });
});
