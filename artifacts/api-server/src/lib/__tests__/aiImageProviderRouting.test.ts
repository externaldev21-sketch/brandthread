import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AiProviderNotConfiguredError,
  resolveToolGenerator,
} from "../aiImageProviders/routing";

const ENV_KEYS = [
  "AI_IMAGE_MOCKUP_TO_MODEL_PROVIDER",
  "AI_IMAGE_MOCKUP_TO_MODEL_PIPELINE",
  "AI_IMAGE_MOCKUP_TO_MODEL_SCENE_PROVIDER",
  "AI_IMAGE_AI_PHOTOSHOOT_PROVIDER",
  "FAL_KEY",
  "FASHN_API_KEY",
];

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function clearEnv() {
  for (const key of ENV_KEYS) vi.stubEnv(key, "");
}

describe("resolveToolGenerator", () => {
  it("keeps the existing OpenAI path when no provider is selected, even if keys are set", () => {
    clearEnv();
    vi.stubEnv("FAL_KEY", "fal-test");
    vi.stubEnv("FASHN_API_KEY", "fashn-test");
    expect(resolveToolGenerator("mockup-to-model")).toBeNull();
    expect(resolveToolGenerator("ai-photoshoot")).toBeNull();
  });

  it("fails with an actionable message when fal is selected without FAL_KEY", () => {
    clearEnv();
    vi.stubEnv("AI_IMAGE_MOCKUP_TO_MODEL_PROVIDER", "fal-fashn");
    let error: unknown;
    try {
      resolveToolGenerator("mockup-to-model");
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(AiProviderNotConfiguredError);
    expect((error as Error).message).toContain("FAL_KEY");
    expect((error as Error).message).toContain("AI_IMAGE_MOCKUP_TO_MODEL_PROVIDER");
  });

  it("fails with an actionable message when fashn-direct is selected without FASHN_API_KEY", () => {
    clearEnv();
    vi.stubEnv("AI_IMAGE_AI_PHOTOSHOOT_PROVIDER", "fashn-direct");
    expect(() => resolveToolGenerator("ai-photoshoot")).toThrow(/FASHN_API_KEY/);
  });

  it("routes Mockup to Model through fal.ai when selected and FAL_KEY is set", async () => {
    clearEnv();
    vi.stubEnv("AI_IMAGE_MOCKUP_TO_MODEL_PROVIDER", "fal-fashn");
    vi.stubEnv("FAL_KEY", "fal-test");
    const fetchMock = vi.fn(async (url: string) => {
      if (url.startsWith("https://fal.run/")) {
        return new Response(JSON.stringify({ images: [{ url: "https://cdn.example/out.png" }] }), { status: 200 });
      }
      return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const generator = resolveToolGenerator("mockup-to-model");
    expect(generator).not.toBeNull();
    const png = "data:image/png;base64,iVBORw0KGgo=";
    const result = await generator!({ productImages: [png], referenceImages: [png], prompt: "p" });

    expect(result.providerId).toBe("fal-fashn");
    expect(result.imageBuffer.equals(Buffer.from([1, 2, 3]))).toBe(true);
    const [falUrl, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(falUrl).toMatch(/^https:\/\/fal\.run\/fal-ai\/fashn/);
    expect((init.headers as Record<string, string>).Authorization).toBe("Key fal-test");
  });
});
