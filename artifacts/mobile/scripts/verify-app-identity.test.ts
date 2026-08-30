import { describe, expect, it } from "vitest";

const { EXPECTED_APP_ID, getIdentityErrors } = require("./verify-app-identity.js") as {
  EXPECTED_APP_ID: string;
  getIdentityErrors: (config: unknown) => string[];
};

const withVerifyAppIdentity = require("../plugins/with-verify-app-identity.js") as (
  config: unknown,
) => unknown;

const validExpoConfig = {
  ios: { bundleIdentifier: EXPECTED_APP_ID },
  android: { package: EXPECTED_APP_ID },
};

describe("native app identity verification", () => {
  it("accepts the stable iOS and Android identifiers", () => {
    expect(getIdentityErrors(validExpoConfig)).toEqual([]);
    expect(withVerifyAppIdentity(validExpoConfig)).toBe(validExpoConfig);
  });

  it("reports both missing and changed identifiers", () => {
    const errors = getIdentityErrors({
      ios: { bundleIdentifier: "com.brandthread.changed" },
      android: {},
    });

    expect(errors).toEqual([
      `iOS bundleIdentifier is "com.brandthread.changed", but the stable store identity is "${EXPECTED_APP_ID}"`,
      `Android package is missing; it must remain "${EXPECTED_APP_ID}"`,
    ]);
  });

  it("rejects drift when Expo runs config plugins during native prebuild", () => {
    expect(() =>
      withVerifyAppIdentity({
        ios: { bundleIdentifier: "com.brandthread.changed" },
        android: { package: EXPECTED_APP_ID },
      }),
    ).toThrow(/App identity verification failed before the native build/);
  });
});