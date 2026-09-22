import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const mobileRoot = path.resolve(__dirname, "..");
const appConfig = JSON.parse(readFileSync(path.join(mobileRoot, "app.json"), "utf8")).expo;
const easConfig = JSON.parse(readFileSync(path.join(mobileRoot, "eas.json"), "utf8"));
const packageJson = JSON.parse(readFileSync(path.join(mobileRoot, "package.json"), "utf8"));
const { getSubmitConfigErrors, PLACEHOLDER_PREFIX } = require("./verify-submit-config.js") as {
  getSubmitConfigErrors: (config: unknown) => string[];
  PLACEHOLDER_PREFIX: string;
};

type PluginEntry = string | [string, Record<string, unknown>];

function pluginOptions(name: string): Record<string, unknown> {
  const entry = (appConfig.plugins as PluginEntry[]).find(
    (plugin) => (Array.isArray(plugin) ? plugin[0] : plugin) === name,
  );
  expect(entry, `${name} must be configured in app.json plugins`).toBeDefined();
  expect(Array.isArray(entry), `${name} must set explicit permission strings`).toBe(true);
  return (entry as [string, Record<string, unknown>])[1];
}

describe("App Store identity and appearance", () => {
  it("uses the brandthread slug without changing the store identity", () => {
    expect(appConfig.slug).toBe("brandthread");
    expect(appConfig.name).toBe("Brandthread");
    expect(appConfig.ios.bundleIdentifier).toBe("com.brandthread.mobile");
    expect(appConfig.android.package).toBe("com.brandthread.mobile");
  });

  it("forces dark system UI (keyboard, alerts, pickers)", () => {
    expect(appConfig.userInterfaceStyle).toBe("dark");
    expect(appConfig.ios.userInterfaceStyle ?? "dark").toBe("dark");
    expect(appConfig.android.userInterfaceStyle ?? "dark").toBe("dark");
    // Android reads userInterfaceStyle through expo-system-ui.
    expect({ ...packageJson.dependencies, ...packageJson.devDependencies }).toHaveProperty("expo-system-ui");
  });

  it("ships on iPad from the first release", () => {
    expect(appConfig.ios.supportsTablet).toBe(true);
  });

  it("answers export compliance up front (HTTPS/TLS only, no custom encryption)", () => {
    expect(appConfig.ios.config.usesNonExemptEncryption).toBe(false);
  });
});

describe("permission purpose strings", () => {
  const strings: Array<[string, string, string]> = [
    ["expo-camera", "cameraPermission", "camera"],
    ["expo-camera", "microphonePermission", "microphone"],
    ["expo-audio", "microphonePermission", "microphone"],
    ["expo-image-picker", "cameraPermission", "camera"],
    ["expo-image-picker", "microphonePermission", "microphone"],
    ["expo-image-picker", "photosPermission", "photo library"],
    ["expo-media-library", "photosPermission", "photo library"],
    ["expo-media-library", "savePhotosPermission", "library"],
    ["expo-local-authentication", "faceIDPermission", "Face ID"],
  ];

  it.each(strings)("%s %s is specific and user-facing", (plugin, key, subject) => {
    const value = pluginOptions(plugin)[key];
    expect(typeof value).toBe("string");
    expect(value).toMatch(/^Brandthread /);
    expect(value).toContain(subject);
    expect(value).not.toContain("$(PRODUCT_NAME)");
    expect((value as string).length).toBeGreaterThan(60);
  });

  it("uses one wording per iOS permission so plugin order cannot change the prompt", () => {
    const camera = new Set(["expo-camera", "expo-image-picker"].map((p) => pluginOptions(p).cameraPermission));
    const mic = new Set(["expo-camera", "expo-audio", "expo-image-picker"].map((p) => pluginOptions(p).microphonePermission));
    const photos = new Set(["expo-media-library", "expo-image-picker"].map((p) => pluginOptions(p).photosPermission));
    expect([camera.size, mic.size, photos.size]).toEqual([1, 1, 1]);
  });

  it("does not read media-library location metadata or audio files", () => {
    const media = pluginOptions("expo-media-library");
    expect(media.isAccessMediaLocationEnabled).toBe(false);
    expect(media.granularPermissions).toEqual(["photo", "video"]);
  });

  it("blocks the unused Android draw-over-other-apps permission", () => {
    expect(appConfig.android.blockedPermissions).toContain("android.permission.SYSTEM_ALERT_WINDOW");
  });

  it("does not ship location, contacts, or tracking modules without a purpose", () => {
    const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
    for (const name of ["expo-location", "expo-contacts", "expo-tracking-transparency"]) {
      expect(deps, `${name} needs a purpose string and privacy-label review before it is added`).not.toHaveProperty(name);
    }
  });
});

describe("EAS production build and submit profiles", () => {
  it("auto-increments store build numbers remotely", () => {
    expect(easConfig.cli.appVersionSource).toBe("remote");
    const production = easConfig.build.production;
    expect(production.distribution).toBe("store");
    expect(production.ios.autoIncrement).toBe("buildNumber");
    expect(production.android.autoIncrement).toBe("versionCode");
    expect(production.android.buildType).toBe("app-bundle");
  });

  it("defines iOS and Android production submit profiles", () => {
    const submit = easConfig.submit.production;
    for (const key of ["appleId", "ascAppId", "appleTeamId"]) {
      expect(typeof submit.ios[key]).toBe("string");
    }
    expect(submit.android.track).toBe("internal");
  });

  it("refuses to submit until the Apple placeholders are replaced with valid values", () => {
    const withIos = (ios: Record<string, string>) => ({
      submit: { production: { ios, android: { track: "internal" } } },
    });
    expect(getSubmitConfigErrors(withIos({
      appleId: `${PLACEHOLDER_PREFIX}APPLE_ID_EMAIL`,
      ascAppId: `${PLACEHOLDER_PREFIX}APP_STORE_CONNECT_APP_ID`,
      appleTeamId: `${PLACEHOLDER_PREFIX}APPLE_TEAM_ID`,
    }))).toHaveLength(3);
    expect(getSubmitConfigErrors(withIos({
      appleId: "owner@example.com",
      ascAppId: "app-id",
      appleTeamId: "short",
    }))).toHaveLength(2);
    expect(getSubmitConfigErrors(withIos({
      appleId: "owner@example.com",
      ascAppId: "1234567891",
      appleTeamId: "AB32CZE81F",
    }))).toEqual([]);
  });
});
