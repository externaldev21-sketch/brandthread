/**
 * POST carousels end to end (storage and ffmpeg are faked):
 *  - chunked/resumable video upload (init → chunks → status → complete)
 *  - compose-carousel (photos + videos, 14 max, look adjustments validated)
 *  - creating POSTs as a buyer/seller (profile surface, 14-slide cap, buyers never Threads)
 *  - a profile POST never enters the Threads feed; friends-only visibility for buyer POSTs
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { Readable } from "node:stream";
import { db, follows, posts, users } from "@workspace/db";
import { eq, inArray, or } from "drizzle-orm";

const suffix = crypto.randomBytes(6).toString("hex");
const seller = `car-seller-${suffix}`;
const buyer = `car-buyer-${suffix}`;
const friend = `car-friend-${suffix}`;
const stranger = `car-stranger-${suffix}`;
const postIds: string[] = [];
const auth = vi.hoisted(() => ({ clerkUserId: "" }));
const store = vi.hoisted(() => ({
  n: 0,
  objects: new Map<string, { bytes: Buffer; contentType: string; owner: string; visibility: string }>(),
}));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: unknown, next: () => void) => { req.clerkUserId = auth.clerkUserId; next(); },
}));

vi.mock("../../lib/objectStorage", () => ({
  ObjectStorageService: class {
    async createObjectEntityFromBuffer(bytes: Buffer, contentType: string, path?: string) {
      const p = path ?? `/objects/uploads/t-${++store.n}`;
      store.objects.set(p, { bytes, contentType, owner: "", visibility: "private" });
      return p;
    }
    async trySetObjectEntityAclPolicy(path: string, policy: { owner: string; visibility: string }) {
      const o = store.objects.get(path); if (!o) throw new Error("not found");
      Object.assign(o, policy); return path;
    }
    async getObjectEntityFile(path: string) {
      const o = store.objects.get(path); if (!o) throw new Error("not found");
      return {
        getMetadata: async () => [{ size: String(o.bytes.length), contentType: o.contentType }],
        download: async (opts?: { destination?: string; start?: number; end?: number }) => {
          if (opts?.destination) await (await import("node:fs/promises")).writeFile(opts.destination, o.bytes);
          if (opts?.end !== undefined) return [o.bytes.subarray(opts.start ?? 0, opts.end + 1)];
          return [o.bytes];
        },
        createReadStream: ({ start = 0, end = o.bytes.length - 1 } = {}) => Readable.from(o.bytes.subarray(start, end + 1)),
        __path: path,
      };
    }
    async listObjectEntities(prefix: string) {
      return [...store.objects.entries()].filter(([p]) => p.startsWith(prefix)).map(([objectPath, o]) => ({ objectPath, size: o.bytes.length }));
    }
    async combineObjectEntities(parts: string[], dest: string, contentType: string) {
      store.objects.set(dest, { bytes: Buffer.concat(parts.map((p) => store.objects.get(p)!.bytes)), contentType, owner: "", visibility: "private" });
    }
    async canAccessObjectEntity({ userId, objectFile, requestedPermission }: any) {
      const o = store.objects.get(objectFile.__path); if (!o) return false;
      return (o.visibility === "public" && requestedPermission === "read") || o.owner === userId;
    }
    async deleteObjectEntity(path: string) { store.objects.delete(path); }
    async getObjectEntityDownloadURL(path: string) { return `https://signed.test/${encodeURIComponent(path)}`; }
  },
}));

vi.mock("node:child_process", async () => {
  const fs = await import("node:fs");
  return {
    execFile: (command: string, args: string[], _o: unknown, cb: (e: Error | null, r: { stdout: string; stderr: string }) => void) => {
      if (command === "ffprobe") { cb(null, { stdout: "4\n", stderr: "" }); return; }
      fs.writeFileSync(args[args.length - 1], Buffer.from("generated-media"));
      cb(null, { stdout: "", stderr: "" });
    },
  };
});

let server: Server;
let base = "";
async function call(path: string, init: RequestInit = {}) {
  const res = await fetch(`${base}${path}`, { ...init, headers: { "Content-Type": "application/json", ...(init.headers ?? {}) } });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}
const as = (id: string) => { auth.clerkUserId = id; };
const mp4 = (extra = 0) => Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypisom"), Buffer.alloc(12 + extra, 1)]);
function seedMedia(owner: string, label: string, kind: "photo" | "video") {
  const path = `/objects/uploads/${label}.${kind === "photo" ? "jpg" : "mp4"}`;
  const thumb = `/objects/uploads/${label}-thumb.jpg`;
  store.objects.set(path, { bytes: kind === "photo" ? Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(label)]) : Buffer.from(label), contentType: kind === "photo" ? "image/jpeg" : "video/mp4", owner, visibility: "private" });
  store.objects.set(thumb, { bytes: Buffer.from(`${label}t`), contentType: "image/jpeg", owner, visibility: "private" });
  return { kind, path, thumbnailPath: thumb, duration: kind === "video" ? 4 : undefined };
}

beforeAll(async () => {
  await db.insert(users).values([seller, buyer, friend, stranger].map((id, i) => ({
    clerkId: id, email: `${id}@test.local`, name: id, displayName: id,
    role: i === 0 ? "seller" : "buyer", accountType: i === 0 ? "seller" : "buyer",
  })) as any);
  // buyer <-> friend are mutual followers
  await db.insert(follows).values([
    { followerId: buyer, followingId: friend }, { followerId: friend, followingId: buyer },
    { followerId: friend, followingId: seller },
  ]);
  const [{ default: postsRouter }] = await Promise.all([import("../posts")]);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as any).clerkUserId = auth.clerkUserId; next(); });
  app.use("/api/posts", postsRouter);
  await new Promise<void>((r) => { server = app.listen(0, "127.0.0.1", () => r()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  if (postIds.length) await db.delete(posts).where(inArray(posts.id, postIds));
  await db.delete(follows).where(or(inArray(follows.followerId, [seller, buyer, friend, stranger]), inArray(follows.followingId, [seller, buyer, friend, stranger])));
  await db.delete(users).where(inArray(users.clerkId, [seller, buyer, friend, stranger]));
  await new Promise<void>((r) => server.close(() => r()));
});

describe("chunked video upload", () => {
  it("starts, accepts chunks idempotently, reports progress for resume, and completes", async () => {
    as(buyer);
    const bytes = mp4(9 * 1024 * 1024); // 2 chunks
    const init = await call("/api/posts/uploads", { method: "POST", body: JSON.stringify({ contentType: "video/mp4", size: bytes.length }) });
    expect(init.status).toBe(201);
    expect(init.body.totalChunks).toBe(2);
    const { uploadId, chunkSize } = init.body;
    const put = (i: number, body: Buffer) => fetch(`${base}/api/posts/uploads/${uploadId}/chunks/${i}`, { method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body });

    expect((await put(0, bytes.subarray(0, chunkSize))).status).toBe(200);
    expect((await put(0, bytes.subarray(0, chunkSize))).status).toBe(200); // retry is safe
    const status = await call(`/api/posts/uploads/${uploadId}`);
    expect(status.body.received).toEqual([0]);

    const early = await call(`/api/posts/uploads/${uploadId}/complete`, { method: "POST", body: "{}" });
    expect(early.status).toBe(409);
    expect(early.body.missing).toEqual([1]);

    expect((await put(1, bytes.subarray(0, 10))).status).toBe(400); // wrong size
    expect((await put(1, bytes.subarray(chunkSize))).status).toBe(200);
    const done = await call(`/api/posts/uploads/${uploadId}/complete`, { method: "POST", body: "{}" });
    expect(done.status).toBe(201);
    expect(done.body.size).toBe(bytes.length);
    expect(store.objects.get(done.body.objectPath)!.owner).toBe(buyer);
    expect(store.objects.get(done.body.objectPath)!.bytes.equals(bytes)).toBe(true);
  });

  it("rejects non-video types and other accounts", async () => {
    as(buyer);
    expect((await call("/api/posts/uploads", { method: "POST", body: JSON.stringify({ contentType: "image/png", size: 10 }) })).status).toBe(415);
    const init = await call("/api/posts/uploads", { method: "POST", body: JSON.stringify({ contentType: "video/mp4", size: 100 }) });
    as(stranger);
    expect((await call(`/api/posts/uploads/${init.body.uploadId}`)).status).toBe(404);
  });
});

describe("compose-carousel", () => {
  it("composes a mixed photo + video carousel for a buyer", async () => {
    as(buyer);
    const p = seedMedia(buyer, "src-p", "photo");
    const v = seedMedia(buyer, "src-v", "video");
    store.objects.set(v.path, { bytes: mp4(), contentType: "video/mp4", owner: buyer, visibility: "private" });
    const res = await call("/api/posts/compose-carousel", {
      method: "POST",
      body: JSON.stringify({ items: [
        { kind: "photo", objectPath: p.path, adjust: { brightness: 20, warmth: -30 } },
        { kind: "video", objectPath: v.path, crop: { x: 0.1, y: 0, width: 0.75, height: 1 }, trimStart: 0, trimEnd: 3, adjust: { contrast: 10 } },
      ] }),
    });
    expect(res.status).toBe(200);
    expect(res.body.items.map((i: any) => i.kind)).toEqual(["photo", "video"]);
    expect(res.body.items[1].duration).toBe(3);
    expect(res.body.items.every((i: any) => i.thumbnailPath && i.mediaPath)).toBe(true);
  });

  it("enforces 14 slides, valid adjustments and valid crops", async () => {
    as(buyer);
    const item = { kind: "photo", objectPath: "/objects/uploads/x.jpg" };
    expect((await call("/api/posts/compose-carousel", { method: "POST", body: JSON.stringify({ items: Array.from({ length: 15 }, () => item) }) })).status).toBe(400);
    expect((await call("/api/posts/compose-carousel", { method: "POST", body: JSON.stringify({ items: [{ ...item, adjust: { brightness: 500 } }] }) })).status).toBe(400);
    expect((await call("/api/posts/compose-carousel", { method: "POST", body: JSON.stringify({ items: [{ ...item, crop: { x: 0.9, y: 0, width: 0.5, height: 1 } }] }) })).status).toBe(400);
  });
});

describe("creating POSTs", () => {
  it("a buyer's carousel lands on the profile surface at 3:4 with stable slide URLs", async () => {
    as(buyer);
    const slides = [seedMedia(buyer, "c1", "photo"), seedMedia(buyer, "c2", "video")];
    const res = await call("/api/posts", { method: "POST", body: JSON.stringify({ surface: "profile", caption: "trip", slides }) });
    expect(res.status).toBe(201);
    postIds.push(res.body.id);
    expect(res.body.surface).toBe("profile");
    expect(res.body.aspectRatio).toBe("3:4");
    expect(res.body.mediaType).toBe("slideshow");
    expect(res.body.slides.map((s: any) => s.kind)).toEqual(["photo", "video"]);
    expect(res.body.slides[0].url).toContain("/api/posts/media/uploads/c1.jpg");
  });

  it("a single video POST is a video post; 15 slides is refused with a clear cap", async () => {
    as(buyer);
    const one = await call("/api/posts", { method: "POST", body: JSON.stringify({ slides: [seedMedia(buyer, "sv", "video")] }) });
    expect(one.status).toBe(201); postIds.push(one.body.id);
    expect(one.body.mediaType).toBe("video");
    const many = Array.from({ length: 15 }, (_, i) => seedMedia(buyer, `m${i}`, "photo"));
    const res = await call("/api/posts", { method: "POST", body: JSON.stringify({ slides: many }) });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/14/);
  });

  it("buyers can never create a Thread, a seller can do both, and THREAD allows 30 slides", async () => {
    as(buyer);
    const t = await call("/api/posts", { method: "POST", body: JSON.stringify({ surface: "thread", slides: [seedMedia(buyer, "bt", "photo")] }) });
    expect(t.status).toBe(403);
    expect(t.body.code).toBe("BUYER_NO_THREADS");
    as(seller);
    const thread = await call("/api/posts", { method: "POST", body: JSON.stringify({ surface: "thread", slides: Array.from({ length: 30 }, (_, i) => seedMedia(seller, `t${i}`, "photo")) }) });
    expect(thread.status).toBe(201); postIds.push(thread.body.id);
    expect(thread.body.surface).toBe("thread");
    const profile = await call("/api/posts", { method: "POST", body: JSON.stringify({ surface: "profile", slides: [seedMedia(seller, "sp", "photo")] }) });
    expect(profile.status).toBe(201); postIds.push(profile.body.id);
    const tooMany = await call("/api/posts", { method: "POST", body: JSON.stringify({ surface: "profile", slides: Array.from({ length: 15 }, (_, i) => seedMedia(seller, `x${i}`, "photo")) }) });
    expect(tooMany.status).toBe(400);
  });
});

describe("where POSTs show", () => {
  it("a seller's profile POST never enters the Threads feed; a Thread does", async () => {
    as(friend);
    const feed = await call("/api/posts/feed");
    expect(feed.status).toBe(200);
    const ids = feed.body.map((p: any) => p.id);
    const mine = await db.select({ id: posts.id, surface: posts.surface }).from(posts).where(eq(posts.userId, seller));
    for (const row of mine) expect(ids.includes(row.id)).toBe(row.surface === "thread");
    expect(mine.some((r) => r.surface === "profile")).toBe(true);
  });

  it("a buyer's POST is readable by the buyer and mutual friends only", async () => {
    const [row] = await db.select({ id: posts.id }).from(posts).where(eq(posts.userId, buyer)).limit(1);
    as(buyer); expect((await call(`/api/posts/${row.id}`)).status).toBe(200);
    as(friend); expect((await call(`/api/posts/${row.id}`)).status).toBe(200);
    as(stranger); expect((await call(`/api/posts/${row.id}`)).status).toBe(404);
  });
});
