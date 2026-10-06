import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const state = vi.hoisted(() => ({
  userId: "viewer" as string | null,
  accountType: "seller",
  check: { allowed: true } as Record<string, unknown>,
  created: [] as string[],
  acl: [] as Array<{ path: string; owner: string; visibility: string }>,
}));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: () => void) => {
    if (!state.userId) return res.status(401).json({ error: "Unauthorized" });
    req.clerkUserId = state.userId;
    next();
  },
}));
vi.mock("drizzle-orm", () => ({ eq: (...v: unknown[]) => v }));
vi.mock("@workspace/db", () => ({
  db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ accountType: state.accountType }] }) }) }) },
  users: {},
}));
vi.mock("node:child_process", () => ({
  execFile: (_cmd: string, _args: string[], _opts: unknown, cb: (e: unknown, out: { stdout: string }) => void) => cb(null, { stdout: "12.5\n" }),
}));
vi.mock("../../lib/objectStorage", () => ({
  ObjectStorageService: class {
    async getObjectEntityFile() {
      return {
        getMetadata: async () => [{ contentType: "video/mp4", size: 1024 }],
        download: async () => [Buffer.from("video-bytes")],
      };
    }
    async createObjectEntityFromBuffer() { state.created.push("x"); return "/objects/uploads/copy-1"; }
    async trySetObjectEntityAclPolicy(path: string, policy: { owner: string; visibility: string }) { state.acl.push({ path, ...policy }); }
    async deleteObjectEntity() {}
  },
}));
vi.mock("../../lib/remix", () => ({
  checkRemix: async () => state.check,
}));

import remixRouter from "../remix";

let server: Server;
let base = "";
const POST_ID = "11111111-1111-4111-8111-111111111111";
const SOURCE = {
  id: POST_ID, authorId: "author", authorUsername: "maison",
  mediaUrl: "https://api/api/posts/media/uploads/src.mp4", thumbnailUrl: null, objectPath: "/objects/uploads/src.mp4",
};

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/remix", remixRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/remix`;
});
afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });
beforeEach(() => {
  state.userId = "viewer";
  state.accountType = "seller";
  state.check = { allowed: true, source: SOURCE };
  state.created = [];
  state.acl = [];
});

describe("GET /api/remix/posts/:postId", () => {
  it("requires sign-in", async () => {
    state.userId = null;
    expect((await fetch(`${base}/posts/${POST_ID}`)).status).toBe(401);
  });

  it("reports an allowed remix and whether the viewer can publish video", async () => {
    expect(await (await fetch(`${base}/posts/${POST_ID}`)).json()).toEqual({
      allowed: true, canPostVideo: true, source: { postId: POST_ID, authorId: "author", authorUsername: "maison" },
    });
    state.accountType = "buyer";
    expect(((await (await fetch(`${base}/posts/${POST_ID}`)).json()) as { canPostVideo: boolean }).canPostVideo).toBe(false);
  });

  it("reports the author's refusal", async () => {
    state.check = { allowed: false, code: "REMIX_NOT_ALLOWED", status: 403, message: "No remixes." };
    expect(await (await fetch(`${base}/posts/${POST_ID}`)).json()).toEqual({
      allowed: false, code: "REMIX_NOT_ALLOWED", message: "No remixes.", canPostVideo: true,
    });
  });
});

describe("POST /api/remix/posts/:postId/clip", () => {
  it("copies the source into a private clip owned by the remixer", async () => {
    const res = await fetch(`${base}/posts/${POST_ID}/clip`, { method: "POST" });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      objectPath: "/objects/uploads/copy-1",
      duration: 12.5,
      previewUrl: SOURCE.mediaUrl,
      source: { postId: POST_ID, authorId: "author", authorUsername: "maison" },
    });
    expect(state.acl).toEqual([{ path: "/objects/uploads/copy-1", owner: "viewer", visibility: "private" }]);
  });

  it("answers 403 REMIX_NOT_ALLOWED when the author doesn't allow it, without copying", async () => {
    state.check = { allowed: false, code: "REMIX_NOT_ALLOWED", status: 403, message: "No remixes." };
    const res = await fetch(`${base}/posts/${POST_ID}/clip`, { method: "POST" });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe("REMIX_NOT_ALLOWED");
    expect(state.created).toEqual([]);
  });

  it("is seller-only (video posting)", async () => {
    state.accountType = "buyer";
    const res = await fetch(`${base}/posts/${POST_ID}/clip`, { method: "POST" });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe("SELLER_REQUIRED");
  });
});
