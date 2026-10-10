/**
 * GET /api/public/products/:id — "Preview as buyer" for the seller's own
 * draft / archived product: served to its owner only, flagged previewOnly,
 * never publicly cacheable; everyone else still gets 404.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { db, products, productVariants, users } from "@workspace/db";
import { inArray } from "drizzle-orm";

const suffix = crypto.randomBytes(6).toString("hex");
const owner = `preview-owner-${suffix}`;
const other = `preview-other-${suffix}`;
const ids: Record<"active" | "draft" | "archived" | "deleted", string> = { active: "", draft: "", archived: "", deleted: "" };
let server: Server;
let base = "";

async function addProduct(status: string, deleted = false) {
  const [row] = await db.insert(products).values({
    ownerId: owner,
    name: `Preview ${status}${deleted ? " deleted" : ""} ${suffix}`,
    category: "apparel",
    status,
    tags: [],
    styleTags: [],
    ...(deleted ? { deletedAt: new Date() } : {}),
  }).returning();
  await db.insert(productVariants).values({ productId: row.id, sku: `${suffix}-${status}-${deleted}`, priceCents: 4_000, stock: 3 });
  return row.id;
}

beforeAll(async () => {
  await db.insert(users).values([
    { clerkId: owner, email: `${owner}@test.local`, name: "Preview Owner", displayName: "Preview Owner", role: "seller", accountType: "seller" },
    { clerkId: other, email: `${other}@test.local`, name: "Preview Other", displayName: "Preview Other", role: "buyer", accountType: "buyer" },
  ]);
  ids.active = await addProduct("active");
  ids.draft = await addProduct("draft");
  ids.archived = await addProduct("archived");
  ids.deleted = await addProduct("draft", true);

  const { default: publicRouter } = await import("../public");
  const app = express();
  // Stand-in for Clerk: the signed-in viewer, as requireAuth/clerkMiddleware would set it.
  app.use((req, _res, next) => {
    const viewer = req.header("x-test-viewer");
    if (viewer) (req as any).clerkUserId = viewer;
    next();
  });
  app.use("/api/public", publicRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  const all = Object.values(ids).filter(Boolean);
  if (all.length) {
    await db.delete(productVariants).where(inArray(productVariants.productId, all));
    await db.delete(products).where(inArray(products.id, all));
  }
  await db.delete(users).where(inArray(users.clerkId, [owner, other]));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function get(id: string, viewer?: string) {
  return fetch(`${base}/api/public/products/${id}`, { headers: viewer ? { "x-test-viewer": viewer } : {} });
}

describe("GET /api/public/products/:id owner preview", () => {
  it("serves an active product to everyone without previewOnly (public cache only when signed out)", async () => {
    for (const viewer of [undefined, other, owner]) {
      const res = await get(ids.active, viewer);
      expect(res.status).toBe(200);
      // Signed-in responses are viewer-scoped (block filtering), never shared-cached.
      if (viewer) expect(res.headers.get("cache-control")).toBe("private, no-store");
      else expect(res.headers.get("cache-control")).toMatch(/^public/);
      const body = await res.json() as any;
      expect(body.previewOnly).toBeUndefined();
      expect(body.variants).toHaveLength(1);
    }
  });

  it("serves the owner their own draft and archived products flagged previewOnly, never cached", async () => {
    for (const id of [ids.draft, ids.archived]) {
      const res = await get(id, owner);
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("private, no-store");
      const body = await res.json() as any;
      expect(body.previewOnly).toBe(true);
      expect(body.id).toBe(id);
      expect(body.variants[0].priceCents).toBe(4_000);
    }
  });

  it("hides drafts from signed-out viewers and other accounts", async () => {
    for (const viewer of [undefined, other]) {
      const res = await get(ids.draft, viewer);
      expect(res.status).toBe(404);
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
  });

  it("never serves a deleted product, even to its owner", async () => {
    expect((await get(ids.deleted, owner)).status).toBe(404);
  });
});
