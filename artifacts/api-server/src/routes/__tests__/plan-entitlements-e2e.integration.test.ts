/**
 * Seller plans, enforced on the server and reported honestly to the app:
 *  - the free onboarding sample mount no longer exposes the paid logo
 *    generator (POST /api/onboarding-sample/generate was unlimited, no plan);
 *  - GET /seller/subscription/entitlement returns the plan the server
 *    actually honours — an unpaid Stripe subscription unlocks nothing — and
 *    gives a team member the STORE's plan (they can't read owner-only /status);
 *  - Shopify product imports count toward the Starter product cap.
 * Real routers + Postgres; Clerk identity and the Shopify Admin API stubbed.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { eq, inArray } from "drizzle-orm";
import { db, products, productVariants, shopifyProductLinks, teamMembers, users } from "@workspace/db";

vi.hoisted(() => {
  process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ??= "http://127.0.0.1:9/openai";
  process.env.AI_INTEGRATIONS_OPENAI_API_KEY ??= "test-key-not-used";
});
vi.mock("@clerk/express", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@clerk/express")>()),
  getAuth: (req: any) => ({ userId: req.headers?.["x-test-user-id"] ?? null }),
}));
vi.mock("../../lib/shopify/adminClient", () => ({
  ShopifyAdminClient: class {
    async getProduct(id: string) {
      return { product: { id, title: `Imported ${id}`, variants: [{ id: `${id}-v`, price: "40.00", sku: `SKU-${id}-${process.pid}` }] } };
    }
  },
}));

import { onboardingSampleRouter } from "../logo";
import subscriptionRouter from "../subscription";
import { importShopifyProducts } from "../../lib/shopify/productImport";

const sfx = crypto.randomUUID().slice(0, 8);
const OWNER = `plan-e2e-owner-${sfx}`;
const MEMBER = `plan-e2e-member-${sfx}`;
const STARTER = `plan-e2e-starter-${sfx}`;
const ALL = [OWNER, MEMBER, STARTER];
let server: Server;
let base = "";

async function call(method: string, path: string, userId: string, body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method, headers: { "x-test-user-id": userId, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) as any };
}

beforeAll(async () => {
  await db.insert(users).values([
    { clerkId: OWNER, email: `${OWNER}@t.test`, name: "Owner", onboardingComplete: true, subscriptionPlanId: "growth", subscriptionStatus: "unpaid", subscriptionId: "sub_test_unpaid" },
    { clerkId: MEMBER, email: `${MEMBER}@t.test`, name: "Member", onboardingComplete: false },
    { clerkId: STARTER, email: `${STARTER}@t.test`, name: "Starter seller", onboardingComplete: true },
  ]);
  await db.insert(teamMembers).values({ ownerId: OWNER, memberClerkId: MEMBER, email: `${MEMBER}@t.test`, role: "viewer", status: "active" });
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => { req.clerkUserId = req.headers["x-test-user-id"]; next(); });
  app.use("/api/onboarding-sample", onboardingSampleRouter);
  app.use("/api/seller/subscription", subscriptionRouter);
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server?.close();
  const owned = await db.select({ id: products.id }).from(products).where(inArray(products.ownerId, ALL));
  if (owned.length) {
    await db.delete(shopifyProductLinks).where(inArray(shopifyProductLinks.ownerId, ALL));
    await db.delete(productVariants).where(inArray(productVariants.productId, owned.map((p) => p.id)));
    await db.delete(products).where(inArray(products.ownerId, ALL));
  }
  await db.delete(teamMembers).where(eq(teamMembers.ownerId, OWNER));
  await db.delete(users).where(inArray(users.clerkId, ALL));
});

describe("plans enforced server-side, reported honestly", () => {
  it("the onboarding-sample mount does not expose the paid logo generator", async () => {
    const res = await call("POST", "/api/onboarding-sample/generate", STARTER, { brandName: "Free Logos Forever" });
    expect(res.status).toBe(404);
  });

  it("an unpaid subscription keeps its billed plan but unlocks nothing", async () => {
    const res = await call("GET", "/api/seller/subscription/entitlement", OWNER);
    expect(res.status).toBe(200);
    expect(res.body.plan).toBe("starter");

    await db.update(users).set({ subscriptionStatus: "active" }).where(eq(users.clerkId, OWNER));
    expect((await call("GET", "/api/seller/subscription/entitlement", OWNER)).body.plan).toBe("growth");
  });

  it("a team member sees the STORE's plan (and still can't read billing)", async () => {
    const res = await call("GET", "/api/seller/subscription/entitlement", MEMBER);
    expect(res.status).toBe(200);
    expect(res.body.plan).toBe("growth");
    expect((await call("GET", "/api/seller/subscription/status", MEMBER)).status).toBe(403);
  });

  it("Shopify imports stop at the Starter product cap (25)", async () => {
    await db.insert(products).values(Array.from({ length: 23 }, (_, i) => ({ ownerId: STARTER, name: `Existing ${i}`, status: "draft" })));
    const summary = await importShopifyProducts({
      ownerId: STARTER, shopDomain: `cap-${sfx}.myshopify.com`, accessToken: "x",
      shopifyProductIds: ["101", "102", "103", "104"], publishStatus: "draft",
    });
    expect(summary.imported).toBe(2);
    expect(summary.skipped).toHaveLength(2);
    expect(summary.skipped[0].reason).toMatch(/allows 25 products/);
    const rows = await db.select({ id: products.id }).from(products).where(eq(products.ownerId, STARTER));
    expect(rows).toHaveLength(25);
  });
});
