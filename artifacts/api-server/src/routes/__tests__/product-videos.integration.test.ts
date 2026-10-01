import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db, products, productVideos } from "@workspace/db";
import { PRODUCT_VIDEO_MAX_UPLOAD_BYTES } from "../../lib/productVideo";

const auth = vi.hoisted(() => ({ userId: "", role: "manager" as "manager" | "staff" }));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: () => void) => {
    if (!auth.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
    req.clerkUserId = auth.userId;
    next();
  },
}));
vi.mock("../../middlewares/requireRole", () => ({
  teamContext: () => (_req: any, _res: any, next: () => void) => next(),
  requireRole: () => (_req: any, res: any, next: () => void) => {
    if (auth.role === "staff") { res.status(403).json({ error: "Forbidden" }); return; }
    next();
  },
}));

const fake = vi.hoisted(() => ({
  duration: 12,
  deleted: [] as string[],
}));

let server: Server;
let base = "";
const prefix = `pvid-${crypto.randomBytes(6).toString("hex")}`;
const seller = `${prefix}-seller`;
const other = `${prefix}-other`;
const created: string[] = [];

const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypmp42"), Buffer.alloc(32)]);

async function makeProduct(ownerId: string, deleted = false) {
  const [p] = await db.insert(products).values({
    ownerId, name: "V", status: "active", deletedAt: deleted ? new Date() : null,
  }).returning();
  created.push(p.id);
  return p.id;
}

function upload(productId: string, body: Buffer, type = "video/mp4") {
  return fetch(`${base}/api/product-videos/${productId}`, { method: "POST", headers: { "content-type": type }, body });
}

beforeAll(async () => {
  const { createProductVideosRouter } = await import("../product-videos");
  const router = createProductVideosRouter({
    processor: {
      probeDuration: async () => fake.duration,
      render: async (_in, out, poster) => {
        const fs = await import("node:fs/promises");
        await fs.writeFile(out, Buffer.from("rendered"));
        await fs.writeFile(poster, Buffer.from("poster"));
      },
    },
    storage: {
      createObjectEntityFromBuffer: async () => `/objects/uploads/${crypto.randomUUID()}`,
      trySetObjectEntityAclPolicy: async () => undefined,
      deleteObjectEntity: async (path) => { fake.deleted.push(path); },
    },
  });
  const app = express();
  app.use((req, _res, next) => { (req as any).log = { error: () => undefined, warn: () => undefined }; next(); });
  app.use(express.json());
  app.use("/api/product-videos", router);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(() => { auth.userId = ""; auth.role = "manager"; fake.duration = 12; fake.deleted.length = 0; });

afterAll(async () => {
  if (created.length) await db.delete(products).where(inArray(products.id, created));
  await new Promise<void>((resolve, reject) => { server.close((e) => e ? reject(e) : resolve()); });
});

describe("product video upload", () => {
  it("stores video + poster, serves them publicly, and replacing cleans up old objects", async () => {
    auth.userId = seller;
    const id = await makeProduct(seller);
    const first = await upload(id, MP4);
    expect(first.status).toBe(201);
    const v1 = ((await first.json()) as any).video;
    expect(v1.videoUrl).toMatch(/\/api\/product-videos\/media\/uploads\//);
    expect(v1.posterUrl).toMatch(/\/api\/product-videos\/media\/uploads\//);
    expect(v1.durationMs).toBe(12000);

    const second = await upload(id, MP4);
    expect(second.status).toBe(201);
    expect(fake.deleted).toHaveLength(2);
    const rows = await db.select().from(productVideos).where(eq(productVideos.productId, id));
    expect(rows).toHaveLength(1);

    auth.userId = "";
    const pub = (await (await fetch(`${base}/api/product-videos/public/${id}`)).json()) as any;
    expect(pub.video.videoUrl).toBe(rows[0].videoUrl);
    expect(Object.keys(pub.video).sort()).toEqual(["durationMs", "posterUrl", "videoUrl"]);
  });

  it("rejects bad mime, bad signature, empty body and overlong video", async () => {
    auth.userId = seller;
    const id = await makeProduct(seller);
    expect((await upload(id, MP4, "image/png")).status).toBe(415);
    expect((await upload(id, Buffer.from("this is not a video at all, sorry"), "video/mp4")).status).toBe(400);
    expect((await upload(id, Buffer.alloc(0))).status).toBe(400);
    expect((await upload(id, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0, 0]), "video/webm")).status).toBe(400);
    fake.duration = 61;
    const long = await upload(id, MP4);
    expect(long.status).toBe(400);
    expect(((await long.json()) as any).code).toBe("video_too_long");
    expect(await db.select().from(productVideos).where(eq(productVideos.productId, id))).toHaveLength(0);
  });

  it("enforces the size limit", async () => {
    auth.userId = seller;
    const id = await makeProduct(seller);
    const big = Buffer.alloc(PRODUCT_VIDEO_MAX_UPLOAD_BYTES + 1024);
    MP4.copy(big);
    const res = await upload(id, big);
    expect(res.status).toBe(413);
  });

  it("enforces auth, role and ownership", async () => {
    const id = await makeProduct(seller);
    expect((await upload(id, MP4)).status).toBe(401);
    auth.userId = other;
    expect((await upload(id, MP4)).status).toBe(404);
    expect((await fetch(`${base}/api/product-videos/${id}`)).status).toBe(404);
    expect((await fetch(`${base}/api/product-videos/${id}`, { method: "DELETE" })).status).toBe(404);
    auth.userId = seller;
    auth.role = "staff";
    expect((await upload(id, MP4)).status).toBe(403);
    expect((await fetch(`${base}/api/product-videos/${id}`, { method: "DELETE" })).status).toBe(403);
    auth.role = "manager";
    expect((await upload("nope", MP4)).status).toBe(404);
    const deleted = await makeProduct(seller, true);
    expect((await upload(deleted, MP4)).status).toBe(404);
  });

  it("delete removes the row and objects", async () => {
    auth.userId = seller;
    const id = await makeProduct(seller);
    await upload(id, MP4);
    const res = await fetch(`${base}/api/product-videos/${id}`, { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(fake.deleted).toHaveLength(2);
    expect(((await (await fetch(`${base}/api/product-videos/${id}`)).json()) as any).video).toBeNull();
  });

  it("public read never leaks archived or deleted products' videos and works signed out", async () => {
    auth.userId = seller;
    const archived = await makeProduct(seller);
    await upload(archived, MP4);
    await db.update(products).set({ status: "archived" }).where(eq(products.id, archived));
    const deleted = await makeProduct(seller);
    await upload(deleted, MP4);
    await db.update(products).set({ deletedAt: new Date() }).where(eq(products.id, deleted));
    auth.userId = "";
    for (const id of [archived, deleted, crypto.randomUUID(), "not-a-uuid"]) {
      const res = await fetch(`${base}/api/product-videos/public/${id}`);
      expect(res.status).toBe(200);
      expect(((await res.json()) as any).video).toBeNull();
    }
    expect((await fetch(`${base}/api/product-videos/media/uploads/unknown`)).status).toBe(404);
  });
});
