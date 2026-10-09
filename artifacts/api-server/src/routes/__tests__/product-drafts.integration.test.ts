import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { inArray } from "drizzle-orm";
import { db, productDrafts, products } from "@workspace/db";

// requireAuth sets the caller; teamContext (mocked) switches the acting store
// the same way the real middleware does — `clerkUserId` becomes the store
// owner while `actorClerkId` stays the caller.
const auth = vi.hoisted(() => ({
  userId: "",
  storeOwner: "" as string,
  role: "manager" as "owner" | "manager" | "staff",
}));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: () => void) => {
    if (!auth.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
    req.clerkUserId = auth.userId;
    next();
  },
}));
vi.mock("../../middlewares/requireRole", () => ({
  teamContext: () => (req: any, _res: any, next: () => void) => {
    req.actorClerkId = auth.userId;
    if (auth.storeOwner) req.clerkUserId = auth.storeOwner;
    next();
  },
  requireRole: () => (_req: any, res: any, next: () => void) => {
    if (auth.role === "staff") { res.status(403).json({ error: "Forbidden" }); return; }
    next();
  },
}));

let server: Server;
let base = "";
const prefix = `pdraft-${crypto.randomBytes(6).toString("hex")}`;
const sellerA = `${prefix}-a`;
const sellerB = `${prefix}-b`;
const member = `${prefix}-member`;

async function call(path: string, method = "GET", body?: unknown) {
  const res = await fetch(`${base}/api/product-drafts${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json().catch(() => null)) as any };
}

const t = (ms: number) => new Date(Date.UTC(2026, 9, 1) + ms).toISOString();

beforeAll(async () => {
  const { default: router } = await import("../product-drafts");
  const app = express();
  app.use((req, _res, next) => { (req as any).log = { error: () => undefined, warn: () => undefined }; next(); });
  app.use(express.json({ limit: "5mb" }));
  app.use("/api/product-drafts", router);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(() => { auth.userId = ""; auth.storeOwner = ""; auth.role = "manager"; });

afterAll(async () => {
  await db.delete(productDrafts).where(inArray(productDrafts.ownerId, [sellerA, sellerB]));
  await new Promise<void>((resolve, reject) => { server.close((e) => (e ? reject(e) : resolve())); });
});

describe("product drafts sync API", () => {
  it("requires auth", async () => {
    expect((await call("")).status).toBe(401);
    expect((await call("/draft_x", "PUT", { updatedAt: t(0), data: {} })).status).toBe(401);
    expect((await call("/draft_x", "DELETE")).status).toBe(401);
  });

  it("upserts, lists and reads a draft", async () => {
    auth.userId = sellerA;
    let res = await call("/draft_one", "PUT", { updatedAt: t(1000), data: { name: "Hoodie", currentStep: 2 } });
    expect(res.status).toBe(200);
    expect(res.body.draft).toMatchObject({ clientDraftId: "draft_one", data: { name: "Hoodie" }, updatedAt: t(1000) });

    res = await call("/draft_one", "PUT", { updatedAt: t(2000), data: { name: "Hoodie v2" } });
    expect(res.status).toBe(200);
    expect(res.body.draft.data).toEqual({ name: "Hoodie v2" });

    res = await call("");
    expect(res.status).toBe(200);
    expect(res.body.drafts).toHaveLength(1);
    expect(res.body.drafts[0]).toMatchObject({ clientDraftId: "draft_one", updatedAt: t(2000) });

    res = await call("/draft_one");
    expect(res.body.draft.data).toEqual({ name: "Hoodie v2" });
    expect((await call("/draft_missing")).status).toBe(404);
  });

  it("rejects a stale write with 409 and returns the server copy", async () => {
    auth.userId = sellerA;
    await call("/draft_lww", "PUT", { updatedAt: t(5000), data: { name: "newer" } });
    const stale = await call("/draft_lww", "PUT", { updatedAt: t(4000), data: { name: "older" } });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe("DRAFT_STALE");
    expect(stale.body.draft).toMatchObject({ data: { name: "newer" }, updatedAt: t(5000) });
    // Same timestamp is an idempotent retry and is accepted.
    const retry = await call("/draft_lww", "PUT", { updatedAt: t(5000), data: { name: "newer" } });
    expect(retry.status).toBe(200);
    expect((await call("/draft_lww")).body.draft.data).toEqual({ name: "newer" });
  });

  it("isolates drafts between sellers", async () => {
    auth.userId = sellerA;
    await call("/draft_shared_id", "PUT", { updatedAt: t(1), data: { name: "A's" } });
    auth.userId = sellerB;
    // Same client id under another owner is a separate row, never a conflict.
    const put = await call("/draft_shared_id", "PUT", { updatedAt: t(0), data: { name: "B's" } });
    expect(put.status).toBe(200);
    const list = await call("");
    expect(list.body.drafts.map((d: any) => d.data.name)).toEqual(["B's"]);
    // B deleting the id leaves A's draft untouched.
    expect((await call("/draft_shared_id", "DELETE")).status).toBe(200);
    auth.userId = sellerA;
    expect((await call("/draft_shared_id")).body.draft.data).toEqual({ name: "A's" });
  });

  it("scopes to the store owner under team context and needs manager to write", async () => {
    auth.userId = member;
    auth.storeOwner = sellerB;
    await call("/draft_team", "PUT", { updatedAt: t(10), data: { name: "Team draft" } });
    auth.userId = sellerB;
    auth.storeOwner = "";
    expect((await call("/draft_team")).body.draft.data).toEqual({ name: "Team draft" });

    auth.userId = member;
    auth.storeOwner = sellerB;
    auth.role = "staff";
    expect((await call("/draft_team", "PUT", { updatedAt: t(20), data: {} })).status).toBe(403);
    expect((await call("/draft_team", "DELETE")).status).toBe(403);
    expect((await call("/draft_team")).status).toBe(200);
  });

  it("deletes idempotently", async () => {
    auth.userId = sellerA;
    await call("/draft_del", "PUT", { updatedAt: t(0), data: { name: "bye" } });
    expect((await call("/draft_del", "DELETE")).status).toBe(200);
    expect((await call("/draft_del")).status).toBe(404);
    expect((await call("/draft_del", "DELETE")).status).toBe(200);
  });

  it("validates the envelope, the id and the size", async () => {
    auth.userId = sellerA;
    expect((await call("/draft_v", "PUT", { data: {} })).status).toBe(400);
    expect((await call("/draft_v", "PUT", { updatedAt: "yesterday", data: {} })).status).toBe(400);
    expect((await call("/draft_v", "PUT", { updatedAt: t(0), data: [] })).status).toBe(400);
    expect((await call("/draft_v", "PUT", { updatedAt: t(0), data: {}, extra: 1 })).status).toBe(400);
    expect((await call("/bad%20id", "PUT", { updatedAt: t(0), data: {} })).status).toBe(400);
    const big = await call("/draft_big", "PUT", { updatedAt: t(0), data: { description: "x".repeat(300 * 1024) } });
    expect(big.status).toBe(413);
  });

  it("never creates rows in products", async () => {
    auth.userId = sellerA;
    await call("/draft_noprod", "PUT", { updatedAt: t(0), data: { name: "Not a product" } });
    const rows = await db.select({ id: products.id }).from(products).where(inArray(products.ownerId, [sellerA, sellerB]));
    expect(rows).toHaveLength(0);
  });
});
