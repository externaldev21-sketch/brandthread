import { afterEach, describe, expect, it, vi } from "vitest";
import { publishOfficialStarterPost } from "../../../routes/posts";

afterEach(() => vi.unstubAllEnvs());

describe("trusted starter import environment boundary", () => {
  it("cannot publish through the trusted importer in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(publishOfficialStarterPost({}, "https://example.invalid"))
      .rejects.toThrow("only in development");
  });

  it("cannot run in a deployment even when NODE_ENV is incorrectly development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("REPLIT_DEPLOYMENT", "1");
    await expect(publishOfficialStarterPost({}, "https://example.invalid"))
      .rejects.toThrow("only in development");
  });
});
