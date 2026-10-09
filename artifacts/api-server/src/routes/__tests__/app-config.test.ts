/**
 * Public client release config (GET /api/v1/app/config). Env-only; no DB.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import appConfigRouter, { resolveAppConfig } from "../app-config";

describe("resolveAppConfig", () => {
  it("defaults to no forced update, no flags and no critical updates", () => {
    expect(resolveAppConfig({})).toEqual({
      minSupportedVersion: { ios: null, android: null },
      latestVersion: null,
      storeUrls: { ios: null, android: null },
      flags: {},
      criticalUpdateIds: [],
    });
  });

  it("reads versions, store URLs, flags and critical update ids from env", () => {
    const config = resolveAppConfig({
      MIN_APP_VERSION_IOS: " 1.2.0 ",
      MIN_APP_VERSION_ANDROID: "1.1",
      LATEST_APP_VERSION: "1.4.0",
      APP_STORE_URL_IOS: "https://apps.apple.com/app/id123456789",
      APP_STORE_URL_ANDROID: "https://play.google.com/store/apps/details?id=com.brandthread.mobile",
      APP_FLAGS: '{"force_update_gate":false,"new_thing":true}',
      OTA_CRITICAL_UPDATE_IDS: "0f1e2d3c-aaaa-bbbb-cccc-1234567890ab, 11112222-3333-4444-5555-666677778888",
    });
    expect(config.minSupportedVersion).toEqual({ ios: "1.2.0", android: "1.1" });
    expect(config.latestVersion).toBe("1.4.0");
    expect(config.storeUrls.ios).toBe("https://apps.apple.com/app/id123456789");
    expect(config.storeUrls.android).toContain("com.brandthread.mobile");
    expect(config.flags).toEqual({ force_update_gate: false, new_thing: true });
    expect(config.criticalUpdateIds).toHaveLength(2);
  });

  it("drops malformed values instead of throwing", () => {
    const config = resolveAppConfig({
      MIN_APP_VERSION_IOS: "latest",
      MIN_APP_VERSION_ANDROID: "1.0.0; rm -rf",
      APP_STORE_URL_IOS: "javascript:alert(1)",
      APP_STORE_URL_ANDROID: "not a url",
      APP_FLAGS: '{"ok":true,"Bad Name":true,"str":"yes","nested":{"a":1}}',
      OTA_CRITICAL_UPDATE_IDS: "short,<script>",
    });
    expect(config.minSupportedVersion).toEqual({ ios: null, android: null });
    expect(config.storeUrls).toEqual({ ios: null, android: null });
    expect(config.flags).toEqual({ ok: true });
    expect(config.criticalUpdateIds).toEqual([]);
    expect(resolveAppConfig({ APP_FLAGS: "{not json" }).flags).toEqual({});
    expect(resolveAppConfig({ APP_FLAGS: "[true]" }).flags).toEqual({});
  });
});

describe("GET /app/config", () => {
  let server: Server;
  let baseUrl = "";
  const saved = process.env.MIN_APP_VERSION_IOS;

  beforeAll(async () => {
    process.env.MIN_APP_VERSION_IOS = "2.0.0";
    const app = express();
    app.use("/api/v1/app", appConfigRouter);
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    if (saved === undefined) delete process.env.MIN_APP_VERSION_IOS;
    else process.env.MIN_APP_VERSION_IOS = saved;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("is public and cacheable", async () => {
    const response = await fetch(`${baseUrl}/api/v1/app/config`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("max-age=60");
    const body = (await response.json()) as { minSupportedVersion: { ios: string | null } };
    expect(body.minSupportedVersion.ios).toBe("2.0.0");
  });
});
