/**
 * The server must boot without the Replit-only AI env: the shared OpenAI
 * package may not throw at import, accepts a standard OPENAI_API_KEY, and a
 * call without any key fails with a clear error instead of crashing boot.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_OPENAI_BASE_URL,
  OpenAiNotConfiguredError,
  isOpenAiConfigured,
  resolveOpenAiConfig,
} from "@workspace/integrations-openai-ai-server/config";
import { mediaModerationStatus, reportMediaModerationAtBoot } from "../mediaModeration";
import { missingRecommended } from "../env";

const KEYS = [
  "AI_INTEGRATIONS_OPENAI_API_KEY",
  "AI_INTEGRATIONS_OPENAI_BASE_URL",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "MEDIA_MODERATION_ENABLED",
] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("resolveOpenAiConfig", () => {
  it("is null with no AI env", () => {
    expect(new OpenAiNotConfiguredError().code).toBe("OPENAI_NOT_CONFIGURED");
    expect(resolveOpenAiConfig({})).toBeNull();
    expect(isOpenAiConfigured({})).toBe(false);
  });

  it("uses the Replit integration pair when both are set", () => {
    expect(resolveOpenAiConfig({
      AI_INTEGRATIONS_OPENAI_API_KEY: "rk",
      AI_INTEGRATIONS_OPENAI_BASE_URL: "https://replit.ai/v1",
      OPENAI_API_KEY: "sk",
    })).toEqual({ apiKey: "rk", baseURL: "https://replit.ai/v1", source: "replit_integration" });
  });

  it("accepts a standard OPENAI_API_KEY with the default base URL", () => {
    expect(resolveOpenAiConfig({ OPENAI_API_KEY: " sk " })).toEqual({
      apiKey: "sk", baseURL: DEFAULT_OPENAI_BASE_URL, source: "openai_api_key",
    });
    expect(resolveOpenAiConfig({ OPENAI_API_KEY: "sk", OPENAI_BASE_URL: "https://proxy.test/v1" })?.baseURL)
      .toBe("https://proxy.test/v1");
  });

  it("falls back to OPENAI_API_KEY when only half of the Replit pair is set", () => {
    expect(resolveOpenAiConfig({ AI_INTEGRATIONS_OPENAI_API_KEY: "rk" })).toBeNull();
    expect(resolveOpenAiConfig({ AI_INTEGRATIONS_OPENAI_API_KEY: "rk", OPENAI_API_KEY: "sk" })?.source)
      .toBe("openai_api_key");
  });
});

describe("lazy client", () => {
  it("imports every entry point with no AI env and throws a clear error only on use", async () => {
    vi.resetModules();
    const root = await import("@workspace/integrations-openai-ai-server");
    await import("@workspace/integrations-openai-ai-server/text");
    await import("@workspace/integrations-openai-ai-server/image");
    await import("@workspace/integrations-openai-ai-server/audio");
    expect(() => root.openai.chat).toThrow(root.OpenAiNotConfiguredError);
    expect(() => root.openai.chat).toThrow(/OPENAI_API_KEY/);
    const { generateText } = await import("@workspace/integrations-openai-ai-server/text");
    await expect(generateText("s", "u")).rejects.toMatchObject({ code: "OPENAI_NOT_CONFIGURED" });
  });

  it("creates the client on first use once a key is present", async () => {
    vi.resetModules();
    const { openai } = await import("@workspace/integrations-openai-ai-server");
    process.env.OPENAI_API_KEY = "sk-test";
    expect(openai.baseURL).toBe(DEFAULT_OPENAI_BASE_URL);
    expect(typeof openai.chat.completions.create).toBe("function");
  });
});

describe("media moderation in production", () => {
  it("is on with a standard OPENAI_API_KEY", () => {
    expect(mediaModerationStatus({ OPENAI_API_KEY: "sk" } as NodeJS.ProcessEnv)).toEqual({ enabled: true, reason: null });
  });

  it("reports why it is off", () => {
    expect(mediaModerationStatus({} as NodeJS.ProcessEnv).reason).toBe("no_provider");
    expect(mediaModerationStatus({ OPENAI_API_KEY: "sk", MEDIA_MODERATION_ENABLED: "off" } as NodeJS.ProcessEnv).reason)
      .toBe("kill_switch");
  });

  it("logs at error level at boot only in production when off", () => {
    const log = { error: vi.fn(), info: vi.fn() };
    expect(reportMediaModerationAtBoot({ NODE_ENV: "production" } as NodeJS.ProcessEnv, log as never)).toBe(true);
    expect(log.error).toHaveBeenCalledTimes(1);
    expect(String(log.error.mock.calls[0][1])).toMatch(/OFF in production/);

    log.error.mockClear();
    expect(reportMediaModerationAtBoot({ NODE_ENV: "development" } as NodeJS.ProcessEnv, log as never)).toBe(false);
    expect(reportMediaModerationAtBoot({ NODE_ENV: "production", OPENAI_API_KEY: "sk" } as NodeJS.ProcessEnv, log as never)).toBe(false);
    expect(log.error).not.toHaveBeenCalled();
  });
});

describe("env classification", () => {
  it("flags missing Sentry DSN and AI provider as recommended, never required", () => {
    const names = missingRecommended({} as NodeJS.ProcessEnv).map((c) => c.name);
    expect(names).toContain("SENTRY_DSN");
    expect(names.some((n) => n.startsWith("OPENAI_API_KEY"))).toBe(true);
    expect(missingRecommended({
      SENTRY_DSN: "https://abc@o1.ingest.sentry.io/123",
      OPENAI_API_KEY: "sk",
    } as NodeJS.ProcessEnv)).toEqual([]);
    // A placeholder DSN does not count.
    expect(missingRecommended({ SENTRY_DSN: "REPLACE_WITH_DSN", OPENAI_API_KEY: "sk" } as NodeJS.ProcessEnv).map((c) => c.name))
      .toEqual(["SENTRY_DSN"]);
  });
});
