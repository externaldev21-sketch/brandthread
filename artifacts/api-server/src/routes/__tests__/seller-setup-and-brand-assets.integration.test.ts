/**
 * Server-persisted seller setup checklist (/api/seller/launch-checklist/setup)
 * and Brand Assets library (/api/seller/brand-assets): state survives a new
 * device, derived tasks cannot be ticked by hand, goals reorder tasks, and
 * device-local image URIs are refused.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { db, storefronts, users } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

const suffix = crypto.randomBytes(6).toString("hex");
const sellerA = `setup-a-${suffix}`;
const sellerB = `setup-b-${suffix}`;

const authState = vi.hoisted(() => ({ clerkUserId: "" }));
vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: unknown, next: () => void) => {
    req.clerkUserId = authState.clerkUserId;
    next();
  },
}));

let server: Server;
let base = "";

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(`${base}/api/seller${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) as any };
}

beforeAll(async () => {
  await db.insert(users).values([
    { clerkId: sellerA, email: `${sellerA}@test.local`, name: "A", displayName: "A", role: "seller", accountType: "seller", onboardingComplete: true },
    { clerkId: sellerB, email: `${sellerB}@test.local`, name: "B", displayName: "B", role: "seller", accountType: "seller" },
  ]);
  const { default: checklist } = await import("../seller-launch-checklist");
  const { default: brandAssets } = await import("../seller-brand-assets");
  const app = express();
  app.use(express.json());
  app.use("/api/seller/launch-checklist", checklist);
  app.use("/api/seller/brand-assets", brandAssets);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(storefronts).where(inArray(storefronts.ownerId, [sellerA, sellerB]));
  await db.delete(users).where(inArray(users.clerkId, [sellerA, sellerB]));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("GET/PUT /launch-checklist/setup", () => {
  it("derives done flags from real data", async () => {
    authState.clerkUserId = sellerA;
    const r = await call("GET", "/launch-checklist/setup");
    expect(r.status).toBe(200);
    expect(r.body.derived).toMatchObject({ verify_account: true, connect_payments: false, first_product: false });
    expect(r.body.derivedTaskIds).toContain("connect_payments");

    await db.update(users).set({ stripeAccountStatus: "active", logoUrl: "/objects/logo" }).where(eq(users.clerkId, sellerA));
    const after = await call("GET", "/launch-checklist/setup");
    expect(after.body.derived).toMatchObject({ connect_payments: true, customize_store: true });
  });

  it("persists state server-side and refuses manual completion of derived tasks", async () => {
    authState.clerkUserId = sellerB;
    const put = await call("PUT", "/launch-checklist/setup", {
      state: {
        started: true,
        walkthroughShown: true,
        tasks: { connect_payments: { completed: true }, first_post: { skipped: true }, connect_manufacturer: { completed: true } },
      },
    });
    expect(put.status).toBe(200);
    expect(put.body.derived.connect_payments).toBe(false);
    const again = await call("GET", "/launch-checklist/setup");
    expect(again.body.state.started).toBe(true);
    expect(again.body.state.walkthroughShown).toBe(true);
    expect(again.body.state.tasks.connect_payments).toBeUndefined();
    expect(again.body.state.tasks.first_post).toEqual({ skipped: true });
    expect(again.body.state.tasks.connect_manufacturer).toEqual({ completed: true });

    authState.clerkUserId = sellerA;
    expect((await call("GET", "/launch-checklist/setup")).body.state.started).toBe(false);
  });

  it("orders tasks from onboarding goals", async () => {
    authState.clerkUserId = sellerA;
    await db.update(storefronts).set({ onboarding: { goals: ["Ship orders"] } }).where(eq(storefronts.ownerId, sellerA));
    const r = await call("GET", "/launch-checklist/setup");
    expect(r.body.goals).toEqual(["Ship orders"]);
    expect(r.body.order.slice(0, 2)).toEqual(["verify_account", "shipping_rates"]);
  });

  it("400s without a state object", async () => {
    authState.clerkUserId = sellerA;
    expect((await call("PUT", "/launch-checklist/setup", { state: [] })).status).toBe(400);
  });
});

describe("GET/PUT /brand-assets", () => {
  it("saves colors and fonts and reads them back (new device)", async () => {
    authState.clerkUserId = sellerA;
    const assets = [
      { id: "a1", name: "#0ea5e9", type: "color", color: "#0ea5e9", tags: [], createdAt: "2026-10-01T00:00:00.000Z" },
      { id: "a2", name: "Inter", type: "font", fontFamily: "Inter", tags: [] },
    ];
    const put = await call("PUT", "/brand-assets", { assets });
    expect(put.status).toBe(200);
    const get = await call("GET", "/brand-assets");
    expect(get.body.assets.map((a: any) => a.id)).toEqual(["a1", "a2"]);
    expect(get.body.assets[0].color).toBe("#0EA5E9");

    authState.clerkUserId = sellerB;
    expect((await call("GET", "/brand-assets")).body.assets).toEqual([]);
  });

  it("keeps other brandAssets keys", async () => {
    authState.clerkUserId = sellerA;
    await db.update(storefronts).set({ brandAssets: { other: 1, library: [] } }).where(eq(storefronts.ownerId, sellerA));
    await call("PUT", "/brand-assets", { assets: [] });
    const [sf] = await db.select().from(storefronts).where(eq(storefronts.ownerId, sellerA));
    expect((sf.brandAssets as any).other).toBe(1);
  });

  it("refuses device-local image URIs and bad shapes", async () => {
    authState.clerkUserId = sellerA;
    expect((await call("PUT", "/brand-assets", { assets: [{ id: "x", name: "Logo", type: "logo", remoteUrl: "file:///var/logo.png", tags: [] }] })).status).toBe(400);
    expect((await call("PUT", "/brand-assets", { assets: [{ id: "x", name: "Logo", type: "logo", tags: [] }] })).status).toBe(400);
    expect((await call("PUT", "/brand-assets", { assets: [{ id: "x", name: "Red", type: "color", color: "red", tags: [] }] })).status).toBe(400);
    expect((await call("PUT", "/brand-assets", { assets: "nope" })).status).toBe(400);
  });
});
