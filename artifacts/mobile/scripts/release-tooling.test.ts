import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  resolveDsn,
  resolveEnvironment,
  resolveTracesSampleRate,
  scrubBreadcrumb,
  stripUrlQuery,
} from "../lib/monitoringConfig";

const mobileRoot = path.resolve(__dirname, "..");
const appJson = JSON.parse(readFileSync(path.join(mobileRoot, "app.json"), "utf8"));
const easConfig = JSON.parse(readFileSync(path.join(mobileRoot, "eas.json"), "utf8"));
const packageJson = JSON.parse(readFileSync(path.join(mobileRoot, "package.json"), "utf8"));
const { parseArgs } = require("./eas-update.js") as {
  parseArgs: (argv: string[]) => { options: Record<string, unknown>; errors: string[] };
};
const { quoteForCmd, sentryUploadConfigured } = require("./release-utils.js") as {
  quoteForCmd: (arg: string) => string;
  sentryUploadConfigured: (env: Record<string, string | undefined>) => boolean;
};
const guard = require("../plugins/with-sentry-upload-guard.js") as {
  MARKER: string;
  XCODE_ENV_SNIPPET: string;
  GRADLE_SNIPPET: string;
  appendOnce: (contents: string, snippet: string) => string;
};

describe("over-the-air updates", () => {
  it("only sends an update to builds with the same native fingerprint", () => {
    expect(appJson.expo.runtimeVersion).toEqual({ policy: "fingerprint" });
  });

  it("explicitly disables OTA until Launch has linked the project, retaining its future policy", () => {
    expect(appJson.expo.updates).toMatchObject({ enabled: false, checkAutomatically: "ON_LOAD", fallbackToCacheTimeout: 0 });
  });

  it("maps every build profile to its own update channel", () => {
    expect(easConfig.build.production.channel).toBe("production");
    expect(easConfig.build.preview.channel).toBe("preview");
    expect(easConfig.build.development.channel).toBe("development");
  });

  it("leaves project ownership and linking to Launch instead of fabricating IDs", () => {
    expect(appJson.expo.owner).toBeUndefined();
    expect(appJson.expo.extra.eas?.projectId).toBeUndefined();
    expect(appJson.expo.updates.url).toBeUndefined();
  });

  it("uses only a static config that resolves outside the development workspace", () => {
    expect(existsSync(path.join(mobileRoot, "app.config.js"))).toBe(false);
    expect(existsSync(path.join(mobileRoot, "app.config.ts"))).toBe(false);
    expect(appJson.expo.extra.router.asyncRoutes).toEqual({ web: true, default: false });
  });

  it("does not request signing profiles for disabled native extension targets", () => {
    expect(appJson.expo.extra.eas?.build?.experimental?.ios?.appExtensions).toBeUndefined();
    const gate = appJson.expo.plugins.find((p: any) => Array.isArray(p) && p[0] === "./plugins/with-native-surfaces");
    expect(gate[1].enabled).toBe(false);
    expect(packageJson.expo.autolinking.exclude).toEqual(expect.arrayContaining(["upload-live-activity", "expo-runtime-app-icon"]));
  });

  it("keeps the EAS project fields (updates.url, extra.eas) out of the runtime fingerprint", () => {
    const { SourceSkips, DEFAULT_SOURCE_SKIPS } = require("expo/fingerprint") as {
      SourceSkips: Record<string, number>;
      DEFAULT_SOURCE_SKIPS: number;
    };
    const fingerprintConfig = require("../fingerprint.config.js") as { sourceSkips: number };
    expect(fingerprintConfig.sourceSkips & SourceSkips.ExpoConfigEASProject).toBeTruthy();
    expect(fingerprintConfig.sourceSkips & DEFAULT_SOURCE_SKIPS).toBe(DEFAULT_SOURCE_SKIPS);
    // Nothing else (versions, names, assets, the whole config) is skipped.
    expect(fingerprintConfig.sourceSkips & SourceSkips.ExpoConfigAll).toBe(0);
    expect(fingerprintConfig.sourceSkips & SourceSkips.ExpoConfigExtraSection).toBe(0);
  });

  it("starts monitoring and update checks before Expo Router loads", () => {
    expect(packageJson.main).toBe("index.ts");
    const entry = readFileSync(path.join(mobileRoot, "index.ts"), "utf8");
    expect(entry.indexOf("./lib/bootstrap")).toBeGreaterThan(-1);
    expect(entry.indexOf("./lib/bootstrap")).toBeLessThan(entry.indexOf("expo-router/entry"));
  });
});

describe("eas-update.js arguments", () => {
  it("requires a channel and a message", () => {
    expect(parseArgs([]).errors).toEqual(
      expect.arrayContaining([expect.stringMatching(/--channel/), expect.stringMatching(/--message/)]),
    );
  });

  it("accepts the documented options (with or without pnpm's --)", () => {
    const { options, errors } = parseArgs(["--channel", "production", "--", "-m", "Fix totals", "-p", "ios", "--rollout", "10"]);
    expect(errors).toEqual([]);
    expect(options).toMatchObject({ channel: "production", message: "Fix totals", platform: "ios", rollout: "10" });
  });

  it("rejects bad rollout percentages and unknown platforms", () => {
    expect(parseArgs(["--channel", "preview", "-m", "x", "--rollout", "0"]).errors).toHaveLength(1);
    expect(parseArgs(["--channel", "preview", "-m", "x", "--rollout", "101"]).errors).toHaveLength(1);
    expect(parseArgs(["--channel", "preview", "-m", "x", "-p", "web"]).errors).toHaveLength(1);
  });

  it("quotes Windows shell arguments so messages with spaces survive", () => {
    expect(quoteForCmd("production")).toBe("production");
    expect(quoteForCmd('Fix "sale" badge')).toBe('"Fix ""sale"" badge"');
  });
});

describe("Sentry build configuration", () => {
  it("adds the Sentry Expo plugin without an auth token in config", () => {
    const entry = appJson.expo.plugins.find(
      (plugin: unknown) => Array.isArray(plugin) && plugin[0] === "@sentry/react-native/expo",
    );
    expect(entry).toBeDefined();
    expect(entry[1]).not.toHaveProperty("authToken");
    expect(appJson.expo.plugins).toContain("./plugins/with-sentry-upload-guard");
  });

  it("only uploads when token, org and project are all present", () => {
    expect(sentryUploadConfigured({})).toBe(false);
    expect(sentryUploadConfigured({ SENTRY_AUTH_TOKEN: "t", SENTRY_ORG: "o" })).toBe(false);
    expect(sentryUploadConfigured({ SENTRY_AUTH_TOKEN: " ", SENTRY_ORG: "o", SENTRY_PROJECT: "p" })).toBe(false);
    expect(sentryUploadConfigured({ SENTRY_AUTH_TOKEN: "t", SENTRY_ORG: "o", SENTRY_PROJECT: "p" })).toBe(true);
  });

  it("guards the iOS and Android upload steps, idempotently", () => {
    expect(guard.XCODE_ENV_SNIPPET).toContain("export SENTRY_DISABLE_AUTO_UPLOAD=true");
    expect(guard.GRADLE_SNIPPET).toContain("shouldSentryAutoUploadGeneral");
    for (const name of ["SENTRY_AUTH_TOKEN", "SENTRY_ORG", "SENTRY_PROJECT"]) {
      expect(guard.XCODE_ENV_SNIPPET).toContain(name);
      expect(guard.GRADLE_SNIPPET).toContain(name);
    }
    const once = guard.appendOnce("export NODE_BINARY=node\n", guard.XCODE_ENV_SNIPPET);
    expect(guard.appendOnce(once, guard.XCODE_ENV_SNIPPET)).toBe(once);
    expect(once.split(guard.MARKER)).toHaveLength(2);
  });

  it("stamps bundles with Sentry debug IDs through the Metro config", () => {
    const metro = readFileSync(path.join(mobileRoot, "metro.config.js"), "utf8");
    expect(metro).toContain("getSentryExpoConfig");
  });
});

describe("monitoring configuration", () => {
  it("stays off without a real DSN", () => {
    for (const value of [undefined, "", "REPLACE_WITH_SENTRY_DSN", "your-dsn-here", "$SENTRY_DSN", "https://sentry.io/"]) {
      expect(resolveDsn(value)).toBeNull();
    }
    expect(resolveDsn(" https://key@o1.ingest.sentry.io/123 ")).toBe("https://key@o1.ingest.sentry.io/123");
  });

  it("tags events by environment", () => {
    expect(resolveEnvironment(undefined, "production", false)).toBe("production");
    expect(resolveEnvironment(undefined, "preview", false)).toBe("preview");
    expect(resolveEnvironment(undefined, null, false)).toBe("production");
    expect(resolveEnvironment(undefined, "production", true)).toBe("development");
    expect(resolveEnvironment("staging", "production", false)).toBe("staging");
  });

  it("clamps the trace sample rate", () => {
    expect(resolveTracesSampleRate(undefined)).toBe(0.1);
    expect(resolveTracesSampleRate("abc")).toBe(0.1);
    expect(resolveTracesSampleRate("2")).toBe(1);
    expect(resolveTracesSampleRate("-1")).toBe(0);
    expect(resolveTracesSampleRate("0.25")).toBe(0.25);
  });

  it("drops console breadcrumbs in production and strips query strings", () => {
    expect(scrubBreadcrumb({ category: "console", message: "user@example.com" }, false)).toBeNull();
    expect(scrubBreadcrumb({ category: "console", message: "debug" }, true)).not.toBeNull();
    expect(
      scrubBreadcrumb({ category: "fetch", data: { url: "https://api.example.com/search?q=secret#x", status_code: 200 } }, false),
    ).toEqual({ category: "fetch", data: { url: "https://api.example.com/search", status_code: 200 } });
    expect(stripUrlQuery("/buyer-product-detail?id=1")).toBe("/buyer-product-detail");
  });
});
