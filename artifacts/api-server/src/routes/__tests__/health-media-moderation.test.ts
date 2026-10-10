import { describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({ pool: { query: async () => ({ rows: [] }) } }));
vi.mock("../../lib/redis", () => ({ redisStatus: () => "disabled" }));

describe("readiness media moderation check", () => {
  it("marks production without screening as degraded (never unready)", async () => {
    const { mediaModerationCheck } = await import("../health");
    expect(mediaModerationCheck({ NODE_ENV: "production" } as NodeJS.ProcessEnv)).toEqual({
      status: "off", reason: "no_provider", degraded: true,
    });
    expect(mediaModerationCheck({ NODE_ENV: "development" } as NodeJS.ProcessEnv).degraded).toBe(false);
    expect(mediaModerationCheck({ NODE_ENV: "production", OPENAI_API_KEY: "sk" } as NodeJS.ProcessEnv)).toEqual({
      status: "on", reason: null, degraded: false,
    });
  });
});
