import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const mobileRoot = path.resolve(__dirname, "..");
const packageJson = JSON.parse(readFileSync(path.join(mobileRoot, "package.json"), "utf8"));
const easJsonPath = path.join(mobileRoot, "eas.json");

const launch = require("./verify-launch-config.js") as {
  STORE_PROFILES: string[];
  isUsableDsn: (raw: unknown) => boolean;
  profileFromArgs: (argv: string[], env: Record<string, string | undefined>) => string | null;
  resolveExpoConfig: (env: Record<string, string | undefined>) => Record<string, any>;
  getLaunchConfigProblems: (input: {
    profile: string | null;
    env: Record<string, string | undefined>;
    expoConfig?: Record<string, any>;
  }) => { store: boolean; errors: string[]; warnings: string[] };
};
const submit = require("./eas-submit.js") as {
  submitArgs: (passthrough: string[]) => string[];
  withIosSubmitValues: (text: string, values: Record<string, string>) => string;
  submitWithValues: (
    values: Record<string, string>,
    passthrough: string[],
    env: Record<string, string | undefined>,
    runImpl: (cmd: string, args: string[], options: { env: Record<string, string | undefined> }) => number,
  ) => number;
};

const DSN = "https://publickey@o123.ingest.sentry.io/456";

describe("store build gate (verify-launch-config)", () => {
  it("runs in eas-build-pre-install for every EAS build", () => {
    expect(packageJson.scripts["eas-build-pre-install"]).toContain("node scripts/verify-launch-config.js");
    expect(launch.STORE_PROFILES).toEqual(["production", "testflight"]);
  });

  it("reads the profile from EAS_BUILD_PROFILE or --profile", () => {
    expect(launch.profileFromArgs([], { EAS_BUILD_PROFILE: "testflight" })).toBe("testflight");
    expect(launch.profileFromArgs(["--profile", "production"], {})).toBe("production");
    expect(launch.profileFromArgs([], {})).toBeNull();
  });

  it("accepts only a real DSN", () => {
    expect(launch.isUsableDsn(DSN)).toBe(true);
    for (const bad of [undefined, "", "REPLACE_WITH_DSN", "not a url", "https://o1.ingest.sentry.io/1", "https://key@o1.ingest.sentry.io/"]) {
      expect(launch.isUsableDsn(bad)).toBe(false);
    }
  });

  it("resolves the update URL from app.json or EAS_PROJECT_ID, like EAS does", () => {
    expect(launch.resolveExpoConfig({}).updates.url).toBeUndefined();
    expect(launch.resolveExpoConfig({ EAS_PROJECT_ID: "p-1" }).updates.url).toBe("https://u.expo.dev/p-1");
  });

  it("fails production and testflight builds without a DSN or update URL", () => {
    for (const profile of ["production", "testflight"]) {
      const result = launch.getLaunchConfigProblems({ profile, env: {} });
      expect(result.store).toBe(true);
      expect(result.errors).toHaveLength(2);
      expect(result.errors[0]).toMatch(/EXPO_PUBLIC_SENTRY_DSN/);
      expect(result.errors[0]).toMatch(/Client Keys \(DSN\)/);
      expect(result.errors[1]).toMatch(/eas init/);
    }
    expect(launch.getLaunchConfigProblems({ profile: "production", env: { EXPO_PUBLIC_SENTRY_DSN: DSN } }).errors).toHaveLength(1);
    expect(launch.getLaunchConfigProblems({
      profile: "production",
      env: { EXPO_PUBLIC_SENTRY_DSN: DSN, EAS_PROJECT_ID: "p-1" },
    }).errors).toEqual([]);
  });

  it("only warns for development, preview and staging builds", () => {
    for (const profile of ["development", "preview", "staging", null]) {
      const result = launch.getLaunchConfigProblems({ profile, env: {} });
      expect(result.errors).toEqual([]);
      expect(result.warnings).toHaveLength(2);
    }
  });
});

describe("eas-submit (App Store values from the environment)", () => {
  it("submits the latest build unless one is chosen", () => {
    expect(submit.submitArgs([])).toEqual(["submit", "--platform", "ios", "--profile", "production", "--latest"]);
    expect(submit.submitArgs(["--id", "abc"])).toEqual(["submit", "--platform", "ios", "--profile", "production", "--id", "abc"]);
    expect(submit.submitArgs(["--path=build.ipa"])).not.toContain("--latest");
  });

  it("fills submit.production.ios without touching the rest of eas.json", () => {
    const original = readFileSync(easJsonPath, "utf8");
    const patched = JSON.parse(submit.withIosSubmitValues(original, { appleId: "a@b.co", ascAppId: "1", appleTeamId: "ABCDEFGHIJ" }));
    const base = JSON.parse(original);
    expect(patched.submit.production.ios).toEqual({ appleId: "a@b.co", ascAppId: "1", appleTeamId: "ABCDEFGHIJ" });
    expect(patched.build).toEqual(base.build);
    expect(patched.submit.production.android).toEqual(base.submit.production.android);
  });

  it("writes the values only for the eas submit call and restores eas.json, even when it fails", () => {
    const original = readFileSync(easJsonPath, "utf8");
    const values = { appleId: "a@b.co", ascAppId: "123", appleTeamId: "ABCDEFGHIJ" };
    const seen: Array<{ ios: unknown; env: Record<string, string | undefined> }> = [];
    const runImpl = vi.fn((_cmd: string, _args: string[], options: { env: Record<string, string | undefined> }) => {
      seen.push({ ios: JSON.parse(readFileSync(easJsonPath, "utf8")).submit.production.ios, env: options.env });
      return 1;
    });
    expect(submit.submitWithValues(values, [], {}, runImpl)).toBe(1);
    expect(seen[0].ios).toEqual(values);
    expect(seen[0].env.EXPO_APPLE_ID).toBe("a@b.co");
    expect(seen[0].env.EXPO_APPLE_TEAM_ID).toBe("ABCDEFGHIJ");
    expect(readFileSync(easJsonPath, "utf8")).toBe(original);

    expect(() => submit.submitWithValues(values, [], {}, () => { throw new Error("spawn failed"); })).toThrow("spawn failed");
    expect(readFileSync(easJsonPath, "utf8")).toBe(original);
  });
});
