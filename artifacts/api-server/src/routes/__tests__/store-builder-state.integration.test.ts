/**
 * Integration tests for PUT /api/store persisting Store Builder state
 * (migration 270) — collections, pages, navigation, store settings, brand
 * assets, setup checklist, onboarding — plus the socialLinks/analyticsCode
 * keys that used to be silently dropped by snake_case mapping.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { db, storefronts } from "@workspace/db";
import { eq } from "drizzle-orm";
import crypto from "node:crypto";

// ─── Clerk stub ───────────────────────────────────────────────────────────────
// The requireAuth middleware reads the Clerk JWT.  We stub it to inject a known
// owner id so tests don't need a real token.
const TEST_OWNER = `test-owner-${crypto.randomBytes(4).toString("hex")}`;

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.clerkUserId = TEST_OWNER;
    next();
  },
}));

// ─── App bootstrap ─────────────────────────────────────────────────────────────
let server: Server;
let base: string;

async function request(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: any }> {
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
  // Import the real router (requireAuth is already stubbed above)
  const { default: storeRouter } = await import("../store");
  const app = express();
  app.use(express.json());
  app.use("/api/store", storeRouter);

  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await db.delete(storefronts).where(eq(storefronts.ownerId, TEST_OWNER));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("PUT /api/store builder state", () => {
  it("persists builder JSON fields and returns them from GET", async () => {
    const payload = {
      collections: [{ id: "c1", title: "Summer", productIds: [], published: true }],
      pages: [{ id: "p1", title: "About", slug: "about", body: "Hi", published: true }],
      navigation: [{ id: "n1", label: "About", type: "page", target: "about" }],
      storeSettings: { currency: "EUR", language: "fr", guestCheckout: false },
      brandAssets: { colors: ["#000000"] },
      setupChecklist: { addProduct: true },
      onboarding: { goals: ["grow_sales"] },
      socialLinks: { instagram: "brand" },
      analyticsCode: "G-TEST",
    };
    const put = await request("PUT", "/api/store", payload);
    expect(put.status).toBe(200);

    const get = await request("GET", "/api/store");
    expect(get.status).toBe(200);
    for (const [key, value] of Object.entries(payload)) {
      expect(get.body[key]).toEqual(value);
    }
  });

  it("rejects wrongly-shaped builder fields with 400", async () => {
    expect((await request("PUT", "/api/store", { pages: { not: "an array" } })).status).toBe(400);
    expect((await request("PUT", "/api/store", { storeSettings: ["nope"] })).status).toBe(400);
  });
});
