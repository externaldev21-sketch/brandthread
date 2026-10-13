/**
 * Wholesale price list at checkout (item 59), against real Postgres:
 *  - one-page checkout (priceCartGroup): approved wholesale buyers pay the
 *    wholesale price on lines that reach the minimum quantity; everyone else,
 *    and orders under the wholesale minimum, pay retail;
 *  - no stacking: a sale price lower than wholesale wins, and a discount code
 *    only discounts lines that are not at wholesale;
 *  - hosted checkout (POST /api/buyer/checkout/session) charges the same
 *    wholesale unit price to Stripe and stores it on the checkout row.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const fakeStripe = vi.hoisted(() => {
  const sessionCreates: any[] = [];
  let n = 0;
  return {
    sessionCreates,
    stripe: {
      checkout: {
        sessions: {
          create: async (params: any) => {
            sessionCreates.push(params);
            n += 1;
            return { id: `cs_wholesale_${n}`, url: `https://checkout.stripe.test/${n}`, status: "open", payment_status: "unpaid", payment_intent: null, metadata: params.metadata ?? {} };
          },
          retrieve: async () => { throw Object.assign(new Error("not found"), { statusCode: 404 }); },
          list: async () => ({ data: [], has_more: false }),
        },
      },
      customers: {
        create: async () => ({ id: `cus_wholesale_${++n}` }),
        update: async (id: string, params: any) => ({ id, ...params }),
      },
    },
  };
});

vi.mock("../../stripe", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../stripe")>();
  return { ...real, stripe: fakeStripe.stripe, requireStripe: () => fakeStripe.stripe };
});
vi.mock("../../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: unknown, next: () => void) => {
    req.clerkUserId = req.headers["x-test-user"];
    next();
  },
}));

import { checkoutSessions, db, discountCodes, sales, wholesaleBuyers, wholesalePrices, wholesaleSettings } from "@workspace/db";
import { eq } from "drizzle-orm";
import { priceCartGroup } from "../cartCheckout";
import { clearSalesCache } from "../../pricing/salesRuntime";
import buyerRouter from "../../../routes/buyer";
import { call, seedBuyer, seedProduct, seedSeller, startApp, uid } from "./moneyHarness";

const shipping = {
  name: "Jordan Reyes", street: "148 Mercer Street", line2: null, city: "New York", state: "NY", zip: "10012", country: "US", phone: "+1 503 555 0100",
};

let app: Awaited<ReturnType<typeof startApp>>;
let seller = "";
let approvedBuyer = "";
let pendingBuyer = "";
let retailBuyer = "";
let tee: Awaited<ReturnType<typeof seedProduct>>;
let cap: Awaited<ReturnType<typeof seedProduct>>;

beforeAll(async () => {
  app = await startApp((server) => {
    server.use("/api/buyer", buyerRouter);
    server.use((err: any, _req: any, res: any, _next: any) => res.status(500).json({ error: String(err?.stack ?? err) }));
  });
  seller = await seedSeller("wholesale");
  approvedBuyer = await seedBuyer("wholesale-approved");
  pendingBuyer = await seedBuyer("wholesale-pending");
  retailBuyer = await seedBuyer("wholesale-retail");
  tee = await seedProduct(seller, { priceCents: 5_000, stock: 100 }); // default 40% off -> $30
  cap = await seedProduct(seller, { priceCents: 2_000, stock: 100 }); // fixed $9 from 6 units
  await db.insert(wholesaleSettings).values({ sellerId: seller, enabled: true, minOrderCents: 10_000, defaultPercentOff: 40 });
  await db.insert(wholesalePrices).values({ sellerId: seller, productId: cap.productId, variantId: null, priceCents: 900, minQuantity: 6 });
  await db.insert(wholesaleBuyers).values([
    { sellerId: seller, buyerId: approvedBuyer, businessName: "Corner Shop", status: "approved" },
    { sellerId: seller, buyerId: pendingBuyer, businessName: "New Shop", status: "pending" },
  ]);
});

afterAll(async () => {
  await app.close();
  await db.delete(sales).where(eq(sales.sellerId, seller));
  await db.delete(discountCodes).where(eq(discountCodes.sellerId, seller));
  clearSalesCache();
});

function group(buyerId: string, items: Array<{ p: typeof tee; quantity: number }>, discountCode?: string) {
  return priceCartGroup({
    buyerId, shipping, discountCode,
    items: items.map(({ p, quantity }) => ({ variantId: p.variantId, productId: p.productId, quantity })),
  });
}

describe("wholesale at one-page checkout", () => {
  it("charges an approved buyer wholesale on lines that reach the minimum quantity", async () => {
    const priced = await group(approvedBuyer, [{ p: tee, quantity: 4 }, { p: cap, quantity: 6 }]);
    expect(priced.items.map((i) => i.priceCents)).toEqual([3_000, 900]);
    expect(priced.subtotalCents).toBe(4 * 3_000 + 6 * 900);
  });

  it("keeps retail on a line under its minimum quantity", async () => {
    const priced = await group(approvedBuyer, [{ p: tee, quantity: 4 }, { p: cap, quantity: 5 }]);
    expect(priced.items.map((i) => i.priceCents)).toEqual([3_000, 2_000]);
    expect(priced.subtotalCents).toBe(12_000 + 10_000);
  });

  it("falls back to retail for the whole order under the wholesale minimum", async () => {
    // 3 tees at wholesale = $90 < $100 minimum.
    const priced = await group(approvedBuyer, [{ p: tee, quantity: 3 }]);
    expect(priced.items[0].priceCents).toBe(5_000);
    expect(priced.subtotalCents).toBe(15_000);
  });

  it("charges pending and unknown buyers retail", async () => {
    for (const buyer of [pendingBuyer, retailBuyer]) {
      const priced = await group(buyer, [{ p: tee, quantity: 4 }]);
      expect(priced.subtotalCents).toBe(20_000);
    }
  });

  it("doesn't stack a discount code on wholesale lines", async () => {
    const code = `WH${uid("c").replace(/[^a-z0-9]/gi, "").slice(-8).toUpperCase()}`;
    await db.insert(discountCodes).values({ id: uid("dc"), sellerId: seller, code, type: "percentage", value: "10" });
    // Tee at wholesale (no code), cap at retail (5 < 6): the code takes 10% of the cap line only.
    const priced = await group(approvedBuyer, [{ p: tee, quantity: 4 }, { p: cap, quantity: 5 }], code);
    expect(priced.items.map((i) => i.priceCents)).toEqual([3_000, 2_000]);
    expect(priced.merchandiseDiscountCents).toBe(1_000);
    // A retail buyer gets 10% of everything.
    const retail = await group(retailBuyer, [{ p: tee, quantity: 4 }, { p: cap, quantity: 5 }], code);
    expect(retail.merchandiseDiscountCents).toBe(3_000);
  });

  it("uses the lower of sale and wholesale, never both", async () => {
    const [sale] = await db.insert(sales).values({ sellerId: seller, name: "Half off", discountType: "percent", value: 50 }).returning();
    clearSalesCache();
    try {
      // Sale: tee $25 < wholesale $30 -> $25; cap $10 > wholesale $9 -> $9.
      const priced = await group(approvedBuyer, [{ p: tee, quantity: 4 }, { p: cap, quantity: 6 }]);
      expect(priced.items.map((i) => i.priceCents)).toEqual([2_500, 900]);
    } finally {
      await db.delete(sales).where(eq(sales.id, sale.id));
      clearSalesCache();
    }
  });
});

describe("wholesale at hosted checkout", () => {
  it("sends the wholesale unit price to Stripe and stores it on the checkout row", async () => {
    fakeStripe.sessionCreates.length = 0;
    const r = await call(app.base, "POST", "/api/buyer/checkout/session", approvedBuyer, {
      items: [{ variantId: tee.variantId, productId: tee.productId, quantity: 4 }],
      successUrl: "https://brandthread.test/checkout/success",
      cancelUrl: "https://brandthread.test/checkout/cancel",
      contactEmail: "buyer@test.local",
      contactPhone: "+1 503 555 0100",
      shippingAddress: { recipientName: "Jordan Reyes", street: "148 Mercer Street", city: "New York", state: "NY", postalCode: "10012", country: "US" },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const params = fakeStripe.sessionCreates.at(-1);
    expect(params.line_items[0]).toMatchObject({ quantity: 4, price_data: { unit_amount: 3_000 } });
    const [row] = await db.select().from(checkoutSessions).where(eq(checkoutSessions.buyerId, approvedBuyer));
    expect((row.items as any[])[0].priceCents).toBe(3_000);
    await db.delete(checkoutSessions).where(eq(checkoutSessions.buyerId, approvedBuyer));
  });
});
