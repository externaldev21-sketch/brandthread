/**
 * End-to-end contract for the manufacturer side:
 *   manufacturer sends a priced card in chat → seller pays through the
 *   payments service (Stripe Checkout) → manufacturer walks the six-stage
 *   tracker → seller confirms delivery, with timestamps and thread history;
 * plus card withdrawal/decline, private invites and directory filters.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { eq, inArray, like } from "drizzle-orm";
import {
  db, manufacturerActivityEvents, manufacturerInviteTokens, manufacturerMessages, manufacturerOrderEvents,
  manufacturerRelationships, manufacturerThreads, manufacturers, sampleOrders, users,
} from "@workspace/db";

const auth = vi.hoisted(() => ({ userId: "" }));
const stripeState = vi.hoisted(() => ({
  sessions: new Map<string, { id: string; url: string; payment_status: string; status: string; payment_intent: string | null }>(),
  created: [] as Array<Record<string, any>>,
  expired: [] as string[],
  account: {
    charges_enabled: false,
    payouts_enabled: true,
    details_submitted: true,
    capabilities: { transfers: "active" },
    tos_acceptance: { service_agreement: "recipient" },
  } as Record<string, unknown>,
}));

vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: auth.userId || null }),
  clerkClient: { users: { getUser: async () => null } },
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
vi.mock("../../routes/notifications-feed", () => ({ publishNotification: async () => undefined }));
vi.mock("../../lib/brandthreadEmail", () => ({ sendManufacturerSignupEmail: async () => undefined }));
vi.mock("../../lib/objectStorage", () => ({
  ObjectStorageService: class {
    async getObjectEntityDownloadURL(path: string) { return `https://objects.test${path}`; }
  },
}));
vi.mock("../../lib/stripe", () => ({
  PLATFORM_COMMISSION_RATE: 0.05,
  computeApplicationFeeCents: (amount: number) => Math.round(amount * 0.05),
  requireStripe: () => ({
    accounts: { retrieve: async () => stripeState.account },
    checkout: {
      sessions: {
        create: async (params: Record<string, any>) => {
          const id = `cs_mfr_flow_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
          stripeState.created.push(params);
          const session = { id, url: `https://checkout.stripe.test/${id}`, payment_status: "unpaid", status: "open", payment_intent: null };
          stripeState.sessions.set(id, session);
          return session;
        },
        retrieve: async (id: string) => {
          const session = stripeState.sessions.get(id);
          if (!session) throw new Error(`Unknown session ${id}`);
          return session;
        },
        expire: async (id: string) => {
          stripeState.expired.push(id);
          const session = stripeState.sessions.get(id)!;
          session.status = "expired";
          return session;
        },
      },
    },
    paymentIntents: { retrieve: async () => ({ status: "succeeded" }) },
  }),
}));

let server: Server;
let base = "";
const prefix = `mfrflow-${crypto.randomBytes(6).toString("hex")}`;
const seller = `${prefix}-seller`;
const otherSeller = `${prefix}-other-seller`;
const factoryUser = `${prefix}-factory`;
const outsider = `${prefix}-outsider`;
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

async function seedFactory(overrides: Partial<typeof manufacturers.$inferInsert> = {}) {
  const [row] = await db.insert(manufacturers).values({
    clerkId: `${prefix}-mfr-${manufacturerIds.length}`,
    businessName: `${prefix} Saigon Knit ${manufacturerIds.length}`,
    country: "Vietnam", city: "Ho Chi Minh City", specialty: "Knitwear",
    yearsInBusiness: 12, moq: 150, priceRange: "$8 - $20",
    bulkTurnaround: "35 days", sampleTurnaround: "10 days",
    status: "active", isPublicDirectory: true,
    paymentSetup: true, stripeAccountId: "acct_recipient_vn", timeZone: "Asia/Ho_Chi_Minh",
    ...overrides,
  }).returning();
  manufacturerIds.push(row.id);
  return row;
}

async function seedThread(manufacturerId: string, sellerId = seller) {
  const [thread] = await db.insert(manufacturerThreads).values({
    manufacturerId, buyerClerkId: sellerId, buyerName: "Northside Studio", subject: "Hoodie line",
  }).returning();
  return thread;
}

const returnUrl = (id: string) => `brandthread://sample-detail?id=${id}&paymentReturn=1`;

beforeAll(async () => {
  const [flowRouter, manufacturersRouter, publicRouter, sampleOrdersRouter] = await Promise.all([
    import("../manufacturer-flow"), import("../manufacturers"), import("../manufacturer-public"), import("../sample-orders"),
  ]);
  const app = express();
  app.use((req, _res, next) => { (req as any).log = { error: (...args: unknown[]) => process.env.DEBUG_TEST_LOGS && console.error(...args), warn: () => undefined }; next(); });
  app.use(express.json());
  app.use("/api/manufacturers/public", publicRouter.default);
  app.use("/api/manufacturers", flowRouter.default);
  app.use("/api/manufacturers", manufacturersRouter.default);
  app.use("/api/sample-orders", sampleOrdersRouter.default);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  await db.insert(users).values([
    { clerkId: seller, email: `${seller}@example.test`, name: "Maya", brandName: "Northside Studio" },
    { clerkId: otherSeller, email: `${otherSeller}@example.test`, name: "Other" },
  ]);
});

afterEach(() => {
  stripeState.sessions.clear();
  stripeState.created.length = 0;
  stripeState.expired.length = 0;
  auth.userId = "";
});

afterAll(async () => {
  await db.delete(manufacturerInviteTokens).where(like(manufacturerInviteTokens.sellerId, `${prefix}%`));
  const byClerk = await db.select({ id: manufacturers.id }).from(manufacturers).where(like(manufacturers.clerkId, `${prefix}%`));
  const ids = [...new Set([...manufacturerIds, ...byClerk.map((row) => row.id)])];
  if (ids.length) await db.delete(manufacturers).where(inArray(manufacturers.id, ids));
  await db.delete(users).where(inArray(users.clerkId, [seller, otherSeller]));
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

describe("manufacturer order card → payment → tracker", () => {
  it("runs the full sample lifecycle with timestamps and thread history", async () => {
    const factory = await seedFactory({ clerkId: factoryUser });
    const thread = await seedThread(factory.id);
    const cardBody = {
      clientRequestId: `${prefix}-card-1`, orderType: "sample", title: "Heavyweight hoodie",
      description: "450gsm fleece, garment dyed", quantity: 2, priceCents: 8_500,
    };

    // Manufacturer sends the card.
    const sent = await call(`/api/manufacturers/me/threads/${thread.id}/order-cards`, "POST", cardBody, factoryUser);
    expect(sent.status).toBe(201);
    expect(sent.body.order).toMatchObject({ status: "pending_payment", issuedBy: "manufacturer", sellerId: seller, threadId: thread.id });
    expect(sent.body.message).toMatchObject({ messageType: "sample_card", senderRole: "manufacturer" });
    expect(sent.body.message.content).toBe("Sample: Heavyweight hoodie · 2 pcs · US$85.00");
    const orderId = sent.body.order.id as string;

    // Idempotent replay, conflicting reuse, and field validation.
    const replay = await call(`/api/manufacturers/me/threads/${thread.id}/order-cards`, "POST", cardBody, factoryUser);
    expect(replay.status).toBe(200);
    expect(replay.body.order.id).toBe(orderId);
    expect((await call(`/api/manufacturers/me/threads/${thread.id}/order-cards`, "POST", { ...cardBody, priceCents: 9_000 }, factoryUser)).status).toBe(409);
    const invalid = await call(`/api/manufacturers/me/threads/${thread.id}/order-cards`, "POST", { ...cardBody, clientRequestId: `${prefix}-bad`, priceCents: 50 }, factoryUser);
    expect(invalid.status).toBe(422);
    expect(invalid.body.fieldErrors.priceCents).toContain("US$1.00");

    // Only the thread's manufacturer can send cards into it.
    expect((await call(`/api/manufacturers/me/threads/${thread.id}/order-cards`, "POST", cardBody, outsider)).status).toBe(404);

    // The seller sees a live, payable card in the conversation.
    const sellerMessages = await call(`/api/manufacturers/threads/${thread.id}/messages`, "GET", undefined, seller);
    expect(sellerMessages.status).toBe(200);
    const card = sellerMessages.body.find((message: any) => message.messageType === "sample_card");
    expect(card.order).toMatchObject({ id: orderId, status: "pending_payment", manufacturerPayoutReady: true, currency: "USD" });

    // Production can't start before payment.
    const early = await call(`/api/manufacturers/me/sample-orders/${orderId}/status`, "PATCH", { status: "processing", expectedRevision: 1 }, factoryUser);
    expect(early.status).toBe(409);
    expect(early.body.code).toBe("PAYMENT_REQUIRED");

    // Seller pays through the payments service. The cross-border recipient
    // account (charges disabled, transfers active) is accepted.
    const checkout = await call(`/api/sample-orders/${orderId}/checkout-session`, "POST", { returnUrl: returnUrl(orderId) }, seller);
    expect(checkout.status).toBe(201);
    expect(stripeState.created[0].payment_intent_data).toMatchObject({
      application_fee_amount: 425, transfer_data: { destination: "acct_recipient_vn" },
    });
    expect(stripeState.created[0].line_items[0].price_data).toMatchObject({ currency: "usd", unit_amount: 8_500 });
    stripeState.sessions.get(checkout.body.sessionId)!.payment_status = "paid";
    stripeState.sessions.get(checkout.body.sessionId)!.status = "complete";
    const paid = await call(`/api/sample-orders/${orderId}/pay`, "POST", {}, seller);
    expect(paid.status).toBe(200);
    expect(paid.body.status).toBe("payment_received");

    // A paid card can no longer be withdrawn.
    const lateCancel = await call(`/api/manufacturers/orders/${orderId}/cancel`, "POST", {}, factoryUser);
    expect(lateCancel.status).toBe(409);

    // Manufacturer walks the tracker one stage at a time.
    let revision = (await db.select().from(sampleOrders).where(eq(sampleOrders.id, orderId)))[0].revision;
    const advance = async (status: string, extra: Record<string, unknown> = {}) => {
      const result = await call(`/api/manufacturers/me/sample-orders/${orderId}/status`, "PATCH", { status, expectedRevision: revision, ...extra }, factoryUser);
      if (result.status === 200) revision = result.body.revision;
      return result;
    };
    expect((await advance("cut_and_sew")).body.code).toBe("SKIPS_A_STAGE");
    expect((await advance("processing")).status).toBe(200);
    expect((await call(`/api/manufacturers/me/sample-orders/${orderId}/status`, "PATCH", { status: "cut_and_sew", expectedRevision: 1 }, factoryUser)).body.code).toBe("STALE_WRITE");
    expect((await advance("cut_and_sew")).status).toBe(200);
    expect((await advance("packing")).status).toBe(200);
    expect((await advance("shipped")).status).toBe(400);
    expect((await advance("shipped", { carrier: "DHL Express", trackingNumber: "JD014600006666" })).status).toBe(200);

    // Sellers can't move production stages, but can confirm delivery.
    expect((await call(`/api/manufacturers/orders/${orderId}/confirm-delivery`, "POST", {}, factoryUser)).status).toBe(403);
    const delivered = await call(`/api/manufacturers/orders/${orderId}/confirm-delivery`, "POST", {}, seller);
    expect(delivered.status).toBe(200);
    expect(delivered.body.status).toBe("delivered");
    expect((await call(`/api/manufacturers/orders/${orderId}/confirm-delivery`, "POST", {}, seller)).status).toBe(409);

    // Both sides read the same timeline with a real time for every stage.
    const timeline = await call(`/api/manufacturers/orders/${orderId}/timeline`, "GET", undefined, seller);
    expect(timeline.status).toBe(200);
    expect(timeline.body.viewerRole).toBe("seller");
    expect(timeline.body.steps.map((step: any) => step.state)).toEqual(["done", "done", "done", "done", "done", "done"]);
    expect(timeline.body.steps.every((step: any) => typeof step.at === "string")).toBe(true);
    expect(timeline.body.tracking).toMatchObject({ carrierName: "DHL Express", trackingNumber: "JD014600006666" });
    expect(timeline.body.tracking.url).toContain("dhl.com");
    expect(timeline.body.manufacturer.timeZone).toBe("Asia/Ho_Chi_Minh");
    expect((await call(`/api/manufacturers/orders/${orderId}/timeline`, "GET", undefined, factoryUser)).body.viewerRole).toBe("manufacturer");
    expect((await call(`/api/manufacturers/orders/${orderId}/timeline`, "GET", undefined, outsider)).status).toBe(404);

    // The thread carries the running history of the job.
    const history = await db.select().from(manufacturerMessages).where(eq(manufacturerMessages.threadId, thread.id));
    const systemLines = history.filter((message) => message.messageType === "system").map((message) => message.content);
    expect(systemLines).toEqual(expect.arrayContaining([
      'Sample "Heavyweight hoodie" is now at processing.',
      'Sample "Heavyweight hoodie" shipped with DHL Express · tracking JD014600006666',
      'Sample "Heavyweight hoodie" was received by the seller.',
    ]));
    const events = await db.select().from(manufacturerOrderEvents).where(eq(manufacturerOrderEvents.sampleOrderId, orderId));
    expect(events.map((event) => event.toStatus)).toEqual(
      expect.arrayContaining(["pending_payment", "processing", "cut_and_sew", "packing", "shipped", "delivered"]),
    );
    const payment = await db.select().from(manufacturerActivityEvents).where(eq(manufacturerActivityEvents.sampleOrderId, orderId));
    expect(payment.map((event) => event.type)).toContain("payment_received");
  });

  it("lets bulk cards use the same card checkout", async () => {
    const factory = await seedFactory();
    const thread = await seedThread(factory.id);
    auth.userId = factory.clerkId!;
    const sent = await call(`/api/manufacturers/me/threads/${thread.id}/order-cards`, "POST", {
      clientRequestId: `${prefix}-bulk-1`, orderType: "bulk", title: "Hoodie run", quantity: 500, priceCents: 1_250_000,
    }, factory.clerkId!);
    expect(sent.status).toBe(201);
    expect(sent.body.message.messageType).toBe("bulk_card");
    const checkout = await call(`/api/sample-orders/${sent.body.order.id}/checkout-session`, "POST", { returnUrl: returnUrl(sent.body.order.id) }, seller);
    expect(checkout.status).toBe(201);
    expect(stripeState.created[0].line_items[0].price_data.product_data.name).toBe("Bulk order: Hoodie run");
  });

  it("blocks payment until the manufacturer's payouts are ready", async () => {
    const factory = await seedFactory();
    const thread = await seedThread(factory.id);
    const sent = await call(`/api/manufacturers/me/threads/${thread.id}/order-cards`, "POST", {
      clientRequestId: `${prefix}-notready`, orderType: "sample", title: "Tee", quantity: 1, priceCents: 3_000,
    }, factory.clerkId!);
    stripeState.account = { ...stripeState.account, payouts_enabled: false };
    try {
      const checkout = await call(`/api/sample-orders/${sent.body.order.id}/checkout-session`, "POST", { returnUrl: returnUrl(sent.body.order.id) }, seller);
      expect(checkout.status).toBe(409);
      expect(checkout.body.code).toBe("MANUFACTURER_PAYOUTS_INCOMPLETE");
    } finally {
      stripeState.account = { ...stripeState.account, payouts_enabled: true };
    }
  });

  it("withdraws and declines unpaid cards, expiring any open checkout", async () => {
    const factory = await seedFactory();
    const thread = await seedThread(factory.id);
    const send = async (key: string) => (await call(`/api/manufacturers/me/threads/${thread.id}/order-cards`, "POST", {
      clientRequestId: `${prefix}-${key}`, orderType: "sample", title: `Card ${key}`, quantity: 1, priceCents: 2_000,
    }, factory.clerkId!)).body.order.id as string;

    const withdrawnId = await send("withdraw");
    const checkout = await call(`/api/sample-orders/${withdrawnId}/checkout-session`, "POST", { returnUrl: returnUrl(withdrawnId) }, seller);
    const withdrawn = await call(`/api/manufacturers/orders/${withdrawnId}/cancel`, "POST", { reason: "Fabric sold out" }, factory.clerkId!);
    expect(withdrawn.status).toBe(200);
    expect(withdrawn.body.status).toBe("cancelled");
    expect(stripeState.expired).toEqual([checkout.body.sessionId]);
    expect((await call(`/api/sample-orders/${withdrawnId}/checkout-session`, "POST", { returnUrl: returnUrl(withdrawnId) }, seller)).status).toBe(409);

    const declinedId = await send("decline");
    const declined = await call(`/api/manufacturers/orders/${declinedId}/cancel`, "POST", {}, seller);
    expect(declined.status).toBe(200);
    const lines = (await db.select().from(manufacturerMessages).where(eq(manufacturerMessages.threadId, thread.id)))
      .filter((message) => message.messageType === "system").map((message) => message.content);
    expect(lines).toEqual(expect.arrayContaining([
      'The manufacturer withdrew Sample "Card withdraw".',
      'The seller declined Sample "Card decline".',
    ]));

    // A card the seller already paid can't be cancelled out from under them.
    const paidId = await send("paid");
    const paidCheckout = await call(`/api/sample-orders/${paidId}/checkout-session`, "POST", { returnUrl: returnUrl(paidId) }, seller);
    stripeState.sessions.get(paidCheckout.body.sessionId)!.payment_status = "paid";
    const blocked = await call(`/api/manufacturers/orders/${paidId}/cancel`, "POST", {}, factory.clerkId!);
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe("ALREADY_PAID");
    expect((await call(`/api/manufacturers/orders/${paidId}/cancel`, "POST", {}, outsider)).status).toBe(404);
  });
});

describe("private seller invites", () => {
  it("signs a manufacturer up privately, connects them to the inviting seller only", async () => {
    const invite = await call("/api/manufacturers/invite-tokens", "POST", { companyName: "Lisbon Leather", contactEmail: "hello@lisbon.test" }, seller);
    expect(invite.status).toBe(201);
    expect(invite.body.inviteUrl).toMatch(/\/manufacturers\/join\?invite=[0-9a-f]{48}$/);
    expect(invite.body.status).toBe("pending");
    const token = invite.body.token as string;

    const resolved = await call(`/api/manufacturers/invite-tokens/resolve/${token}`);
    expect(resolved.body).toMatchObject({ valid: true, sellerName: "Northside Studio", companyName: "Lisbon Leather" });

    const privateUser = `${prefix}-private-factory`;
    const registered = await call(`/api/manufacturers/register-via-invite/${token}`, "POST", {
      businessName: `${prefix} Lisbon Leather`, country: "Portugal", specialty: "Leather Goods",
      yearsInBusiness: 22, moq: 50, priceRange: "$40 - $120", bulkTurnaround: "30 days", sampleTurnaround: "14 days",
    }, privateUser);
    expect(registered.status).toBe(201);
    expect(registered.body).toMatchObject({ isPublicDirectory: false, status: "active", timeZone: "Europe/Lisbon", invitedBySellerId: seller });
    expect(typeof registered.body.threadId).toBe("string");
    manufacturerIds.push(registered.body.id);

    expect((await call(`/api/manufacturers/register-via-invite/${token}`, "POST", {}, `${prefix}-late`)).status).toBe(410);

    // Invisible to the directory and other sellers; visible to the inviter.
    const directory = await call(`/api/manufacturers/public?q=${encodeURIComponent(prefix)}`);
    expect(directory.body.map((row: any) => row.id)).not.toContain(registered.body.id);
    expect((await call(`/api/manufacturers/public/${registered.body.id}`)).status).toBe(404);
    expect((await call(`/api/manufacturers/partners/${registered.body.id}`, "GET", undefined, seller)).body).toMatchObject({ isConnected: true, yearsInBusiness: 22 });
    expect((await call(`/api/manufacturers/partners/${registered.body.id}`, "GET", undefined, otherSeller)).status).toBe(404);
    expect((await call("/api/manufacturers/threads", "POST", { manufacturerId: registered.body.id }, otherSeller)).status).toBe(404);

    const relationships = await call("/api/manufacturers/relationships", "GET", undefined, seller);
    const entry = relationships.body.find((row: any) => row.manufacturerId === registered.body.id);
    expect(entry).toMatchObject({ threadId: registered.body.threadId, manufacturer: { isPublicDirectory: false, yearsInBusiness: 22 } });

    const inviterThreads = await call("/api/manufacturers/threads", "GET", undefined, seller);
    expect(inviterThreads.body.map((row: any) => row.id)).toContain(registered.body.threadId);
    const invites = await call("/api/manufacturers/invite-tokens", "GET", undefined, seller);
    expect(invites.body.find((row: any) => row.token === token)).toMatchObject({ status: "accepted", manufacturerName: `${prefix} Lisbon Leather` });
  });

  it("connects an existing manufacturer to a second seller without changing their listing", async () => {
    const factory = await seedFactory();
    const invite = await call("/api/manufacturers/invite-tokens", "POST", {}, otherSeller);
    const accepted = await call(`/api/manufacturers/register-via-invite/${invite.body.token}`, "POST", {}, factory.clerkId!);
    expect(accepted.status).toBe(200);
    expect(accepted.body.isPublicDirectory).toBe(true);
    const [relationship] = await db.select().from(manufacturerRelationships)
      .where(eq(manufacturerRelationships.manufacturerId, factory.id));
    expect(relationship.sellerId).toBe(otherSeller);
  });
});

describe("directory filters", () => {
  it("filters by years in business, MOQ and photos and reports facets", async () => {
    const veteran = await seedFactory({ yearsInBusiness: 30, moq: 500, photos: ["/objects/uploads/veteran"], country: "Portugal" });
    const newcomer = await seedFactory({ yearsInBusiness: 2, moq: 50, photos: [] });
    const q = encodeURIComponent(prefix);
    const ids = async (query: string) => (await call(`/api/manufacturers/public?q=${q}&${query}`)).body.map((row: any) => row.id);
    expect(await ids("minYears=20")).toContain(veteran.id);
    expect(await ids("minYears=20")).not.toContain(newcomer.id);
    expect(await ids("maxMoq=100")).toContain(newcomer.id);
    expect(await ids("maxMoq=100")).not.toContain(veteran.id);
    expect(await ids("hasPhotos=true")).toEqual(expect.arrayContaining([veteran.id]));
    expect(await ids("hasPhotos=true")).not.toContain(newcomer.id);
    const experienced = await ids("sort=experience");
    expect(experienced.indexOf(veteran.id)).toBeLessThan(experienced.indexOf(newcomer.id));
    const listed = (await call(`/api/manufacturers/public?q=${q}&minYears=20`)).body.find((row: any) => row.id === veteran.id);
    expect(listed).toMatchObject({ yearsInBusiness: 30, timeZone: "Asia/Ho_Chi_Minh", photos: ["https://objects.test/objects/uploads/veteran"] });

    const facets = await call("/api/manufacturers/public/facets");
    expect(facets.status).toBe(200);
    expect(facets.body.countries).toEqual(expect.arrayContaining([expect.objectContaining({ name: "Vietnam" })]));
    expect(facets.body.total).toBeGreaterThanOrEqual(2);
  });
});

describe("international payout readiness", () => {
  it("treats a cross-border recipient account as ready once transfers and payouts are active", async () => {
    const { connectReadiness, connectCountryProblem } = await import("../manufacturer-connect");
    const recipient = {
      charges_enabled: false, payouts_enabled: true, details_submitted: true,
      capabilities: { transfers: "active" }, tos_acceptance: { service_agreement: "recipient" },
    };
    expect(connectReadiness(recipient)).toMatchObject({ ready: true, accountType: "recipient", status: "active" });
    expect(connectReadiness({ ...recipient, capabilities: { transfers: "pending" } }).ready).toBe(false);
    expect(connectReadiness({ ...recipient, payouts_enabled: false }).ready).toBe(false);
    // Full (domestic) accounts still need charges enabled.
    expect(connectReadiness({ charges_enabled: false, payouts_enabled: true, details_submitted: true }).ready).toBe(false);
    expect(connectCountryProblem("Vietnam")).toBeNull();
    expect(connectCountryProblem("")).toMatch(/Add your country/);
    expect(connectCountryProblem("Atlantis")).toMatch(/Atlantis/);
  });
});
