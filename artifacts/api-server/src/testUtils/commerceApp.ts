/**
 * Helpers for whole-app, two-sided commerce tests (buyer + seller) against
 * the real routers and the real test database.
 *
 * The test file itself must set the env in vi.hoisted (STRIPE_SECRET_KEY,
 * STRIPE_WEBHOOK_SECRET, the AI integration URL/key the full app imports, and
 * PAYOUT_MODE=hold — production timing; vitest.setup.ts defaults older suites
 * to "immediate") and install the module mocks (vi.mock is hoisted per file): `stripe` → testUtils/fakeStripe, `@clerk/express` → getAuth reading
 * the `x-test-user-id` header, and `lib/push` → a recorder. See
 * routes/__tests__/commerce-lifecycle.integration.test.ts for the template.
 */
import crypto from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { eq, inArray, or, sql } from "drizzle-orm";
import {
  db, users, products, productVariants, orders, orderItems, checkoutSessions, notificationsFeed, savedItems,
} from "@workspace/db";

function warnCleanup(err: unknown): void {
  // Cleanup is best-effort, but a silent failure leaves rows that break
  // later runs (e.g. migration CHECK constraints re-applied by the harness).
  console.warn("[commerceApp cleanup]", (err as Error)?.message ?? err);
}

export type ApiResult = { status: number; body: any };

export interface CommerceApp {
  base: string;
  seller: string;
  buyer: string;
  sellerAccount: string;
  call(as: string | null, method: string, path: string, body?: unknown): Promise<ApiResult>;
  asSeller(method: string, path: string, body?: unknown): Promise<ApiResult>;
  asBuyer(method: string, path: string, body?: unknown): Promise<ApiResult>;
  /** Post a Stripe event to the real webhook route (fakeStripe parses the body). */
  stripeEvent(type: string, object: any, extra?: Record<string, unknown>): Promise<ApiResult>;
  /** Create another user row (cleaned up with the rest). */
  addUser(kind: "buyer" | "seller", extra?: Record<string, unknown>): Promise<string>;
  /** Another seller with an active Stripe account (cleaned up with the rest). */
  addSeller(): Promise<string>;
  /** Seller lists an active product through POST /api/products. */
  listProduct(input: {
    name: string;
    variants: Array<{ size?: string; priceCents: number; stock: number; lowStockThreshold?: number }>;
    extra?: Record<string, unknown>;
    /** Listing seller; defaults to the main seller. */
    as?: string;
  }): Promise<{ productId: string; variantIds: string[] }>;
  /** Buyer pays for items through hosted Checkout + checkout.session.completed. Returns the order id. */
  buyViaHostedCheckout(items: Array<{ productId: string; variantId: string; quantity: number }>, opts?: { buyer?: string; discountCode?: string }): Promise<string>;
  stop(): Promise<void>;
}

export const TEST_ADDRESS = {
  recipientName: "E2E Buyer", street: "1 Main St", city: "Portland", state: "OR", postalCode: "97209", country: "US",
};

export async function startCommerceApp(label: string, fake: { stripe: any }): Promise<CommerceApp> {
  const suffix = `${label}-${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
  const seller = `e2e-${suffix}-seller`;
  const buyer = `e2e-${suffix}-buyer`;
  const sellerAccount = `acct_e2e_${crypto.randomBytes(6).toString("hex")}`;
  const userIds = [seller, buyer];
  const productIds: string[] = [];
  let eventSeq = 0;

  await db.insert(users).values([
    {
      clerkId: seller, email: `${seller}@test.local`, name: "E2E Seller", displayName: "E2E Studio",
      role: "seller", accountType: "seller", stripeAccountId: sellerAccount, stripeAccountStatus: "active",
    } as any,
    { clerkId: buyer, email: `${buyer}@test.local`, name: "E2E Buyer", role: "buyer", accountType: "buyer" } as any,
  ]);

  const { default: app } = await import("../app");
  let server: Server;
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  const base = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;

  const call = async (as: string | null, method: string, path: string, body?: unknown): Promise<ApiResult> => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { "content-type": "application/json", ...(as ? { "x-test-user-id": as } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let parsed: any = text;
    try { parsed = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, body: parsed };
  };

  const stripeEvent = async (type: string, object: any, extra: Record<string, unknown> = {}): Promise<ApiResult> => {
    eventSeq += 1;
    const event = { id: `evt_${suffix}_${eventSeq}`, type, created: Math.floor(Date.now() / 1000), data: { object }, ...extra };
    const res = await fetch(`${base}/api/webhooks/stripe`, {
      method: "POST",
      headers: { "content-type": "application/json", "stripe-signature": "t=1,v1=fake" },
      body: JSON.stringify(event),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };

  const ctx: CommerceApp = {
    base, seller, buyer, sellerAccount, call, stripeEvent,
    asSeller: (m, p, b) => call(seller, m, p, b),
    asBuyer: (m, p, b) => call(buyer, m, p, b),
    async addUser(kind, extra = {}) {
      const id = `e2e-${suffix}-${kind}-${userIds.length}`;
      userIds.push(id);
      await db.insert(users).values({
        clerkId: id, email: `${id}@test.local`, name: `E2E ${kind}`, role: kind, accountType: kind, ...extra,
      } as any);
      return id;
    },
    async addSeller() {
      return ctx.addUser("seller", {
        displayName: "E2E Second Studio",
        stripeAccountId: `acct_e2e_${crypto.randomBytes(6).toString("hex")}`,
        stripeAccountStatus: "active",
      });
    },
    async listProduct({ name, variants, extra = {}, as = seller }) {
      const created = await call(as, "POST", "/api/products", {
        name, status: "active", ...extra,
        variants: variants.map((v, i) => ({ sku: `${suffix}-${productIds.length}-${i}`, lowStockThreshold: 0, ...v })),
      });
      if (created.status !== 201) throw new Error(`listProduct failed: ${created.status} ${JSON.stringify(created.body)}`);
      productIds.push(created.body.id);
      const rows = await db.select({ id: productVariants.id, sku: productVariants.sku })
        .from(productVariants).where(eq(productVariants.productId, created.body.id));
      const variantIds = variants.map((_, i) => rows.find((r) => r.sku === `${suffix}-${productIds.length - 1}-${i}`)!.id);
      return { productId: created.body.id, variantIds };
    },
    async buyViaHostedCheckout(items, opts = {}) {
      const as = opts.buyer ?? buyer;
      const session = await call(as, "POST", "/api/buyer/checkout/session", {
        items,
        successUrl: "https://app.test/success",
        cancelUrl: "https://app.test/cancel",
        contactEmail: `${as}@test.local`,
        contactPhone: "+1 503 555 0100",
        shippingAddress: TEST_ADDRESS,
        clientIdempotencyKey: `idem-${crypto.randomUUID()}`,
        ...(opts.discountCode ? { discountCode: opts.discountCode } : {}),
      });
      if (session.status !== 200) throw new Error(`checkout session failed: ${session.status} ${JSON.stringify(session.body)}`);
      const create = fake.stripe.callsTo("checkout.sessions.create").at(-1);
      const csRef = create.args[0].metadata.csRef;
      const [row] = await db.select().from(checkoutSessions).where(eq(checkoutSessions.id, csRef)).limit(1);
      const subtotal = (row.items ?? []).reduce((sum: number, i: any) => sum + i.priceCents * i.quantity, 0);
      const discount = (row.discountCodeAmountCents ?? 0) + (row.loyaltyDiscountCents ?? 0) + (row.threadCashDiscountCents ?? 0);
      const shippingCents = row.shippingCents ?? 0;
      const paid = await stripeEvent("checkout.session.completed", {
        id: session.body.sessionId,
        object: "checkout.session",
        payment_status: "paid",
        payment_intent: `pi_${crypto.randomBytes(8).toString("hex")}`,
        amount_total: subtotal - discount + shippingCents,
        total_details: { amount_discount: discount, amount_shipping: shippingCents, amount_tax: 0 },
        metadata: { csRef },
      });
      if (paid.status !== 200) throw new Error(`webhook failed: ${paid.status} ${JSON.stringify(paid.body)}`);
      const [order] = await db.select({ id: orders.id }).from(orders)
        .where(eq(orders.stripeCheckoutSessionId, session.body.sessionId)).limit(1);
      if (!order) throw new Error("webhook created no order");
      return order.id;
    },
    async stop() {
      // Don't wait on server.close(): undici keep-alive sockets can hold it
      // open past the hook timeout, and then the cleanup below never runs.
      server.closeAllConnections?.();
      server.close();
      const orderRows = await db.select({ id: orders.id }).from(orders)
        .where(or(inArray(orders.ownerId, userIds), inArray(orders.buyerId, userIds)));
      const orderIds = orderRows.map((o) => o.id);
      if (orderIds.length) {
        const idList = sql.join(orderIds.map((id) => sql`${id}::uuid`), sql`, `);
        for (const table of ["order_refunds", "order_releases", "order_tracking_events", "returns", "disputes", "order_fund_reservations", "reviews", "seller_tax_ledger", "shipping_label_quotes", "shipping_labels"]) {
          await db.execute(sql`DELETE FROM ${sql.identifier(table)} WHERE order_id IN (${idList})`).catch(warnCleanup);
        }
        // ledger_* rows are append-only by design (immutability triggers) and
        // carry no foreign key to orders, so they are left in the test DB.
        await db.delete(orderItems).where(inArray(orderItems.orderId, orderIds)).catch(warnCleanup);
        await db.delete(orders).where(inArray(orders.id, orderIds)).catch(warnCleanup);
      }
      const userList = sql.join(userIds.map((id) => sql`${id}`), sql`, `);
      await db.execute(sql`DELETE FROM stock_reservations WHERE checkout_session_id IN (SELECT id FROM checkout_sessions WHERE buyer_id IN (${userList}) OR seller_id IN (${userList}))`).catch(warnCleanup);
      await db.delete(checkoutSessions).where(or(inArray(checkoutSessions.buyerId, userIds), inArray(checkoutSessions.sellerId, userIds))).catch(warnCleanup);
      await db.delete(notificationsFeed).where(inArray(notificationsFeed.userId, userIds)).catch(warnCleanup);
      await db.delete(savedItems).where(inArray(savedItems.userId, userIds)).catch(warnCleanup);
      await db.execute(sql`DELETE FROM stripe_webhook_events WHERE event_id LIKE ${`evt_${suffix}_%`}`).catch(warnCleanup);
      for (const productId of productIds) {
        await db.delete(productVariants).where(eq(productVariants.productId, productId)).catch(warnCleanup);
        await db.delete(products).where(eq(products.id, productId)).catch(warnCleanup);
      }
      await db.delete(users).where(inArray(users.clerkId, userIds)).catch(warnCleanup);
    },
  };
  return ctx;
}
