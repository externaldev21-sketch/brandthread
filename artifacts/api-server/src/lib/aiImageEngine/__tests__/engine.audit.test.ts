/**
 * Audit B08: a provider override that config.ts does not recognise (a typo such
 * as "fal_fashn") is ignored by resolveToolGenerator, so the engine must not
 * route to "env-override" for it (that crashed with "generator is not a
 * function" after the seller had already been charged).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";

vi.mock("@workspace/integrations-openai-ai-server/image", () => ({
  editImages: vi.fn(),
  generateWithVisualQa: async (input: { prompt: string; generate: (p: string) => Promise<Buffer> }) => input.generate(input.prompt),
}));

import { activeImageProvider, generateShot } from "..";

const ENV_KEYS = ["GEMINI_API_KEY", "GOOGLE_API_KEY", "AI_INTEGRATIONS_GEMINI_API_KEY", "AI_INTEGRATIONS_GEMINI_BASE_URL",
  "AI_INTEGRATIONS_OPENAI_API_KEY", "AI_INTEGRATIONS_OPENAI_BASE_URL", "OPENAI_API_KEY",
  "AI_IMAGE_AI_PHOTOSHOOT_PROVIDER", "AI_IMAGE_MOCKUP_TO_MODEL_PROVIDER", "GEMINI_IMAGE_MODEL", "GEMINI_IMAGE_MODEL_FALLBACKS"];
let saved: Record<string, string | undefined> = {};
beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.unstubAllGlobals();
});

describe("unknown provider override (audit)", () => {
  it("is ignored by provider selection, like config.ts ignores it", () => {
    expect(activeImageProvider("photoshoot", { GEMINI_API_KEY: "g", AI_IMAGE_AI_PHOTOSHOOT_PROVIDER: "fal_fashn" })).toBe("gemini");
    expect(activeImageProvider("photoshoot", { OPENAI_API_KEY: "sk", AI_IMAGE_AI_PHOTOSHOOT_PROVIDER: "nope" })).toBe("openai");
    expect(activeImageProvider("photoshoot", { GEMINI_API_KEY: "g", AI_IMAGE_AI_PHOTOSHOOT_PROVIDER: "fal-qwen" })).toBe("env-override");
  });

  it("still generates a shot through the preferred engine", async () => {
    process.env.GEMINI_API_KEY = "k";
    process.env.AI_IMAGE_AI_PHOTOSHOOT_PROVIDER = "fal_fashn";
    const out = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#000" } }).png().toBuffer();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ inlineData: { data: out.toString("base64") } }] } }],
    }))));
    const photo = await sharp({ create: { width: 16, height: 16, channels: 3, background: "#fff" } }).jpeg().toBuffer();
    const shot = await generateShot({ task: "photoshoot", productImages: [photo], referenceImages: [] });
    expect(shot.provider).toBe("gemini");
  });
});
