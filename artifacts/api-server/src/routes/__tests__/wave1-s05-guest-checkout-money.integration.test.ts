/**
 * Wave-1 audit (slice s05): guest checkout money matches the signed-in flow.
 *  - A discount code is computed on the cart AFTER bundle savings (buyer.ts,
 *    lib/money/cartCheckout.ts), never on the pre-bundle subtotal.
 *  - A seller with no shipping zones or rate charges the standard rate
 *    (lib/defaultShipping.ts), not $0.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { db, checkoutSessions, discountCodes, products, productVariants, users } from "@workspace/db";
import { eq } from "drizzle-orm";

process.env.SESSION_SECRET ||= "guest-checkout-integration-test-secret";

const suffix = crypto.randomBytes(6).toString("hex");
const sellerId = `gcm-seller-${suffix}`;
const guestEmail = `gcm-${suffix}@test.local`;

const fake = vi.hoisted(() => {
  const creates: any[] = [];
  const coupons: any[] = [];
  const bundle = { on: false };
  return {
    creates, coupons, bundle,
    stripe: {
      customers: { create: async (params: any) => ({ id: `cus_gcm_${creates.length + 1}`, ...params }) },
      coupons: { create: async (params: any) => { const c = { id: `coupon_gcm_${coupons.length + 1}`, ...params }; coupons.push(c); return c; } },
      checkout: {
        sessions: {
          create: async (params: any) => {
            creates.push(params);
            return { id: `cs_gcm_${suffixHolder.value}_${creates.length}`, url: "https://checkout.stripe.test/x", client_secret: null };
          },
          retrieve: async () => ({ url: "https://checkout.stripe.test/x" }),
        },
      },
    },
  };
});
const suffixHolder = vi.hoisted(() => ({ value: "" }));
suffixHolder.value = suffix;

vi.mock("../../lib/stripe", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/stripe")>();
  return { ...real, requireStripe: () => fake.stripe };
});
// A $5 bundle saving on the single line when switched on.
vi.mock("../../lib/money/bundleLoader", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/money/bundleLoader")>();
  return {
    ...real,
    priceGroupBundles: async (input: any) => fake.bundle.on
      ? { bundleDiscountCents: 500, lineDiscountCents: input.lines.map(() => 500), lineBundleId: input.lines.map(() => null), applied: [], skipped: [] }
      : real.priceGroupBundles(input),
  };
});

let server: Server;
let base = "";
let productId = "";
let variantId = "";
const code = `GCM${suffix.slice(0, 6).toUpperCase()}`;

function body(key: string, extra: Record<string, unknown> = {}) {
  return {
    items: [{ productId, variantId, quantity: 1 }],
    contactEmail: guestEmail,
    contactPhone: "+1 503 555 0100",
    shippingAddress: { name: "Guest Buyer", street: "1 Test St", city: "Portland", state: "OR", zip: "97205", country: "US", phone: "+1 503 555 0100" },
    successUrl: "https://brandthread.test/success",
    cancelUrl: "https://brandthread.test/cancel",
    clientIdempotencyKey: `gcm-${key}-${suffix}`,
    ...extra,
  };
}
async function post(path: string, payload: unknown) {
  const r = await fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  return { status: r.status, body: await r.json() as any };
}

beforeAll(async () => {
  delete process.env.DEFAULT_SHIPPING_CENTS;
  await db.insert(users).values({
    clerkId: sellerId, email: `${sellerId}@test.local`, name: "GCM Seller", role: "seller", accountType: "seller",
    stripeAccountId: `acct_gcm_${suffix}`, stripeAccountStatus: "active", subscriptionStatus: "trialing", subscriptionPlanId: "starter",
  });
  const [product] = await db.insert(products).values({ ownerId: sellerId, name: "GCM product", category: "apparel", status: "active" }).returning();
  productId = product.id;
  const [variant] = await db.insert(productVariants).values({ productId, sku: `gcm-${suffix}`, priceCents: 2_500, stock: 10 }).returning();
  variantId = variant.id;
  await db.insert(discountCodes).values({ id: `dc_gcm_${suffix}`, sellerId, code, type: "percentage", value: "20" });

  const { default: router } = await import("../guest-checkout");
  const app = express();
  app.use(express.json());
  app.use("/api/guest/checkout", router);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(checkoutSessions).where(eq(checkoutSessions.guestEmail, guestEmail));
  await db.delete(discountCodes).where(eq(discountCodes.id, `dc_gcm_${suffix}`));
  await db.delete(products).where(eq(products.id, productId));
  await db.delete(users).where(eq(users.clerkId, sellerId));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("guest checkout money", () => {
  it("charges the standard shipping rate when the seller configured none", async () => {
    fake.bundle.on = false;
    const r = await post("/api/guest/checkout/session", body("ship"));
    expect(r.status).toBe(201);
    const params = fake.creates.at(-1);
    const shippingLine = params.line_items.find((l: any) => l.price_data.product_data.name === "Standard shipping");
    expect(shippingLine?.price_data.unit_amount).toBe(599);
    const [stored] = await db.select().from(checkoutSessions).where(eq(checkoutSessions.stripeSessionId, r.body.sessionId));
    // 5% of $25 + $5.99.
    expect(stored.platformFeeCents).toBe(155);
  });

  it("computes a percentage code on the cart after bundle savings", async () => {
    fake.bundle.on = true;
    const r = await post("/api/guest/checkout/session", body("bundle", { discountCode: code }));
    expect(r.status).toBe(201);
    const [stored] = await db.select().from(checkoutSessions).where(eq(checkoutSessions.stripeSessionId, r.body.sessionId));
    // $25 − $5 bundle = $20; 20% of $20 = $4 (not 20% of $25 = $5).
    expect(stored.bundleDiscountCents).toBe(500);
    expect(stored.discountCodeAmountCents).toBe(400);
    const params = fake.creates.at(-1);
    const coupon = fake.coupons.find((c) => c.id === params.discounts?.[0]?.coupon);
    expect(coupon?.amount_off).toBe(900);
    // 5% of ($20 − $4 + $5.99 shipping) = 5% of $21.99 → 110.
    expect(stored.platformFeeCents).toBe(110);
  });
});
