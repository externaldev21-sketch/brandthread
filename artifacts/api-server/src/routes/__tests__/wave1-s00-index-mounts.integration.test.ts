/**
 * Wave 1 / slice s00: mount-order and path-spelling defects in routes/index.ts,
 * end to end through the REAL API router, real middlewares and a real
 * Postgres. Only Clerk's getAuth is stubbed (the caller comes from a header),
 * and the AI credits gate is replaced by a marker so the test can see whether
 * a request reached it.
 *
 *   - /support-chat was mounted twice; the first mount sat above aiCreditsGate
 *     and answered every message, so support chat was never metered.
 *   - teamContext's per-router rules were looked up by the caller's spelling of
 *     the mount, so `/api/STORE` skipped the "products" write gate.
 *   - /seller/* routers mounted below the /seller catch-all inherited its
 *     "products" write gate: a viewer could not save their own notification
 *     prefs and a marketing member could not create the product feed.
 *   - Admin: `status=delivered` was rejected on the order list, and a
 *     fractional `limit` 500'd the B2B dispute list.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { eq, inArray } from "drizzle-orm";
import { aiDataConsents, db, storefronts, teamMembers, users } from "@workspace/db";

vi.hoisted(() => {
  process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ??= "http://127.0.0.1:9/openai";
  process.env.AI_INTEGRATIONS_OPENAI_API_KEY ??= "test-key-not-used";
});

vi.mock("@clerk/express", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@clerk/express")>();
  return {
    ...actual,
    getAuth: (req: any) => ({ userId: req.headers?.["x-test-user-id"] ?? null }),
  };
});
vi.mock("../../ws/auth", () => ({ verifyWsToken: async () => null }));
vi.mock("../../lib/aiCredits/gate", () => ({
  aiCreditsGate: (req: any, res: any, next: () => void) => {
    if (String(req.path).toLowerCase().startsWith("/support-chat/message")) {
      res.status(429).json({ code: "METERED_BY_AI_CREDITS_GATE" });
      return;
    }
    next();
  },
}));

import apiRouter from "../index";
import { setAiConsent } from "../../lib/aiConsent";

const suffix = crypto.randomUUID().slice(0, 8);
const O = `w1s00-owner-${suffix}`;
const K = `w1s00-marketing-${suffix}`;
const V = `w1s00-viewer-${suffix}`;
const A = `w1s00-admin-${suffix}`;
const ALL = [O, K, V, A];
let server: Server;
let base = "";

async function call(method: string, path: string, userId: string, body?: unknown) {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: { "x-test-user-id": userId, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) as any };
}

beforeAll(async () => {
  await db.insert(users).values([
    { clerkId: O, email: `${O}@test.example`, name: "Owner", brandName: "Owner Studio", onboardingComplete: true, accountType: "seller" },
    { clerkId: K, email: `${K}@test.example`, name: "Marketer", onboardingComplete: false },
    { clerkId: V, email: `${V}@test.example`, name: "Viewer", onboardingComplete: false },
    { clerkId: A, email: `${A}@test.example`, name: "Admin", onboardingComplete: false, role: "admin" },
  ]);
  await db.insert(teamMembers).values([
    { ownerId: O, memberClerkId: K, email: `${K}@test.example`, role: "marketing", status: "active" },
    { ownerId: O, memberClerkId: V, email: `${V}@test.example`, role: "viewer", status: "active" },
  ]);
  await setAiConsent(O, true);

  const app = express();
  app.use(express.json());
  app.use("/api", apiRouter);
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server?.close();
  await db.delete(aiDataConsents).where(inArray(aiDataConsents.clerkUserId, ALL));
  await db.delete(storefronts).where(inArray(storefronts.ownerId, ALL));
  await db.delete(teamMembers).where(eq(teamMembers.ownerId, O));
  await db.delete(users).where(inArray(users.clerkId, ALL));
});

describe("routes/index.ts mount order", () => {
  it("support chat messages pass through the AI credits gate", async () => {
    const res = await call("POST", "/support-chat/message", O, { message: "How do I add a product?" });
    expect(res.body.code).toBe("METERED_BY_AI_CREDITS_GATE");
    expect(res.status).toBe(429);
  });

  it("a viewer can save their OWN notification prefs at /seller/notification-prefs", async () => {
    const res = await call("PUT", "/seller/notification-prefs", V, { pushEnabled: false });
    expect(res.status).toBe(200);
    const rows = await db.select({ clerkId: users.clerkId, pushEnabled: users.pushEnabled })
      .from(users).where(inArray(users.clerkId, [O, V]));
    const by = new Map(rows.map((r) => [r.clerkId, r.pushEnabled]));
    expect(by.get(V)).toBe(false);
    expect(by.get(O)).toBe(true);
  });

  it("a marketing member reaches the product feed router; a viewer is still refused", async () => {
    const marketing = await call("POST", "/seller/product-feed", K, {});
    expect(marketing.status).not.toBe(403);
    expect(marketing.body.code).toBe("PRODUCT_FEEDS_NOT_CONFIGURED");
    const viewer = await call("POST", "/seller/product-feed", V, {});
    expect(viewer.status).toBe(403);
  });

  it("the moved /seller/* routers keep the products write gate", async () => {
    const res = await call("PUT", "/seller/away-message", V, { enabled: true, message: "Away" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("PERMISSION_REQUIRED");
  });
});

describe("team route rules by any spelling", () => {
  for (const path of ["/STORE", "/Store/"]) {
    it(`a viewer cannot write the owner's store via ${path}`, async () => {
      const res = await call("PUT", path, V, { title: "Viewer edit" });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("PERMISSION_REQUIRED");
    });
  }
});

describe("admin list filters", () => {
  it("accepts status=delivered on the order list", async () => {
    const res = await call("GET", "/admin/orders?status=delivered", A);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
  });

  it("does not 500 on a fractional B2B dispute limit", async () => {
    const res = await call("GET", "/admin/b2b-disputes?limit=2.5", A);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
  });
});
