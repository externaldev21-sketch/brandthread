import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

/**
 * Routes behind the seller Checkout settings' post-purchase offer and
 * conversion tracking, and the buyer checkout's public store profile. The
 * libs' DB work is mocked; their validators run for real.
 */
const state = vi.hoisted(() => ({
  userId: "seller_1" as string | null,
  acceptCalls: [] as unknown[],
  savedOffer: null as unknown,
  savedTracking: null as unknown,
}));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: () => void) => {
    if (!state.userId) return res.status(401).json({ error: "Unauthorized" });
    req.clerkUserId = state.userId;
    next();
  },
}));
vi.mock("@workspace/db", () => new Proxy({ db: {} } as Record<string, unknown>, {
  get: (target, key) => (key in target ? target[key as string] : {}),
  has: () => true,
}));
vi.mock("../../lib/stripe", () => ({ requireStripe: () => ({ paymentIntents: {}, tax: {} }) }));
vi.mock("../../lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("../../lib/money/stockReservation", () => ({ StockReservationError: class extends Error {} }));
vi.mock("../../lib/money/cartCheckout", async () => {
  const actual = await vi.importActual<any>("../../lib/money/cartCheckout");
  return { CartCheckoutError: actual.CartCheckoutError, findCardDataInRequest: actual.findCardDataInRequest };
});
vi.mock("../../lib/sellerCheckoutSettings", () => ({
  loadSellerCheckoutSettings: async (ids: string[]) => new Map(ids.map((id) => [id, {
    checkoutMode: id === "seller_fr" ? "guest_only" : "accounts_optional", tippingEnabled: false, storeLanguage: id === "seller_fr" ? "fr" : "en",
  }])),
}));
vi.mock("../../lib/postPurchaseOffer", async () => {
  const actual = await vi.importActual<any>("../../lib/postPurchaseOffer");
  return {
    PostPurchaseError: actual.PostPurchaseError,
    validateOfferPatch: actual.validateOfferPatch,
    offerPriceCents: actual.offerPriceCents,
    getOfferSettings: async () => state.savedOffer ?? { enabled: false, productId: null, discountPercent: 0 },
    saveOfferSettings: async (_seller: string, value: unknown) => { state.savedOffer = value; return value; },
    loadOfferProduct: async () => ({ id: "p1", name: "Hoodie", image: null, variants: [{ variantId: "v1", label: "M", priceCents: 6000, stock: 2 }] }),
    offerForOrder: async () => ({ available: false, reason: "NO_OFFER" }),
    acceptOffer: async (_stripe: unknown, input: unknown) => {
      state.acceptCalls.push(input);
      return { paymentIntentId: "pi_1", status: "succeeded", clientSecret: null, paymentMethodId: "pm_1", amountCents: 5280, subtotalCents: 6000, discountCents: 1200, taxCents: 480 };
    },
  };
});
vi.mock("../../lib/conversionTracking", async () => {
  const actual = await vi.importActual<any>("../../lib/conversionTracking");
  return {
    TrackingStorageUnavailable: actual.TrackingStorageUnavailable,
    validateConversionTrackingPatch: actual.validateConversionTrackingPatch,
    getConversionTracking: async () => actual.trackingView(undefined),
    saveConversionTracking: async (_seller: string, patch: Record<string, string | null>) => {
      state.savedTracking = patch;
      return {
        ...actual.trackingView(undefined),
        metaPixelId: patch.metaPixelId ?? null,
        metaAccessTokenMasked: actual.maskSecret(patch.metaAccessToken),
        activeProviders: patch.metaPixelId && patch.metaAccessToken ? ["meta"] : [],
      };
    },
  };
});

import {
  buyerPostPurchaseRouter, checkoutProfileRouter, sellerConversionTrackingRouter, sellerPostPurchaseOfferRouter,
} from "../checkout-extras";

let server: Server;
let base = "";

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/seller/post-purchase-offer", sellerPostPurchaseOfferRouter);
  app.use("/api/seller/conversion-tracking", sellerConversionTrackingRouter);
  app.use("/api/buyer/post-purchase", buyerPostPurchaseRouter);
  app.use("/api/checkout-profile", checkoutProfileRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  state.userId = "seller_1";
  state.acceptCalls = [];
  state.savedOffer = null;
  state.savedTracking = null;
});

const json = (method: string, body: unknown) => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const PRODUCT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const VARIANT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ORDER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("seller post-purchase offer", () => {
  it("requires sign-in", async () => {
    state.userId = null;
    expect((await fetch(`${base}/api/seller/post-purchase-offer`)).status).toBe(401);
  });

  it("refuses a discount over 50% or turning on without a product", async () => {
    let res = await fetch(`${base}/api/seller/post-purchase-offer`, json("PUT", { enabled: true, productId: PRODUCT, discountPercent: 60 }));
    expect(res.status).toBe(400);
    res = await fetch(`${base}/api/seller/post-purchase-offer`, json("PUT", { enabled: true, productId: null, discountPercent: 10 }));
    expect(res.status).toBe(400);
    expect(state.savedOffer).toBeNull();
  });

  it("saves a valid offer and returns it with the product's offer price", async () => {
    const res = await fetch(`${base}/api/seller/post-purchase-offer`, json("PUT", { enabled: true, productId: PRODUCT, discountPercent: 20 }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      offer: { enabled: true, productId: PRODUCT, discountPercent: 20 },
      product: { name: "Hoodie", priceCents: 6000, offerPriceCents: 4800, inStock: true },
    });
  });
});

describe("seller conversion tracking", () => {
  it("validates formats and never echoes a secret", async () => {
    let res = await fetch(`${base}/api/seller/conversion-tracking`, json("PUT", { ga4MeasurementId: "UA-1234-1" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ field: "ga4MeasurementId" });
    const token = `EAA${"x".repeat(50)}`;
    res = await fetch(`${base}/api/seller/conversion-tracking`, json("PUT", { metaPixelId: "123456789012345", metaAccessToken: token }));
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text).not.toContain(token);
    expect(JSON.parse(text).tracking).toMatchObject({ metaPixelId: "123456789012345", metaAccessTokenMasked: "••••xxxx", activeProviders: ["meta"] });
  });
});

describe("buyer post-purchase", () => {
  beforeEach(() => { state.userId = "buyer_1"; });

  it("passes only the order, variant and key to the server price — never a client price", async () => {
    const res = await fetch(`${base}/api/buyer/post-purchase/${ORDER}/accept`, json("POST", {
      variantId: VARIANT, clientIdempotencyKey: "key-12345678", priceCents: 1, amountCents: 1, discountPercent: 99,
    }));
    expect(res.status).toBe(200);
    expect(state.acceptCalls).toEqual([{ buyerId: "buyer_1", orderId: ORDER, variantId: VARIANT, clientIdempotencyKey: "key-12345678" }]);
  });

  it("rejects card data and missing fields", async () => {
    let res = await fetch(`${base}/api/buyer/post-purchase/${ORDER}/accept`, json("POST", { variantId: VARIANT, clientIdempotencyKey: "key-12345678", card: "4242424242424242" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "CARD_DATA_REJECTED" });
    res = await fetch(`${base}/api/buyer/post-purchase/${ORDER}/accept`, json("POST", { variantId: "nope", clientIdempotencyKey: "key-12345678" }));
    expect(res.status).toBe(400);
    expect(state.acceptCalls).toHaveLength(0);
  });

  it("reports when there is no offer", async () => {
    const res = await fetch(`${base}/api/buyer/post-purchase/${ORDER}`);
    expect(await res.json()).toEqual({ available: false, reason: "NO_OFFER" });
  });
});

describe("public checkout profile", () => {
  it("returns each seller's store language and checkout mode without sign-in", async () => {
    state.userId = null;
    const res = await fetch(`${base}/api/checkout-profile?sellerIds=seller_fr,seller_en`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      profiles: {
        seller_fr: { language: "fr", checkoutMode: "guest_only" },
        seller_en: { language: "en", checkoutMode: "accounts_optional" },
      },
    });
  });
});
