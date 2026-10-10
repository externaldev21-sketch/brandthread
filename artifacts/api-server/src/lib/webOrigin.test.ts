import { afterEach, describe, expect, it } from "vitest";
import { getWebOrigin, isAllowedWebOrigin } from "./webOrigin";

const originalEnvironment = {
  NODE_ENV: process.env.NODE_ENV,
  REPLIT_DEPLOYMENT_DOMAIN: process.env.REPLIT_DEPLOYMENT_DOMAIN,
  REPLIT_INTERNAL_APP_DOMAIN: process.env.REPLIT_INTERNAL_APP_DOMAIN,
  REPLIT_DEV_DOMAIN: process.env.REPLIT_DEV_DOMAIN,
  REPLIT_EXPO_DEV_DOMAIN: process.env.REPLIT_EXPO_DEV_DOMAIN,
};

afterEach(() => {
  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("getWebOrigin", () => {
  it("uses the canonical Brandthread origin for published builds", () => {
    process.env.NODE_ENV = "production";
    process.env.REPLIT_DEPLOYMENT_DOMAIN = "Brandthread.replit.app";
    process.env.REPLIT_DEV_DOMAIN = "preview.example.test";

    expect(getWebOrigin()).toBe("https://brandthread.app");
  });

  it("keeps local preview flows on the active development domain", () => {
    process.env.NODE_ENV = "test";
    delete process.env.REPLIT_DEPLOYMENT_DOMAIN;
    delete process.env.REPLIT_INTERNAL_APP_DOMAIN;
    process.env.REPLIT_DEV_DOMAIN = "preview.example.test";

    expect(getWebOrigin()).toBe("https://preview.example.test");
  });
});

describe("Expo web API origin", () => {
  it("allows only the exact workspace Expo origin in development", () => {
    process.env.NODE_ENV = "development";
    process.env.REPLIT_EXPO_DEV_DOMAIN = "example.expo.replit.dev";
    expect(isAllowedWebOrigin("https://example.expo.replit.dev")).toBe(true);
    expect(isAllowedWebOrigin("https://other.expo.replit.dev")).toBe(false);
  });

  it("does not admit the Expo development origin in production", () => {
    process.env.NODE_ENV = "production";
    process.env.REPLIT_EXPO_DEV_DOMAIN = "example.expo.replit.dev";
    expect(isAllowedWebOrigin("https://example.expo.replit.dev")).toBe(false);
  });
});

describe("CORS_EXTRA_ORIGINS (split deployments)", () => {
  it("admits listed https origins exactly and ignores malformed entries", () => {
    process.env.NODE_ENV = "production";
    process.env.CORS_EXTRA_ORIGINS = "https://manufacturers.brandthread.app/, http://insecure.example, not a url,https://Tour.brandthread.app";
    try {
      expect(isAllowedWebOrigin("https://manufacturers.brandthread.app")).toBe(true);
      expect(isAllowedWebOrigin("https://tour.brandthread.app")).toBe(true);
      expect(isAllowedWebOrigin("http://insecure.example")).toBe(false);
      expect(isAllowedWebOrigin("https://evil.brandthread.app")).toBe(false);
    } finally {
      delete process.env.CORS_EXTRA_ORIGINS;
    }
  });
});