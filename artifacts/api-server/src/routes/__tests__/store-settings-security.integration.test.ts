/**
 * Integration tests for Store Settings persistence:
 *  - storeSettings never stores/returns a plaintext store password
 *  - PUT /api/store/password stores only a scrypt hash; GET exposes hasStorePassword
 *  - PUT /api/store/slug validates, enforces uniqueness and updates the real slug
 *  - PUT /api/seller/settings/policies actually persists (migration 272 column)
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { db, storefronts } from "@workspace/db";
import { eq, inArray, sql } from "drizzle-orm";
import crypto from "node:crypto";
import { verifyStorePassword } from "../../lib/storeSettingsSecurity";

const TEST_OWNER = `test-owner-${crypto.randomBytes(4).toString("hex")}`;
const OTHER_OWNER = `test-other-${crypto.randomBytes(4).toString("hex")}`;
const OTHER_SLUG = `taken-${crypto.randomBytes(4).toString("hex")}`;

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.clerkUserId = TEST_OWNER;
    next();
  },
}));

let server: Server;
let base: string;

async function request(method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json: any;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}

beforeAll(async () => {
  const { default: storeRouter } = await import("../store");
  const { default: sellerSettingsRouter } = await import("../seller-settings-route");
  const app = express();
  app.use(express.json());
  app.use("/api/store", storeRouter);
  app.use("/api/seller/settings", sellerSettingsRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  await db.insert(storefronts).values({ ownerId: OTHER_OWNER, slug: OTHER_SLUG, title: "Other" });
});

afterAll(async () => {
  await db.delete(storefronts).where(inArray(storefronts.ownerId, [TEST_OWNER, OTHER_OWNER]));
  await db.execute(sql`DELETE FROM seller_settings WHERE owner_id IN (${TEST_OWNER}, ${OTHER_OWNER})`);
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("store settings + password", () => {
  it("persists settings, strips a plaintext password from storeSettings", async () => {
    const put = await request("PUT", "/api/store", {
      title: "Brand",
      storeSettings: { currency: "EUR", contactEmail: "me@brand.com", checkoutGuestAllowed: false, storePassword: "plain" },
    });
    expect(put.status).toBe(200);
    expect(put.body.storeSettings.storePassword).toBeUndefined();
    const get = await request("GET", "/api/store");
    // Guest checkout off writes through to checkoutMode "accounts_required"
    // (lib/storeSettingsEffects.ts), so the view reports accounts as required too.
    expect(get.body.storeSettings).toEqual({ currency: "EUR", contactEmail: "me@brand.com", checkoutGuestAllowed: false, checkoutRequireAccount: true });
    expect(get.body.hasStorePassword).toBe(false);
    expect(get.body.storePasswordHash).toBeUndefined();
    expect(typeof get.body.customDomainRoutingEnabled).toBe("boolean");
  });

  it("hashes the store password and never returns it", async () => {
    expect((await request("PUT", "/api/store/password", { password: "ab" })).status).toBe(400);
    const put = await request("PUT", "/api/store/password", { password: "open-sesame" });
    expect(put.status).toBe(200);
    expect(put.body).toEqual({ ok: true, hasStorePassword: true });

    const [row] = await db.select().from(storefronts).where(eq(storefronts.ownerId, TEST_OWNER));
    expect(row.storePasswordHash).toBeTruthy();
    expect(row.storePasswordHash).not.toContain("open-sesame");
    expect(await verifyStorePassword("open-sesame", row.storePasswordHash)).toBe(true);

    const get = await request("GET", "/api/store");
    expect(get.body.hasStorePassword).toBe(true);
    expect(JSON.stringify(get.body)).not.toContain(row.storePasswordHash!);

    const clear = await request("PUT", "/api/store/password", { password: null });
    expect(clear.body.hasStorePassword).toBe(false);
    expect((await request("GET", "/api/store")).body.hasStorePassword).toBe(false);
  });
});

describe("PUT /api/store/slug", () => {
  it("rejects invalid, reserved and taken slugs", async () => {
    expect((await request("PUT", "/api/store/slug", { slug: "No Spaces" })).status).toBe(400);
    expect((await request("PUT", "/api/store/slug", { slug: "admin" })).status).toBe(400);
    const taken = await request("PUT", "/api/store/slug", { slug: OTHER_SLUG });
    expect(taken.status).toBe(409);
    expect(taken.body.error).toMatch(/taken/);
  });

  it("updates the real slug", async () => {
    const slug = `mine-${crypto.randomBytes(4).toString("hex")}`;
    const put = await request("PUT", "/api/store/slug", { slug: slug.toUpperCase() });
    expect(put.status).toBe(200);
    expect(put.body.slug).toBe(slug);
    expect((await request("GET", "/api/store")).body.slug).toBe(slug);
  });
});

describe("seller settings policies", () => {
  it("persists policies to the storefront", async () => {
    const policies = [{ type: "shipping", content: "Ships in 2 days" }];
    const put = await request("PUT", "/api/seller/settings/policies", { policies });
    expect(put.status).toBe(200);
    const get = await request("GET", "/api/seller/settings/policies");
    expect(get.status).toBe(200);
    expect(get.body.policies).toEqual(policies);
  });
});
