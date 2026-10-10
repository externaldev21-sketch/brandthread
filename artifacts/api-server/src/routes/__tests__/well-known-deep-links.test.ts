import { afterEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import wellKnown, { DEEP_LINK_PATHS, missingAppLinkEnv } from "../wellKnown";

async function aasa(env: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v as string);
  const app = express();
  app.use("/.well-known", wellKnown);
  const server = await new Promise<import("node:http").Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  try {
    const r = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/.well-known/apple-app-site-association`);
    return { status: r.status, type: r.headers.get("content-type"), body: (await r.json()) as any };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe("apple-app-site-association", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("claims the share paths for posts, hashtags and places alongside existing ones", async () => {
    const r = await aasa({ APPLE_TEAM_ID: "ABCDE12345" });
    expect(r.status).toBe(200);
    expect(r.type).toContain("application/json");
    const paths: string[] = r.body.applinks.details[0].paths;
    for (const p of ["/u/*", "/c/*", "/store/*", "/drops/*", "/p/*", "/tag/*", "/place/*"]) {
      expect(paths).toContain(p);
    }
    expect(r.body.applinks.details[0].appID).toBe("ABCDE12345.com.brandthread.mobile");
    expect(DEEP_LINK_PATHS).toEqual(paths);
  });

  it("stays validly shaped with no team id configured", async () => {
    const r = await aasa({ APPLE_TEAM_ID: "" });
    expect(r.body.applinks.details).toEqual([]);
  });
});

describe("app-link configuration (BT-302)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("claims the hosted-checkout return page so Stripe's redirect can open the app", () => {
    expect(DEEP_LINK_PATHS).toContain("/checkout-return*");
  });

  it("names exactly the env vars that are still missing", () => {
    vi.stubEnv("APPLE_TEAM_ID", "");
    vi.stubEnv("ANDROID_SHA256_CERT_FINGERPRINTS", "");
    expect(missingAppLinkEnv()).toEqual(["APPLE_TEAM_ID", "ANDROID_SHA256_CERT_FINGERPRINTS"]);
    vi.stubEnv("APPLE_TEAM_ID", "ABCDE12345");
    vi.stubEnv("ANDROID_SHA256_CERT_FINGERPRINTS", "AA:BB");
    expect(missingAppLinkEnv()).toEqual([]);
  });
});
