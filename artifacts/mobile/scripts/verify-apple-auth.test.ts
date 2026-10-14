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

  it("uses Expo's current supported iOS image alias", () => {
    expect(REQUIRED_IMAGE).toBe("latest");
    expect(getIosBuildConfigErrors(easConfig)).toEqual([]);
    // Additive profiles (testflight, preview-ios-simulator, ...) may exist; scripts/eas-profiles.test.ts pins their resolved image.
    expect(Object.keys(easConfig.build)).toEqual(expect.arrayContaining(REQUIRED_PROFILES));
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
        development: { ios: { image: "not-a-real-image" } },
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