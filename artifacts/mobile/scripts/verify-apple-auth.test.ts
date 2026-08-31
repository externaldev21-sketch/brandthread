import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const appConfig = JSON.parse(
  readFileSync(path.resolve(__dirname, "../app.json"), "utf8"),
).expo;
const easConfig = JSON.parse(
  readFileSync(path.resolve(__dirname, "../eas.json"), "utf8"),
);
const nativePrebuildSource = readFileSync(
  path.resolve(__dirname, "./native-prebuild.js"),
  "utf8",
);
const { getAppleAuthErrors } = require("./verify-apple-auth.js") as {
  getAppleAuthErrors: (config: unknown) => string[];
};
const { getIosBuildConfigErrors, REQUIRED_IMAGE, REQUIRED_PROFILES } = require(
  "./verify-ios-build.js",
) as {
  getIosBuildConfigErrors: (config: unknown) => string[];
  REQUIRED_IMAGE: string;
  REQUIRED_PROFILES: string[];
};

describe("Apple sign-in native configuration", () => {
  it("keeps the bundle, URL scheme, entitlement, and Expo capability aligned", () => {
    expect(getAppleAuthErrors(appConfig)).toEqual([]);
    expect(appConfig.ios.bundleIdentifier).toBe("com.brandthread.mobile");
    expect(appConfig.scheme).toBe("brandthread");
    expect(appConfig.plugins).toContain("expo-apple-authentication");
  });

  it("pins every iOS build profile to a named Xcode 26 image", () => {
    expect(REQUIRED_IMAGE).toBe("macos-sequoia-15.6-xcode-26.0");
    expect(getIosBuildConfigErrors(easConfig)).toEqual([]);
    expect(Object.keys(easConfig.build)).toEqual(REQUIRED_PROFILES);
  });

  it("rejects capability or image drift", () => {
    expect(getAppleAuthErrors({
      ...appConfig,
      scheme: "wrong-scheme",
      ios: { ...appConfig.ios, usesAppleSignIn: false },
    })).toEqual([
      'Expo scheme must remain "brandthread"',
      "ios.usesAppleSignIn must be true",
    ]);
    expect(getIosBuildConfigErrors({
      build: {
        development: { ios: { image: "latest" } },
        preview: { ios: { image: REQUIRED_IMAGE } },
        production: { ios: { image: REQUIRED_IMAGE } },
      },
    })).toHaveLength(1);
  });

  it("runs every identity, Apple capability, and image check before native prebuild", () => {
    expect(nativePrebuildSource).toContain("verifyAppIdentity()");
    expect(nativePrebuildSource).toContain("verifyAppleAuth()");
    expect(nativePrebuildSource).toContain("verifyIosBuild()");
    expect(nativePrebuildSource.indexOf("verifyIosBuild()"))
      .toBeLessThan(nativePrebuildSource.indexOf("spawnSync("));
  });
});