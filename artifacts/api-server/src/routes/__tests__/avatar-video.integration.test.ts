/**
 * Avatar video (moving profile picture): <=10s duration validation, no trim
 * endpoint (a too-long clip is rejected outright), no 24h change limit
 * (unlike the profile cover video), and the media-serving route. ffmpeg/
 * ffprobe and object storage are injected fakes (CI has no ffmpeg); the
 * database is real.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { eq, inArray } from "drizzle-orm";
import { db, users } from "@workspace/db";
import { avatarVideoDurationError } from "../../lib/avatarVideo";

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: () => void) => {
    const viewer = req.header("x-test-user-id");
    if (!viewer) { res.status(401).json({ error: "Unauthorized" }); return; }
    req.clerkUserId = viewer;
    next();
  },
}));

const suffix = crypto.randomBytes(6).toString("hex");
const owner = `av-owner-${suffix}`;
const stranger = `av-stranger-${suffix}`;
const userIds = [owner, stranger];

/** A tiny buffer that passes the MP4 magic-byte check ("ftyp" at offset 4). */
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypisom"), Buffer.alloc(64)]);

let probeSeconds = 6;
const stored: string[] = [];
const deleted: string[] = [];
let server: Server;
let base = "";

function call(method: string, path: string, as?: string, body?: Buffer) {
  return fetch(`${base}${path}`, {
    method,
    headers: { ...(as ? { "x-test-user-id": as } : {}), ...(body ? { "content-type": "video/mp4" } : {}) },
    body,
  });
}

beforeAll(async () => {
  await db.insert(users).values([
    { clerkId: owner, email: `${owner}@test.local`, name: "Avatar Owner", displayName: "Avatar Owner", username: `avowner${suffix}`, role: "buyer", accountType: "buyer" },
    { clerkId: stranger, email: `${stranger}@test.local`, name: "Stranger", displayName: "Stranger", username: `avstr${suffix}`, role: "buyer", accountType: "buyer" },
  ]);

  const { createAvatarVideoRouter } = await import("../avatar-video");
  const router = createAvatarVideoRouter({
    processor: {
      probeDuration: async () => probeSeconds,
      render: async (_input, output, poster) => {
        await fs.writeFile(output, Buffer.from("rendered"));
        await fs.writeFile(poster, Buffer.from("poster"));
      },
    },
    storage: {
      createObjectEntityFromBuffer: async () => {
        const path = `/objects/uploads/avatar-${crypto.randomBytes(4).toString("hex")}`;
        stored.push(path);
        return path;
      },
      trySetObjectEntityAclPolicy: async () => undefined,
      deleteObjectEntity: async (path) => { deleted.push(path); },
    },
  });
  const app = express();
  app.use((req: any, _res, next) => {
    const viewer = req.header("x-test-user-id");
    if (viewer) req.clerkUserId = viewer;
    next();
  });
  app.use("/api/profile", router);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(users).where(inArray(users.clerkId, userIds));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => { probeSeconds = 6; });

describe("avatar video duration rule (pure)", () => {
  it("allows up to 10s (with a little tolerance) and rejects anything longer", () => {
    expect(avatarVideoDurationError(10)).toBeNull();
    expect(avatarVideoDurationError(10.2)).toBeNull();
    expect(avatarVideoDurationError(10.3)).toMatch(/at most 10 seconds/);
    expect(avatarVideoDurationError(0)).toMatch(/Could not read/);
  });
});

describe("POST /api/profile/avatar-video", () => {
  it("rejects a video longer than 10 seconds and leaves nothing set", async () => {
    probeSeconds = 15;
    const response = await call("POST", "/api/profile/avatar-video", owner, MP4);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "avatar_video_too_long" });
    const [row] = await db.select({ url: users.avatarVideoUrl }).from(users).where(eq(users.clerkId, owner));
    expect(row).toEqual({ url: null });
  });

  it("accepts a clip within the limit and returns video + poster URLs", async () => {
    probeSeconds = 8;
    const response = await call("POST", "/api/profile/avatar-video", owner, MP4);
    expect(response.status).toBe(201);
    const body = await response.json() as any;
    expect(body.avatarVideoUrl).toMatch(/\/api\/profile\/avatar-media\/uploads\/avatar-/);
    expect(body.avatarPosterUrl).toMatch(/\/api\/profile\/avatar-media\/uploads\/avatar-/);
    const [row] = await db.select({ url: users.avatarVideoUrl }).from(users).where(eq(users.clerkId, owner));
    expect(row.url).toBe(body.avatarVideoUrl);
  });

  it("replacing an avatar video cleans up the previous one's objects — no 24h limit, unlike the cover video", async () => {
    const first = await call("POST", "/api/profile/avatar-video", owner, MP4).then((r) => r.json() as Promise<any>);
    const second = await call("POST", "/api/profile/avatar-video", owner, MP4);
    expect(second.status).toBe(201); // would be 429 for the cover video within 24h — no such limit here
    expect(deleted).toEqual(expect.arrayContaining([
      first.avatarVideoUrl.replace(/^.*\/avatar-media\//, "/objects/"),
      first.avatarPosterUrl.replace(/^.*\/avatar-media\//, "/objects/"),
    ]));
  });

  it("requires auth and a real video body", async () => {
    expect((await call("POST", "/api/profile/avatar-video", undefined, MP4)).status).toBe(401);
    const notVideo = await fetch(`${base}/api/profile/avatar-video`, {
      method: "POST", headers: { "x-test-user-id": stranger, "content-type": "video/mp4" }, body: Buffer.from("not a video at all"),
    });
    expect(notVideo.status).toBe(400);
  });
});

describe("DELETE /api/profile/avatar-video", () => {
  it("clears the avatar video and cleans up its objects", async () => {
    const set = await call("POST", "/api/profile/avatar-video", stranger, MP4).then((r) => r.json() as Promise<any>);
    const removed = await call("DELETE", "/api/profile/avatar-video", stranger);
    expect(removed.status).toBe(200);
    expect(await removed.json()).toEqual({ avatarVideoUrl: null, avatarPosterUrl: null });
    expect(deleted).toEqual(expect.arrayContaining([
      set.avatarVideoUrl.replace(/^.*\/avatar-media\//, "/objects/"),
      set.avatarPosterUrl.replace(/^.*\/avatar-media\//, "/objects/"),
    ]));
  });
});

describe("GET /api/profile/avatar-media/*path", () => {
  it("404s for a path that doesn't belong to any account's avatar video/poster", async () => {
    const response = await fetch(`${base}/api/profile/avatar-media/uploads/does-not-exist`);
    expect(response.status).toBe(404);
  });
});
