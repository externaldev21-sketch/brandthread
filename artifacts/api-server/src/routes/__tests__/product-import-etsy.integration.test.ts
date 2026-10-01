import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import crypto from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { eq, inArray, like } from "drizzle-orm";
import { db, products, productVariants, etsyConnections, etsyOauthStates, productImportRuns } from "@workspace/db";
import { setEtsyApiForTests, EtsyApiError, type EtsyApi, type EtsyListing } from "../../lib/etsy/client";
import { decryptEtsySecret } from "../../lib/etsy/config";

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: () => void) => {
    const user = req.header("x-test-user");
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
    req.clerkUserId = user;
    next();
  },
}));
vi.mock("../../middlewares/requireRole", () => ({
  teamContext: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../../lib/planAccess", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/planAccess")>();
  return { ...actual, getVerifiedPlanAccess: async () => ({ planId: "starter", limits: { products: null } }) };
});

let server: Server;
let base = "";
const prefix = `pimp-etsy-${crypto.randomBytes(6).toString("hex")}`;
const seller = `${prefix}-a`;
const otherSeller = `${prefix}-b`;
const money = (amount: number) => ({ amount, divisor: 100, currency_code: "USD" });

const listings: EtsyListing[] = [
  { listing_id: 101, title: "Linen Scarf", description: "Soft", price: money(3400), quantity: 4, sku: ["SCARF"], tags: ["linen"], images: [{ url_fullxfull: "https://i.etsystatic.com/a.jpg", rank: 1 }] },
  { listing_id: 102, title: "Tote", price: money(2000), quantity: 9, inventory: { products: [
    { sku: "TOTE-S", property_values: [{ property_name: "Size", values: ["Small"] }], offerings: [{ price: money(2000), quantity: 2, is_enabled: true }] },
    { sku: "TOTE-L", property_values: [{ property_name: "Size", values: ["Large"] }], offerings: [{ price: money(2400), quantity: 5, is_enabled: true }] },
  ] } },
];

const calls = { exchange: [] as any[], refresh: 0, pages: 0 };
let failListingsWith: EtsyApiError | null = null;
const fake: EtsyApi = {
  async exchangeCode(input) { calls.exchange.push(input); return { accessToken: "555.access", refreshToken: "refresh-1", expiresInSeconds: 3600 }; },
  async refresh() { calls.refresh++; return { accessToken: "555.access2", refreshToken: "refresh-2", expiresInSeconds: 3600 }; },
  async getMyShop() { return { userId: "555", shopId: "9001", shopName: "Scarf Shop" }; },
  async getActiveListings(_t, _s, { limit, offset }) {
    calls.pages++;
    if (failListingsWith) throw failListingsWith;
    return { count: listings.length, results: listings.slice(offset, offset + limit) };
  },
};

function call(user: string, route: string, method = "GET") {
  return fetch(`${base}/api/product-import${route}`, { method, headers: { "x-test-user": user } });
}

beforeAll(async () => {
  process.env.ETSY_API_KEY = "key"; process.env.ETSY_SHARED_SECRET = "secret";
  process.env.ETSY_REDIRECT_URI = "https://api.example.com/api/product-import/etsy/callback";
  process.env.ETSY_TOKEN_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");
  setEtsyApiForTests(fake);
  const { default: router, etsyCallbackRouter } = await import("../product-import");
  const app = express();
  app.use(express.json());
  app.use("/api/product-import/etsy/callback", etsyCallbackRouter);
  app.use("/api/product-import", router);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

beforeEach(() => { calls.exchange = []; calls.refresh = 0; calls.pages = 0; failListingsWith = null; });

afterEach(async () => {
  const owned = await db.select({ id: products.id }).from(products).where(like(products.ownerId, `${prefix}%`));
  if (owned.length) {
    await db.delete(productVariants).where(inArray(productVariants.productId, owned.map((p) => p.id)));
    await db.delete(products).where(inArray(products.id, owned.map((p) => p.id)));
  }
  await db.delete(productImportRuns).where(like(productImportRuns.ownerId, `${prefix}%`));
  await db.delete(etsyConnections).where(like(etsyConnections.ownerId, `${prefix}%`));
  await db.delete(etsyOauthStates).where(like(etsyOauthStates.ownerId, `${prefix}%`));
});

afterAll(async () => {
  setEtsyApiForTests(null);
  for (const k of ["ETSY_API_KEY", "ETSY_SHARED_SECRET", "ETSY_REDIRECT_URI", "ETSY_TOKEN_ENCRYPTION_KEY"]) delete process.env[k];
  await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
});

async function connect(user = seller) {
  const start: any = await (await call(user, "/etsy/connect/start", "POST")).json();
  const state = new URL(start.authorizeUrl).searchParams.get("state")!;
  const cb = await fetch(`${base}/api/product-import/etsy/callback?code=abc&state=${state}`);
  return { start, state, cb };
}

describe("Etsy connect", () => {
  it("issues a PKCE authorize URL, stores only ciphertext, and completes the callback", async () => {
    const { start, cb } = await connect();
    const url = new URL(start.authorizeUrl);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(cb.status).toBe(200);
    expect(await cb.text()).toContain("Etsy connected");
    expect(calls.exchange).toHaveLength(1);
    // the verifier sent to Etsy hashes to the challenge in the URL
    const challenge = crypto.createHash("sha256").update(calls.exchange[0].codeVerifier).digest("base64url");
    expect(url.searchParams.get("code_challenge")).toBe(challenge);
    const [row] = await db.select().from(etsyConnections).where(eq(etsyConnections.ownerId, seller));
    expect(row.accessTokenEncrypted).not.toContain("555.access");
    expect(row.refreshTokenEncrypted).not.toContain("refresh-1");
    expect(decryptEtsySecret(row.accessTokenEncrypted)).toBe("555.access");
    expect(row).toMatchObject({ shopId: "9001", shopName: "Scarf Shop", status: "connected" });
    const providers: any = await (await call(seller, "/providers")).json();
    expect(providers.etsy).toEqual({ enabled: true, connected: true, shopName: "Scarf Shop" });
    expect((await (await call(otherSeller, "/providers")).json() as any).etsy.connected).toBe(false);
  });

  it("rejects unknown, reused and expired state", async () => {
    const bad = await fetch(`${base}/api/product-import/etsy/callback?code=abc&state=nope`);
    expect(bad.status).toBe(400);
    const { state } = await connect();
    const reuse = await fetch(`${base}/api/product-import/etsy/callback?code=abc&state=${state}`);
    expect(reuse.status).toBe(400);
    const start: any = await (await call(seller, "/etsy/connect/start", "POST")).json();
    const s2 = new URL(start.authorizeUrl).searchParams.get("state")!;
    await db.update(etsyOauthStates).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(etsyOauthStates.state, s2));
    const expired = await fetch(`${base}/api/product-import/etsy/callback?code=abc&state=${s2}`);
    expect(expired.status).toBe(400);
  });
});

describe("Etsy import via the fake client", () => {
  it("requires a connection", async () => {
    const res = await call(seller, "/etsy/preview", "POST");
    expect(res.status).toBe(409);
    expect((await res.json() as any).error).toBe("ETSY_NOT_CONNECTED");
  });

  it("previews without writing, then commits through the shared path, idempotently", async () => {
    await connect();
    const preview: any = await (await call(seller, "/etsy/preview", "POST")).json();
    expect(preview).toMatchObject({ layout: "etsy", source: "etsy_api" });
    expect(preview.counts).toMatchObject({ products: 2, variants: 3, create: 2 });
    expect(await db.select().from(products).where(eq(products.ownerId, seller))).toHaveLength(0);

    const commit: any = await (await call(seller, "/etsy/commit", "POST")).json();
    expect(commit.counts).toMatchObject({ created: 2, failed: 0 });
    const rows = await db.select().from(products).where(eq(products.ownerId, seller));
    expect(rows.map((r) => r.status)).toEqual(["draft", "draft"]);
    const tote = rows.find((r) => r.name === "Tote")!;
    const variants = await db.select().from(productVariants).where(eq(productVariants.productId, tote.id));
    expect(variants.map((v) => [v.sku, v.size, v.priceCents, v.stock]).sort()).toEqual([["TOTE-L", "Large", 2400, 5], ["TOTE-S", "Small", 2000, 2]]);

    const again: any = await (await call(seller, "/etsy/commit", "POST")).json();
    expect(again.counts).toMatchObject({ created: 0, unchanged: 2 });
    expect(await db.select().from(products).where(eq(products.ownerId, seller))).toHaveLength(2);
  });

  it("refreshes an expiring token and stores the new ciphertext", async () => {
    await connect();
    await db.update(etsyConnections).set({ expiresAt: new Date(Date.now() + 5_000) }).where(eq(etsyConnections.ownerId, seller));
    const res = await call(seller, "/etsy/preview", "POST");
    expect(res.status).toBe(200);
    expect(calls.refresh).toBe(1);
    const [row] = await db.select().from(etsyConnections).where(eq(etsyConnections.ownerId, seller));
    expect(decryptEtsySecret(row.accessTokenEncrypted)).toBe("555.access2");
    expect(decryptEtsySecret(row.refreshTokenEncrypted)).toBe("refresh-2");
  });

  it("maps Etsy failures to clear responses", async () => {
    await connect();
    failListingsWith = new EtsyApiError(429, "rate");
    let res = await call(seller, "/etsy/preview", "POST");
    expect(res.status).toBe(429);
    failListingsWith = new EtsyApiError(401, "nope");
    res = await call(seller, "/etsy/preview", "POST");
    expect(res.status).toBe(409);
    expect((await res.json() as any).error).toBe("ETSY_RECONNECT");
    const providers: any = await (await call(seller, "/providers")).json();
    expect(providers.etsy.connected).toBe(false);
  });

  it("disconnect removes stored tokens", async () => {
    await connect();
    await call(seller, "/etsy/disconnect", "POST");
    expect(await db.select().from(etsyConnections).where(eq(etsyConnections.ownerId, seller))).toHaveLength(0);
  });
});
