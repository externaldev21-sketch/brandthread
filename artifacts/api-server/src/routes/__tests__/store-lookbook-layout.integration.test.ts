import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import crypto from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { eq, inArray, sql } from "drizzle-orm";
import { db, users } from "@workspace/db";
import { parseStoreLayout } from "../seller-profile";

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: () => void) => {
    const id = req.header("x-test-user-id");
    if (!id) { res.status(401).json({ error: "Unauthorized" }); return; }
    req.clerkUserId = id;
    req.log = { error: () => {}, warn: () => {}, info: () => {} };
    next();
  },
}));

const sfx = crypto.randomBytes(5).toString("hex");
const SELLER = `lb-${sfx}-seller`;
const OTHER = `lb-${sfx}-other`;

let server: Server;
let base = "";

beforeAll(async () => {
  await db.insert(users).values([SELLER, OTHER].map((clerkId) => ({
    clerkId, email: `${clerkId}@test.local`, name: clerkId, brandName: clerkId,
    username: clerkId.replace(/[^a-z0-9]/gi, "").slice(0, 28), role: "seller", accountType: "seller",
  })));
  const { default: publicRouter } = await import("../public");
  const { default: sellerProfileRouter } = await import("../seller-profile");
  const app = express();
  app.use(express.json());
  app.use("/api/public", publicRouter);
  app.use("/api/seller", sellerProfileRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await db.delete(users).where(inArray(users.clerkId, [SELLER, OTHER]));
});

const put = (layout: unknown, as: string | null = SELLER) => fetch(`${base}/api/seller/profile/store-layout`, {
  method: "PUT",
  headers: { "content-type": "application/json", ...(as ? { "x-test-user-id": as } : {}) },
  body: JSON.stringify({ layout }),
});
const publicLayout = async (id: string) => {
  const r = await fetch(`${base}/api/public/sellers/${id}`);
  return ((await r.json()) as any).profile?.storeLayout;
};

describe("parseStoreLayout", () => {
  it("accepts only grid and lookbook", () => {
    expect(parseStoreLayout("grid")).toBe("grid");
    expect(parseStoreLayout("lookbook")).toBe("lookbook");
    for (const bad of ["Lookbook", "carousel", "", null, undefined, 1, true]) expect(parseStoreLayout(bad)).toBeNull();
  });
});

describe("store layout setting", () => {
  it("defaults to grid, and the public profile endpoint returns it (no auth)", async () => {
    const [row] = await db.select({ v: users.storeLayout }).from(users).where(eq(users.clerkId, SELLER));
    expect(row?.v).toBe("grid");
    expect(await publicLayout(SELLER)).toBe("grid");
  });

  it("validates and requires auth", async () => {
    expect((await put("carousel")).status).toBe(400);
    expect((await put(undefined)).status).toBe(400);
    expect((await put("lookbook", null)).status).toBe(401);
    expect(await publicLayout(SELLER)).toBe("grid");
  });

  it("persists lookbook for this seller only and shows it publicly", async () => {
    const r = await put("lookbook");
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ storeLayout: "lookbook" });
    expect(await publicLayout(SELLER)).toBe("lookbook");
    expect(await publicLayout(OTHER)).toBe("grid");
    const own = await fetch(`${base}/api/seller/profile`, { headers: { "x-test-user-id": SELLER } });
    expect(((await own.json()) as any).storeLayout).toBe("lookbook");
    expect((await (await put("grid")).json())).toEqual({ storeLayout: "grid" });
    expect(await publicLayout(SELLER)).toBe("grid");
  });

  it("the database refuses any other value (CHECK constraint)", async () => {
    await expect(db.execute(sql`UPDATE users SET store_layout = 'carousel' WHERE clerk_id = ${SELLER}`)).rejects.toThrow();
  });
});
