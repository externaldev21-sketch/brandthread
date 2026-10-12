/**
 * Profile cover / banner: server-enforced 24h change limit (set AND remove),
 * ≤10s duration (the client trims longer clips), GIF banners (converted to a
 * looping MP4, original kept) and the `profileBanner` API field, the once-only first-visit coach mark, and the
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
import { checkCoverChangeAllowed, coverChangeMessage, parseCrop, parseTrim, profileBannerFromRow } from "../../lib/profileCover";

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
const bannerOwner = `pc-banner-${suffix}`;
const userIds = [owner, seller, stranger, bannerOwner];

/** A tiny buffer that passes the MP4 magic-byte check ("ftyp" at offset 4). */
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypisom"), Buffer.alloc(64)]);

let clock = new Date("2026-09-20T12:00:00Z");
const probe = { source: 8, rendered: 8 };
/** What the last render was asked to do (trim + crop). */
const lastRender: { trim: unknown; crop: unknown } = { trim: null, crop: null };
const lastGif: { crop: unknown; fail: boolean } = { crop: null, fail: false };
/** A tiny buffer that passes the GIF magic-byte check. */
const GIF = Buffer.concat([Buffer.from("GIF89a"), Buffer.alloc(64)]);
const stored: string[] = [];
const deleted: string[] = [];
let server: Server;
let base = "";

function call(method: string, path: string, as?: string, body?: Buffer, contentType = "video/mp4") {
  return fetch(`${base}${path}`, {
    method,
    headers: { ...(as ? { "x-test-user-id": as } : {}), ...(body ? { "content-type": contentType } : {}) },
    body,
  });
}

beforeAll(async () => {
  await db.insert(users).values([
    { clerkId: owner, email: `${owner}@test.local`, name: "Cover Buyer", displayName: "Cover Buyer", username: `pcbuyer${suffix}`, role: "buyer", accountType: "buyer" },
    { clerkId: seller, email: `${seller}@test.local`, name: "Cover Seller", displayName: "Cover Seller", brandName: "Cover Co", username: `pcseller${suffix}`, role: "seller", accountType: "seller" },
    { clerkId: bannerOwner, email: `${bannerOwner}@test.local`, name: "Banner Buyer", displayName: "Banner Buyer", username: `pcbanner${suffix}`, role: "buyer", accountType: "buyer" },
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
      render: async (_input, output, poster, trim, crop) => {
        lastRender.trim = trim;
        lastRender.crop = crop ?? null;
        await fs.writeFile(output, Buffer.from("rendered"));
        await fs.writeFile(poster, Buffer.from("poster"));
      },
      renderGif: async (_input, output, poster, crop) => {
        lastGif.crop = crop;
        if (lastGif.fail) throw new Error("ffmpeg could not read this GIF");
        await fs.writeFile(output, Buffer.from("gif-rendition"));
        await fs.writeFile(poster, Buffer.from("gif-poster"));
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
  probe.source = 8;
  probe.rendered = 8;
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

  it("rejects trims longer than 10s", () => {
    expect(parseTrim("0", "10")).toEqual({ start: 0, duration: 10 });
    expect(parseTrim("0", "11")).toHaveProperty("error");
    expect(parseTrim(undefined, undefined)).toBeNull();
  });
});

describe("POST /api/profile/cover-video", () => {
  it("rejects a video longer than 10 seconds sent without a trim window", async () => {
    probe.source = 42;
    const bad = await call("POST", "/api/profile/cover-video", seller, MP4);
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ code: "cover_too_long" });
    const [row] = await db.select({ url: users.coverVideoUrl, at: users.coverVideoUpdatedAt }).from(users).where(eq(users.clerkId, seller));
    expect(row).toEqual({ url: null, at: null });
  });

  it("accepts a long clip with the chosen 10s window + banner crop, then re-validates the rendered result", async () => {
    probe.source = 42;
    probe.rendered = 10.6; // a broken render must still be refused
    const bad = await call("POST", "/api/profile/cover-video?trimStart=4&trimDuration=10", seller, MP4);
    expect(bad.status).toBe(400);
    probe.rendered = 10;
    const ok = await call("POST", "/api/profile/cover-video?trimStart=4&trimDuration=10&cropX=0&cropY=0.2&cropW=1&cropH=0.5", seller, MP4);
    expect(ok.status).toBe(201);
    expect(lastRender.trim).toEqual({ start: 4, duration: 10 });
    expect(lastRender.crop).toEqual({ x: 0, y: 0.2, width: 1, height: 0.5 });
    const body = await ok.json() as any;
    expect(body.coverVideoUrl).toMatch(/\/api\/profile\/cover-media\/uploads\/cover-/);
    expect(body.coverPosterUrl).toMatch(/\/api\/profile\/cover-media\/uploads\/cover-/);
    expect(body.profileBanner).toEqual({ type: "video", url: body.coverVideoUrl, posterUrl: body.coverPosterUrl });
  });

  it("refuses a crop rect outside the source", async () => {
    const response = await call("POST", "/api/profile/cover-video?cropX=0.5&cropY=0&cropW=0.8&cropH=1", stranger, MP4);
    expect(response.status).toBe(400);
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

describe("profile banner rules (pure)", () => {
  it("parses a normalized crop rect (all four or none)", () => {
    expect(parseCrop(undefined, undefined, undefined, undefined)).toBeNull();
    expect(parseCrop("0", "0.25", "1", "0.5")).toEqual({ x: 0, y: 0.25, width: 1, height: 0.5 });
    expect(parseCrop("0", "0.25", "1", undefined)).toHaveProperty("error");
    expect(parseCrop("-0.1", "0", "1", "1")).toHaveProperty("error");
    expect(parseCrop("0.5", "0", "0.6", "1")).toHaveProperty("error");
  });

  it("reads the banner type from the row; older rows with a video read as a video banner", () => {
    expect(profileBannerFromRow({})).toBeNull();
    expect(profileBannerFromRow({ coverVideoUrl: "v", coverPosterUrl: "p" })).toEqual({ type: "video", url: "v", posterUrl: "p" });
    expect(profileBannerFromRow({ coverMediaType: "video", coverVideoUrl: "v", coverPosterUrl: null })).toEqual({ type: "video", url: "v", posterUrl: null });
    // A GIF plays its MP4 rendition, keeping the original GIF as the fallback…
    expect(profileBannerFromRow({ coverMediaType: "gif", coverVideoUrl: "m", coverPosterUrl: "p", coverImageUrl: "g" }))
      .toEqual({ type: "gif", url: "m", posterUrl: "p", gifUrl: "g" });
    // …or the GIF itself when it couldn't be converted.
    expect(profileBannerFromRow({ coverMediaType: "gif", coverVideoUrl: null, coverImageUrl: "g" }))
      .toEqual({ type: "gif", url: "g", posterUrl: null, gifUrl: "g" });
    expect(profileBannerFromRow({ coverMediaType: "gif" })).toBeNull();
  });
});

describe("GIF banner (POST /api/profile/cover-gif)", () => {
  it("rejects a non-GIF body, a non-GIF type and a bad crop", async () => {
    clock = new Date("2026-10-01T12:00:00Z");
    expect((await call("POST", "/api/profile/cover-gif", undefined, GIF, "image/gif")).status).toBe(401);
    expect((await call("POST", "/api/profile/cover-gif", bannerOwner, Buffer.from("definitely not a gif at all"), "image/gif")).status).toBe(400);
    expect((await call("POST", "/api/profile/cover-gif", bannerOwner, GIF, "image/png")).status).toBe(415);
    expect((await call("POST", "/api/profile/cover-gif?cropX=0&cropY=0&cropW=2&cropH=1", bannerOwner, GIF, "image/gif")).status).toBe(400);
  });

  it("refuses GIFs over ~15MB", async () => {
    const big = Buffer.concat([Buffer.from("GIF89a"), Buffer.alloc(15 * 1024 * 1024 + 10)]);
    expect((await call("POST", "/api/profile/cover-gif", bannerOwner, big, "image/gif")).status).toBe(413);
  });

  it("converts the GIF to a looping MP4 (+ poster), keeps the original, and every profile response carries it", async () => {
    clock = new Date("2026-10-01T12:00:00Z");
    const response = await call("POST", "/api/profile/cover-gif?cropX=0&cropY=0.1&cropW=1&cropH=0.8", bannerOwner, GIF, "image/gif");
    expect(response.status).toBe(201);
    expect(lastGif.crop).toEqual({ x: 0, y: 0.1, width: 1, height: 0.8 });
    const body = await response.json() as any;
    expect(body.profileBanner).toEqual({ type: "gif", url: body.coverVideoUrl, posterUrl: body.coverPosterUrl, gifUrl: body.coverGifUrl });
    for (const url of [body.coverVideoUrl, body.coverPosterUrl, body.coverGifUrl]) {
      expect(url).toMatch(/\/api\/profile\/cover-media\/uploads\/cover-/);
    }

    const [row] = await db.select({ type: users.coverMediaType, gif: users.coverImageUrl, video: users.coverVideoUrl })
      .from(users).where(eq(users.clerkId, bannerOwner));
    expect(row).toEqual({ type: "gif", gif: body.coverGifUrl, video: body.coverVideoUrl });

    const own = await call("GET", "/api/profile/cover-video", bannerOwner).then((r) => r.json() as Promise<any>);
    expect(own.profileBanner).toEqual(body.profileBanner);
    const social = await call("GET", `/api/social/profile/${bannerOwner}`, stranger).then((r) => r.json() as Promise<any>);
    expect(social.profileBanner).toEqual(body.profileBanner);
    // Older clients that only read the cover video still get a looping banner.
    expect(social.coverVideoUrl).toBe(body.coverVideoUrl);
    const byUsername = await call("GET", `/api/public/profiles/pcbanner${suffix}`).then((r) => r.json() as Promise<any>);
    expect(byUsername.profileBanner).toEqual(body.profileBanner);
    const coach = await call("GET", "/api/profile/cover-coachmark", bannerOwner).then((r) => r.json() as Promise<any>);
    expect(coach.hasCover).toBe(true);
  });

  it("a video banner replaces the GIF (all three old objects deleted); removing clears everything", async () => {
    clock = new Date("2026-10-02T12:00:01Z");
    const before = await call("GET", "/api/profile/cover-video", bannerOwner).then((r) => r.json() as Promise<any>);
    probe.source = 8;
    probe.rendered = 8;
    const video = await call("POST", "/api/profile/cover-video", bannerOwner, MP4);
    expect(video.status).toBe(201);
    expect(((await video.json()) as any).profileBanner.type).toBe("video");
    for (const url of [before.profileBanner.url, before.profileBanner.posterUrl, before.profileBanner.gifUrl]) {
      expect(deleted).toContain(url.replace(/^.*\/cover-media\//, "/objects/"));
    }
    const [row] = await db.select({ type: users.coverMediaType, gif: users.coverImageUrl }).from(users).where(eq(users.clerkId, bannerOwner));
    expect(row).toEqual({ type: "video", gif: null });

    clock = new Date("2026-10-03T12:00:02Z");
    const removed = await call("DELETE", "/api/profile/cover-video", bannerOwner);
    expect(removed.status).toBe(200);
    expect(((await removed.json()) as any).profileBanner).toBeNull();
    const social = await call("GET", `/api/social/profile/${bannerOwner}`, stranger).then((r) => r.json() as Promise<any>);
    expect(social.profileBanner).toBeNull();
  });

  it("shares the 24h change window with video banners", async () => {
    clock = new Date("2026-10-03T13:00:00Z");
    const response = await call("POST", "/api/profile/cover-gif", bannerOwner, GIF, "image/gif");
    expect(response.status).toBe(429);
    expect(((await response.json()) as any).code).toBe("cover_change_rate_limited");
  });

  it("serves the original GIF when conversion fails", async () => {
    clock = new Date("2026-10-05T12:00:00Z");
    lastGif.fail = true;
    try {
      const response = await call("POST", "/api/profile/cover-gif", bannerOwner, GIF, "image/gif");
      expect(response.status).toBe(201);
      const body = await response.json() as any;
      expect(body.profileBanner).toEqual({ type: "gif", url: body.coverGifUrl, posterUrl: null, gifUrl: body.coverGifUrl });
    } finally {
      lastGif.fail = false;
    }
  });
});
