import crypto from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db, storefrontCustomDomains, storefronts, users } from "@workspace/db";

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: () => void) => {
    req.clerkUserId = req.header("x-test-user-id");
    if (!req.clerkUserId) return res.status(401).end();
    next();
  },
}));
vi.mock("../../middlewares/rateLimit", () => ({
  rateLimit: () => (_req: any, _res: any, next: () => void) => next(),
}));
const { default: storeAddressRouter } = await import("../store-address");

const sfx = crypto.randomBytes(4).toString("hex");
const A = `sa-${sfx}-a`;
const B = `sa-${sfx}-b`;
let server: Server;
let base = "";

beforeAll(async () => {
  await db.insert(users).values([
    { clerkId: A, email: `${A}@example.test`, name: "A", username: `sa_${sfx}_a`, accountType: "seller", onboardingComplete: true },
    { clerkId: B, email: `${B}@example.test`, name: "B", username: `sa_${sfx}_b`, accountType: "seller", onboardingComplete: true },
  ]);
  await db.insert(storefronts).values([
    { ownerId: A, slug: `store-${sfx}a`, title: "A" },
    { ownerId: B, slug: `taken-${sfx}`, title: "B", status: "published" },
  ]);
  const [sfB] = await db.select().from(storefronts).where(eq(storefronts.ownerId, B));
  await db.insert(storefrontCustomDomains).values([
    { storefrontId: sfB.id, domain: `shop-${sfx}.example.com`, verifyToken: "t1", verified: true },
    { storefrontId: sfB.id, domain: `pending-${sfx}.example.com`, verifyToken: "t2", verified: false },
  ]);
  const app = express();
  app.use(express.json());
  app.use("/api/store", storeAddressRouter);
  app.post("/api/store/domains", (_req, res) => { res.json({ reached: "store.ts" }); });
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(() => vi.unstubAllEnvs());
afterAll(async () => {
  const sfs = await db.select({ id: storefronts.id }).from(storefronts).where(inArray(storefronts.ownerId, [A, B]));
  await db.delete(storefrontCustomDomains).where(inArray(storefrontCustomDomains.storefrontId, sfs.map((r) => r.id)));
  await db.delete(storefronts).where(inArray(storefronts.ownerId, [A, B]));
  await db.delete(users).where(inArray(users.clerkId, [A, B]));
  await new Promise((resolve) => server.close(resolve));
});

const call = async (method: string, path: string, as: string | null, body?: unknown) => {
  const r = await fetch(`${base}${path}`, {
    method, headers: { "content-type": "application/json", ...(as ? { "x-test-user-id": as } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: r.status === 401 ? null : await r.json() as any };
};

describe("store address on the server (BT-317)", () => {
  it("saves a new subdomain on the server, never claims it is live while hosting is off", async () => {
    const r = await call("PATCH", "/api/store/slug", A, { slug: `North-${sfx}` });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ slug: `north-${sfx}`, subdomainHost: `north-${sfx}.brandthread.app`, subdomainsLive: false, customDomainsLive: false });
    expect(r.body.liveUrl).toBe(`https://brandthread.app/store/sa_${sfx}_a`);
    const [sf] = await db.select({ slug: storefronts.slug }).from(storefronts).where(eq(storefronts.ownerId, A));
    expect(sf.slug).toBe(`north-${sfx}`);
  });

  it("refuses taken, reserved and malformed addresses", async () => {
    expect((await call("PATCH", "/api/store/slug", A, { slug: `TAKEN-${sfx}` })).body.code).toBe("SLUG_TAKEN");
    expect((await call("PATCH", "/api/store/slug", A, { slug: "www" })).status).toBe(400);
    expect((await call("PATCH", "/api/store/slug", A, { slug: "a b" })).status).toBe(400);
    expect((await call("PATCH", "/api/store/slug", null, { slug: "fine-name" })).status).toBe(401);
  });

  it("shares the subdomain once it is switched on", async () => {
    vi.stubEnv("STORE_SUBDOMAINS_ENABLED", "true");
    const r = await call("GET", "/api/store/address", A);
    expect(r.body).toMatchObject({ subdomainsLive: true, liveUrl: `https://north-${sfx}.brandthread.app` });
  });
});

describe("custom domains (BT-318)", () => {
  it("can't be added until custom domain hosting is on", async () => {
    const off = await call("POST", "/api/store/domains", A, { domain: "shop.example.com" });
    expect(off).toEqual({ status: 403, body: { error: "Custom domains aren't available yet.", code: "CUSTOM_DOMAINS_OFF" } });
    vi.stubEnv("CUSTOM_DOMAINS_ENABLED", "true");
    vi.stubEnv("CUSTOM_DOMAIN_CNAME_TARGET", "stores.brandthread.app");
    expect((await call("POST", "/api/store/domains", A, { domain: "shop.example.com" })).body).toEqual({ reached: "store.ts" });
  });
});

describe("custom domain host lookup for the host worker (BT-307)", () => {
  it("answers only for a verified domain of a published store", async () => {
    expect((await call("GET", `/api/store/host-lookup?host=SHOP-${sfx}.example.com`, null)).body).toEqual({ slug: `taken-${sfx}` });
    expect((await call("GET", `/api/store/host-lookup?host=pending-${sfx}.example.com`, null)).status).toBe(404);
    expect((await call("GET", `/api/store/host-lookup?host=x.brandthread.app`, null)).status).toBe(404);
  });
});
