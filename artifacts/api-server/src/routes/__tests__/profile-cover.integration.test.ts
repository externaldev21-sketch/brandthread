/**
 * Profile cover video: server-enforced 24h change limit (set AND remove),
 * ≤30s duration validation, the once-only first-visit coach mark, and the
 * cover URLs on public profile responses. ffmpeg/ffprobe and object storage
 * are injected fakes (CI has no ffmpeg); the database is real.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { eq, inArray } from "drizzle-orm";
import { db, users } from "@workspace/db";
import { checkCoverChangeAllowed, coverChangeMessage, parseTrim } from "../../lib/profileCover";

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: () => void) => {
    const viewer = req.header("x-test-user-id");
    if (!viewer) { res.status(401).json({ error: "Unauthorized" }); return; }
    req.clerkUserId = viewer;
    next();
  },
}));

vi.mock("../notifications-feed", () => ({
  publishNotification: async () => undefined,
}));

const suffix = crypto.randomBytes(6).toString("hex");
const owner = `pc-owner-${suffix}`;
const seller = `pc-seller-${suffix}`;
const stranger = `pc-stranger-${suffix}`;
const userIds = [owner, seller, stranger];

/** A tiny buffer that passes the MP4 magic-byte check ("ftyp" at offset 4). */
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypisom"), Buffer.alloc(64)]);

let clock = new Date("2026-09-20T12:00:00Z");
const probe = { source: 12, rendered: 12 };
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
    { clerkId: owner, email: `${owner}@test.local`, name: "Cover Buyer", displayName: "Cover Buyer", username: `pcbuyer${suffix}`, role: "buyer", accountType: "buyer" },
    { clerkId: seller, email: `${seller}@test.local`, name: "Cover Seller", displayName: "Cover Seller", brandName: "Cover Co", username: `pcseller${suffix}`, role: "seller", accountType: "seller" },
    { clerkId: stranger, email: `${stranger}@test.local`, name: "Stranger", displayName: "Stranger", username: `pcstr${suffix}`, role: "buyer", accountType: "buyer" },
  ]);

  const { createProfileCoverRouter } = await import("../profile-cover");
  const { default: publicRouter } = await import("../public");
  const { default: socialRouter } = await import("../social");
  const router = createProfileCoverRouter({
    now: () => clock,
    processor: {
      // First probe is the source (skipped when a trim is requested), the
      // next one is the rendered output.
      probeDuration: async (path) => (path.endsWith("cover.mp4") ? probe.rendered : probe.source),
      render: async (_input, output, poster) => {
        await fs.writeFile(output, Buffer.from("rendered"));
        await fs.writeFile(poster, Buffer.from("poster"));
      },
    },
    storage: {
      createObjectEntityFromBuffer: async () => {
        const path = `/objects/uploads/cover-${crypto.randomBytes(4).toString("hex")}`;
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
  app.use("/api/public", publicRouter);
  app.use("/api/social", socialRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(users).where(inArray(users.clerkId, userIds));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  probe.source = 12;
  probe.rendered = 12;
});

describe("cover change rules (pure)", () => {
  it("allows a first change, then blocks for 24h with an hours countdown", () => {
    const t0 = new Date("2026-09-20T00:00:00Z");
    expect(checkCoverChangeAllowed(null, t0)).toEqual({ allowed: true });
    const blocked = checkCoverChangeAllowed(t0, new Date("2026-09-20T19:10:00Z"));
    expect(blocked).toMatchObject({ allowed: false, retryAfterHours: 5, message: "You can change your cover again in 5 hours" });
    expect(checkCoverChangeAllowed(t0, new Date("2026-09-21T00:00:00Z"))).toEqual({ allowed: true });
    expect(coverChangeMessage(20 * 60 * 1000)).toBe("You can change your cover again in 1 hour");
  });

  it("rejects trims longer than 30s", () => {
    expect(parseTrim("0", "20")).toEqual({ start: 0, duration: 20 });
    expect(parseTrim("0", "31")).toHaveProperty("error");
    expect(parseTrim(undefined, undefined)).toBeNull();
  });
});

describe("POST /api/profile/cover-video", () => {
  it("rejects a video longer than 30 seconds", async () => {
    probe.source = 42;
    const response = await call("POST", "/api/profile/cover-video", seller, MP4);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "cover_too_long" });
    const [row] = await db.select({ url: users.coverVideoUrl, at: users.coverVideoUpdatedAt }).from(users).where(eq(users.clerkId, seller));
    expect(row).toEqual({ url: null, at: null });
  });

  it("accepts a trimmed long clip, then re-validates the rendered result", async () => {
    probe.source = 42;
    probe.rendered = 31.5; // a broken render must still be refused
    const bad = await call("POST", "/api/profile/cover-video?trimStart=4&trimDuration=20", seller, MP4);
    expect(bad.status).toBe(400);
    probe.rendered = 20;
    const ok = await call("POST", "/api/profile/cover-video?trimStart=4&trimDuration=20", seller, MP4);
    expect(ok.status).toBe(201);
    const body = await ok.json() as any;
    expect(body.coverVideoUrl).toMatch(/\/api\/profile\/cover-media\/uploads\/cover-/);
    expect(body.coverPosterUrl).toMatch(/\/api\/profile\/cover-media\/uploads\/cover-/);
  });

  it("enforces one change per 24h, with a friendly hours message, then allows it after", async () => {
    clock = new Date("2026-09-20T12:00:00Z");
    const first = await call("POST", "/api/profile/cover-video", owner, MP4);
    expect(first.status).toBe(201);
    const firstBody = await first.json() as any;

    clock = new Date("2026-09-20T18:30:00Z");
    const second = await call("POST", "/api/profile/cover-video", owner, MP4);
    expect(second.status).toBe(429);
    const limited = await second.json() as any;
    expect(limited).toMatchObject({ code: "cover_change_rate_limited", retryAfterHours: 18 });
    expect(limited.error).toBe("You can change your cover again in 18 hours");

    // Removing is also a change: blocked inside the window…
    expect((await call("DELETE", "/api/profile/cover-video", owner)).status).toBe(429);

    clock = new Date("2026-09-21T12:00:01Z");
    const third = await call("POST", "/api/profile/cover-video", owner, MP4);
    expect(third.status).toBe(201);
    // …and the replaced cover's objects are cleaned up.
    expect(deleted).toEqual(expect.arrayContaining([
      firstBody.coverVideoUrl.replace(/^.*\/cover-media\//, "/objects/"),
      firstBody.coverPosterUrl.replace(/^.*\/cover-media\//, "/objects/"),
    ]));
  });

  it("removing restarts the 24h window, so remove-then-re-add can't cycle covers", async () => {
    clock = new Date("2026-09-23T12:00:00Z");
    const removed = await call("DELETE", "/api/profile/cover-video", owner);
    expect(removed.status).toBe(200);
    expect(await removed.json()).toMatchObject({ coverVideoUrl: null, coverPosterUrl: null });
    clock = new Date("2026-09-23T13:00:00Z");
    const readd = await call("POST", "/api/profile/cover-video", owner, MP4);
    expect(readd.status).toBe(429);
    expect(((await readd.json()) as any).retryAfterHours).toBe(23);
  });

  it("requires auth and a real video body", async () => {
    expect((await call("POST", "/api/profile/cover-video", undefined, MP4)).status).toBe(401);
    const notVideo = await fetch(`${base}/api/profile/cover-video`, {
      method: "POST", headers: { "x-test-user-id": stranger, "content-type": "video/mp4" }, body: Buffer.from("not a video at all"),
    });
    expect(notVideo.status).toBe(400);
  });
});

describe("first-visit coach mark", () => {
  it("is unseen for a new account, then seen forever after one dismissal (any device/session)", async () => {
    const before = await call("GET", "/api/profile/cover-coachmark", stranger).then((r) => r.json() as Promise<any>);
    expect(before.seen).toBe(false);
    expect((await call("POST", "/api/profile/cover-coachmark/seen", stranger)).status).toBe(200);
    const [first] = await db.select({ at: users.coverCoachmarkSeenAt }).from(users).where(eq(users.clerkId, stranger));
    // A second dismissal (another device) keeps the original timestamp.
    expect((await call("POST", "/api/profile/cover-coachmark/seen", stranger)).status).toBe(200);
    const [second] = await db.select({ at: users.coverCoachmarkSeenAt }).from(users).where(eq(users.clerkId, stranger));
    expect(second.at?.getTime()).toBe(first.at?.getTime());
    // A fresh "session" reads the server flag, not local storage.
    const after = await call("GET", "/api/profile/cover-coachmark", stranger).then((r) => r.json() as Promise<any>);
    expect(after.seen).toBe(true);
  });
});

describe("public profile responses include the cover", () => {
  it("returns cover video + poster URLs on the public seller profile, the username profile and the social profile", async () => {
    const sellerProfile = await call("GET", `/api/public/sellers/${seller}`, stranger).then((r) => r.json() as Promise<any>);
    expect(sellerProfile.profile.coverVideoUrl).toMatch(/cover-media/);
    expect(sellerProfile.profile.coverPosterUrl).toMatch(/cover-media/);
    expect(sellerProfile.profile).not.toHaveProperty("coverVideoModerationStatus");

    const byUsername = await call("GET", `/api/public/profiles/pcseller${suffix}`).then((r) => r.json() as Promise<any>);
    expect(byUsername.coverVideoUrl).toBe(sellerProfile.profile.coverVideoUrl);

    const social = await call("GET", `/api/social/profile/${seller}`, stranger).then((r) => r.json() as Promise<any>);
    expect(social.coverVideoUrl).toBe(sellerProfile.profile.coverVideoUrl);
    expect(social.coverPosterUrl).toBe(sellerProfile.profile.coverPosterUrl);
  });

  it("hides a moderated cover everywhere", async () => {
    await db.update(users).set({ coverVideoModerationStatus: "removed" }).where(eq(users.clerkId, seller));
    const sellerProfile = await call("GET", `/api/public/sellers/${seller}`, stranger).then((r) => r.json() as Promise<any>);
    expect(sellerProfile.profile.coverVideoUrl).toBeNull();
    expect(sellerProfile.profile.coverPosterUrl).toBeNull();
    await db.update(users).set({ coverVideoModerationStatus: "visible" }).where(eq(users.clerkId, seller));
  });
});
