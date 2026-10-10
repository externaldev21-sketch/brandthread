import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { describe, expect, it } from "vitest";
import {
  decideMediaDelivery,
  mediaDeliveryMode,
  redirectToPublicMedia,
  signedUrlTtlSec,
  SignedMediaUrls,
} from "../mediaDelivery";

describe("mediaDeliveryMode", () => {
  it("redirects in production and whenever a CDN is configured, streams in dev", () => {
    expect(mediaDeliveryMode({ NODE_ENV: "production" })).toBe("redirect");
    expect(mediaDeliveryMode({ NODE_ENV: "development" })).toBe("stream");
    expect(mediaDeliveryMode({})).toBe("stream");
    expect(mediaDeliveryMode({ CDN_BASE_URL: "https://media.brandthread.app" })).toBe("redirect");
  });

  it("MEDIA_DELIVERY overrides both ways", () => {
    expect(mediaDeliveryMode({ NODE_ENV: "production", MEDIA_DELIVERY: "stream" })).toBe("stream");
    expect(mediaDeliveryMode({ MEDIA_DELIVERY: "redirect" })).toBe("redirect");
  });

  it("signed URL TTL defaults to 15 minutes and rejects silly values", () => {
    expect(signedUrlTtlSec({})).toBe(900);
    expect(signedUrlTtlSec({ MEDIA_SIGNED_URL_TTL_SEC: "600" })).toBe(600);
    expect(signedUrlTtlSec({ MEDIA_SIGNED_URL_TTL_SEC: "5" })).toBe(900);
    expect(signedUrlTtlSec({ MEDIA_SIGNED_URL_TTL_SEC: "abc" })).toBe(900);
  });
});

describe("decideMediaDelivery", () => {
  const now = 1_000_000;
  it("streams when not in redirect mode or when there is no signed URL", () => {
    expect(decideMediaDelivery({ mode: "stream", signed: { url: "u", expiresAt: now + 900_000 }, now })).toEqual({ kind: "stream" });
    expect(decideMediaDelivery({ mode: "redirect", signed: null, now })).toEqual({ kind: "stream" });
    expect(decideMediaDelivery({ mode: "redirect", signed: { url: "u", expiresAt: now - 1 }, now })).toEqual({ kind: "stream" });
  });

  it("redirects with a cache lifetime that never outlives the signature", () => {
    expect(decideMediaDelivery({ mode: "redirect", signed: { url: "https://cdn/x?sig", expiresAt: now + 900_000 }, now }))
      .toEqual({ kind: "redirect", url: "https://cdn/x?sig", cacheControl: "public, max-age=300" });
    expect(decideMediaDelivery({ mode: "redirect", signed: { url: "u", expiresAt: now + 200_000 }, now }))
      .toEqual({ kind: "redirect", url: "u", cacheControl: "public, max-age=140" });
    expect(decideMediaDelivery({ mode: "redirect", signed: { url: "u", expiresAt: now + 30_000 }, now }))
      .toEqual({ kind: "redirect", url: "u", cacheControl: "no-store" });
  });
});

describe("SignedMediaUrls", () => {
  it("reuses one signed URL per object until a third of its life is left", async () => {
    let now = 0;
    let n = 0;
    const urls = new SignedMediaUrls({ sign: async (p) => `${p}?sig=${++n}`, ttlSec: 900, now: () => now });
    expect((await urls.get("/objects/a"))!.url).toBe("/objects/a?sig=1");
    now = 500_000;
    expect((await urls.get("/objects/a"))!.url).toBe("/objects/a?sig=1");
    now = 700_000;
    expect((await urls.get("/objects/a"))!.url).toBe("/objects/a?sig=2");
    expect((await urls.get("/objects/b"))!.url).toBe("/objects/b?sig=3");
  });

  it("returns null (stream) when signing fails, and does not retry during the cooldown", async () => {
    let now = 0;
    let calls = 0;
    const urls = new SignedMediaUrls({ sign: async () => { calls++; throw new Error("no sidecar"); }, now: () => now, cooldownMs: 60_000 });
    expect(await urls.get("/objects/a")).toBeNull();
    expect(await urls.get("/objects/b")).toBeNull();
    expect(calls).toBe(1);
    now = 61_000;
    expect(await urls.get("/objects/b")).toBeNull();
    expect(calls).toBe(2);
  });
});

describe("redirectToPublicMedia", () => {
  async function serve(env: Record<string, string>, signer: SignedMediaUrls, run: (base: string) => Promise<void>) {
    const app = express();
    app.get("/api/posts/media/*path", async (_req, res) => {
      if (await redirectToPublicMedia(res, "/objects/uploads/v.mp4", { env, signer })) return;
      res.setHeader("Accept-Ranges", "bytes");
      res.send("streamed-bytes");
    });
    const server: Server = app.listen(0);
    await new Promise<void>((r) => server.once("listening", r));
    try { await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`); }
    finally { await new Promise<void>((r) => server.close(() => r())); }
  }

  it("302s to the signed CDN URL (Range requests then go to the CDN)", async () => {
    const signer = new SignedMediaUrls({ sign: async () => "https://media.brandthread.app/bucket/uploads/v.mp4?X-Goog-Signature=abc" });
    await serve({ MEDIA_DELIVERY: "redirect" }, signer, async (base) => {
      const res = await fetch(`${base}/api/posts/media/uploads/v.mp4`, { redirect: "manual", headers: { Range: "bytes=0-1023" } });
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("https://media.brandthread.app/bucket/uploads/v.mp4?X-Goog-Signature=abc");
      expect(res.headers.get("cache-control")).toBe("public, max-age=300");
    });
  });

  it("falls back to streaming when signing is unavailable or the mode is stream", async () => {
    const failing = new SignedMediaUrls({ sign: async () => { throw new Error("no sidecar"); } });
    await serve({ MEDIA_DELIVERY: "redirect" }, failing, async (base) => {
      const res = await fetch(`${base}/api/posts/media/uploads/v.mp4`, { redirect: "manual" });
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("streamed-bytes");
    });
    const ok = new SignedMediaUrls({ sign: async () => "https://x" });
    await serve({ MEDIA_DELIVERY: "stream" }, ok, async (base) => {
      const res = await fetch(`${base}/api/posts/media/uploads/v.mp4`, { redirect: "manual" });
      expect(res.status).toBe(200);
    });
  });
});
