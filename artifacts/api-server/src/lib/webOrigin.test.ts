import { afterEach, describe, expect, it } from "vitest";
import { getWebOrigin } from "./webOrigin";

const originalEnvironment = {
  NODE_ENV: process.env.NODE_ENV,
  REPLIT_DEPLOYMENT_DOMAIN: process.env.REPLIT_DEPLOYMENT_DOMAIN,
  REPLIT_INTERNAL_APP_DOMAIN: process.env.REPLIT_INTERNAL_APP_DOMAIN,
  REPLIT_DEV_DOMAIN: process.env.REPLIT_DEV_DOMAIN,
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