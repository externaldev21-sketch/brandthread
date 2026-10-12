/**
 * One banner per seller: a former 3:1 storefront banner (`users.banner_url`)
 * is adopted as the profile banner the first time a banner surface reads the
 * seller, so nobody loses theirs; the profile banner's still frame is the
 * storefront cover everywhere (seller profile `bannerUrl`, share preview
 * og:image, launch checklist); the old storefront-banner upload now sets the
 * profile banner. Object storage is a fake; the database is real.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import crypto from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { eq, inArray } from "drizzle-orm";
import { db, users } from "@workspace/db";
import { needsStorefrontBannerAdoption } from "../../lib/storefrontBanner";
import { storefrontCoverUrl } from "../../lib/profileCover";

const { acl, created, deleted } = vi.hoisted(() => ({
  acl: [] as Array<{ path: string; visibility: string }>,
  created: [] as string[],
  deleted: [] as string[],
}));

vi.mock("../../lib/objectStorage", () => ({
  ObjectStorageService: class {
    async trySetObjectEntityAclPolicy(path: string, policy: { visibility: string }) {
      acl.push({ path, visibility: policy.visibility });
      return path;
    }
    async createObjectEntityFromBuffer() {
      const path = `/objects/uploads/banner-${crypto.randomBytes(4).toString("hex")}`;
      created.push(path);
      return path;
    }
    async deleteObjectEntity(path: string) { deleted.push(path); }
    async getObjectEntityDownloadURL(path: string) { return `https://signed.example/${path}`; }
  },
}));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: () => void) => {
    const viewer = req.header("x-test-user-id");
    if (!viewer) { res.status(401).json({ error: "Unauthorized" }); return; }
    req.clerkUserId = viewer;
    next();
  },
}));
vi.mock("../notifications-feed", () => ({ publishNotification: async () => undefined }));

const suffix = crypto.randomBytes(6).toString("hex");
const legacy = `sb-legacy-${suffix}`;      // storefront banner only
const both = `sb-both-${suffix}`;          // storefront banner + a profile banner
const external = `sb-ext-${suffix}`;       // storefront banner stored as an https URL
const uploader = `sb-up-${suffix}`;        // uploads through the old storefront endpoint
const viewer = `sb-viewer-${suffix}`;
const ids = [legacy, both, external, uploader, viewer];
const LEGACY_PATH = `/objects/uploads/legacy-${suffix}`;

let server: Server;
let base = "";
const call = (path: string, as?: string, init: RequestInit = {}) =>
  fetch(`${base}${path}`, { ...init, headers: { ...(as ? { "x-test-user-id": as } : {}), ...(init.headers ?? {}) } });

beforeAll(async () => {
  const seller = (clerkId: string, extra: Record<string, unknown>) => ({
    clerkId, email: `${clerkId}@test.local`, name: clerkId, displayName: clerkId, brandName: `Brand ${clerkId}`,
    username: clerkId.replace(/-/g, ""), role: "seller", accountType: "seller", ...extra,
  });
  await db.insert(users).values([
    seller(legacy, { bannerUrl: LEGACY_PATH, logoUrl: "/objects/uploads/logo" }),
    seller(both, {
      bannerUrl: `/objects/uploads/old-${suffix}`,
      coverMediaType: "video", coverVideoUrl: "https://cdn.example/v.mp4", coverPosterUrl: "https://cdn.example/p.jpg",
    }),
    seller(external, { bannerUrl: "https://cdn.example/storefront.jpg" }),
    seller(uploader, { coverMediaType: "gif", coverVideoUrl: "http://h/api/profile/cover-media/uploads/old-gif.mp4", coverPosterUrl: "http://h/api/profile/cover-media/uploads/old-gif.jpg" }),
    { clerkId: viewer, email: `${viewer}@test.local`, name: "Viewer", username: `sbviewer${suffix}`, role: "buyer", accountType: "buyer" },
  ] as any);

  const { default: publicRouter } = await import("../public");
  const { default: socialRouter } = await import("../social");
  const { default: sellerProfileRouter } = await import("../seller-profile");
  const { default: launchRouter } = await import("../seller-launch-checklist");
  const { profileLanding } = await import("../profileLanding");
  const app = express();
  app.use("/api/public", publicRouter);
  app.use("/api/social", socialRouter);
  app.use("/api/seller/launch-checklist", launchRouter);
  app.use("/api/seller", sellerProfileRouter);
  app.get("/u/:username", profileLanding);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(users).where(inArray(users.clerkId, ids));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("rules (pure)", () => {
  it("adopts only when there is a storefront banner and no profile banner", () => {
    expect(needsStorefrontBannerAdoption({ clerkId: "a", bannerUrl: "/objects/x" })).toBe(true);
    expect(needsStorefrontBannerAdoption({ clerkId: "a", bannerUrl: null })).toBe(false);
    expect(needsStorefrontBannerAdoption({ clerkId: "a", bannerUrl: "/objects/x", coverVideoUrl: "https://v", coverMediaType: "video" })).toBe(false);
  });

  it("the storefront cover is the banner's still: poster, else the GIF / still itself", () => {
    expect(storefrontCoverUrl(null)).toBeNull();
    expect(storefrontCoverUrl({ type: "video", url: "v", posterUrl: "p" })).toBe("p");
    expect(storefrontCoverUrl({ type: "gif", url: "g", posterUrl: null, gifUrl: "g" })).toBe("g");
    expect(storefrontCoverUrl({ type: "image", url: "i", posterUrl: "i" })).toBe("i");
  });
});

describe("adopting a former storefront banner", () => {
  it("the public seller profile adopts it as the profile banner (made public, served via cover-media), once", async () => {
    const body = await call(`/api/public/sellers/${legacy}`, viewer).then((r) => r.json() as Promise<any>);
    const banner = body.profile.profileBanner;
    expect(banner.type).toBe("image");
    expect(banner.url).toMatch(new RegExp(`/api/profile/cover-media/uploads/legacy-${suffix}$`));
    expect(banner.posterUrl).toBe(banner.url);
    expect(body.profile).not.toHaveProperty("bannerUrl");
    expect(acl).toContainEqual({ path: LEGACY_PATH, visibility: "public" });

    const [row] = await db.select({ bannerUrl: users.bannerUrl, type: users.coverMediaType, image: users.coverImageUrl })
      .from(users).where(eq(users.clerkId, legacy));
    expect(row).toEqual({ bannerUrl: null, type: "image", image: banner.url });

    // Idempotent: later reads return the same banner without adopting again.
    const aclCalls = acl.length;
    const again = await call(`/api/social/profile/${legacy}`, viewer).then((r) => r.json() as Promise<any>);
    expect(again.profileBanner).toEqual(banner);
    expect(acl.length).toBe(aclCalls);
  });

  it("a set profile banner wins; the old storefront banner is left as it was", async () => {
    const body = await call(`/api/social/profile/${both}`, viewer).then((r) => r.json() as Promise<any>);
    expect(body.profileBanner).toMatchObject({ type: "video", url: "https://cdn.example/v.mp4" });
    const [row] = await db.select({ bannerUrl: users.bannerUrl }).from(users).where(eq(users.clerkId, both));
    expect(row.bannerUrl).toBe(`/objects/uploads/old-${suffix}`);
  });

  it("an https storefront banner is adopted as is", async () => {
    const body = await call(`/api/public/profiles/${external.replace(/-/g, "")}`).then((r) => r.json() as Promise<any>);
    expect(body.profileBanner).toEqual({ type: "image", url: "https://cdn.example/storefront.jpg", posterUrl: "https://cdn.example/storefront.jpg", gifUrl: null });
  });
});

describe("the banner is the storefront cover everywhere", () => {
  it("GET /api/seller/profile: bannerUrl is the banner's still frame", async () => {
    const body = await call("/api/seller/profile", both).then((r) => r.json() as Promise<any>);
    expect(body.bannerUrl).toBe("https://cdn.example/p.jpg");
    expect(body.profileBanner.type).toBe("video");
  });

  it("the share preview uses the banner still as og:image and page cover", async () => {
    const html = await call(`/u/${external.replace(/-/g, "")}`).then((r) => r.text());
    expect(html).toContain('<meta property="og:image" content="https://cdn.example/storefront.jpg">');
    expect(html).toContain('class="cover"');
  });

  it("the launch checklist's logo + banner step counts the profile banner", async () => {
    const body = await call("/api/seller/launch-checklist", legacy).then((r) => r.json() as Promise<any>);
    expect(body.steps.find((step: any) => step.id === "logo_banner").done).toBe(true);
  });

  it("the old storefront-banner upload sets the profile banner (public still) and cleans up the previous one", async () => {
    const { default: sharp } = await import("sharp");
    const jpeg = await sharp({ create: { width: 30, height: 10, channels: 3, background: "#808080" } }).jpeg().toBuffer();
    const response = await call("/api/seller/profile/banner/upload", uploader, {
      method: "POST", headers: { "content-type": "image/jpeg" }, body: jpeg,
    });
    expect(response.status).toBe(201);
    const body = await response.json() as any;
    expect(body.profileBanner).toMatchObject({ type: "image" });
    expect(body.bannerUrl).toBe(body.profileBanner.url);
    expect(acl).toContainEqual({ path: created[created.length - 1], visibility: "public" });
    expect(deleted).toEqual(expect.arrayContaining(["/objects/uploads/old-gif.mp4", "/objects/uploads/old-gif.jpg"]));
    const [row] = await db.select({ type: users.coverMediaType, bannerUrl: users.bannerUrl }).from(users).where(eq(users.clerkId, uploader));
    expect(row).toEqual({ type: "image", bannerUrl: null });
  });
});
