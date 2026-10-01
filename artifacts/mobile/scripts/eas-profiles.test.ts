import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const easConfig = JSON.parse(readFileSync(path.resolve(__dirname, "..", "eas.json"), "utf8"));
const { build } = easConfig;

describe("additive EAS build profiles", () => {
  it("keeps the original development, preview and production profiles intact", () => {
    expect(build.production).toEqual({
      distribution: "store",
      environment: "production",
      channel: "production",
      ios: { image: "macos-sequoia-15.6-xcode-26.0", autoIncrement: "buildNumber" },
      android: { buildType: "app-bundle", autoIncrement: "versionCode" },
    });
    expect(build.preview.distribution).toBe("internal");
    expect(build.preview.android.buildType).toBe("apk");
    expect(build.development.channel).toBe("development");
  });

  it("testflight is a store build with auto-incrementing build numbers on its own channel", () => {
    expect(build.testflight).toMatchObject({ extends: "production", distribution: "store", channel: "testflight" });
    expect(build.testflight.ios.autoIncrement).toBe("buildNumber");
  });

  it("preview-ios-simulator builds for the simulator from the preview profile", () => {
    expect(build["preview-ios-simulator"]).toEqual({ extends: "preview", ios: { image: "macos-sequoia-15.6-xcode-26.0", simulator: true } });
  });

  it("production-apk is sideloadable and never burns a Play versionCode", () => {
    expect(build["production-apk"]).toMatchObject({
      extends: "production",
      distribution: "internal",
      android: { buildType: "apk", autoIncrement: false },
    });
  });

  it("only extends profiles that exist, so eas-cli can resolve them", () => {
    for (const [name, profile] of Object.entries<any>(build)) {
      if (profile.extends) expect(build[profile.extends], `${name} extends ${profile.extends}`).toBeDefined();
    }
  });
});
