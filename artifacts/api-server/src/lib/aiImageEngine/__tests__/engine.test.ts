import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";

const qa = vi.hoisted(() => ({ calls: 0 }));
vi.mock("@workspace/integrations-openai-ai-server/image", () => ({
  editImages: vi.fn(async () => sharp({ create: { width: 8, height: 10, channels: 3, background: "#222" } }).png().toBuffer()),
  generateWithVisualQa: async (input: { prompt: string; generate: (p: string) => Promise<Buffer> }) => {
    qa.calls++;
    return input.generate(input.prompt);
  },
}));

import { activeImageProvider, generateShot, ImageEngineNotConfiguredError, openAiSizeForRatio, parseAspectRatio } from "..";
import { buildFlatPrompt, buildShotDirection } from "../prompts";
import { resolveGeminiConfig } from "../gemini";

const ENV_KEYS = [
  "GEMINI_API_KEY", "GOOGLE_API_KEY", "AI_INTEGRATIONS_GEMINI_API_KEY", "AI_INTEGRATIONS_GEMINI_BASE_URL",
  "GEMINI_IMAGE_MODEL", "GEMINI_IMAGE_MODEL_FALLBACKS", "AI_INTEGRATIONS_OPENAI_API_KEY", "AI_INTEGRATIONS_OPENAI_BASE_URL",
  "OPENAI_API_KEY", "AI_IMAGE_MOCKUP_TO_MODEL_PROVIDER", "AI_IMAGE_AI_PHOTOSHOOT_PROVIDER", "FAL_KEY",
];
let saved: Record<string, string | undefined> = {};
beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  qa.calls = 0;
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.unstubAllGlobals();
});

const photo = (color: string) => sharp({ create: { width: 64, height: 80, channels: 3, background: color } }).jpeg().toBuffer();

describe("provider selection", () => {
  it("prefers Gemini, then OpenAI, and reports nothing when neither key exists", () => {
    expect(activeImageProvider("photoshoot", {})).toBeNull();
    expect(activeImageProvider("photoshoot", { OPENAI_API_KEY: "sk" })).toBe("openai");
    expect(activeImageProvider("photoshoot", { OPENAI_API_KEY: "sk", GEMINI_API_KEY: "g" })).toBe("gemini");
    expect(activeImageProvider("mockup_to_model", { AI_INTEGRATIONS_GEMINI_API_KEY: "g", AI_INTEGRATIONS_GEMINI_BASE_URL: "http://x" })).toBe("gemini");
  });

  it("keeps an explicit non-OpenAI provider override per tool", () => {
    expect(activeImageProvider("mockup_to_model", { GEMINI_API_KEY: "g", AI_IMAGE_MOCKUP_TO_MODEL_PROVIDER: "fal-fashn" })).toBe("env-override");
    expect(activeImageProvider("photoshoot", { GEMINI_API_KEY: "g", AI_IMAGE_MOCKUP_TO_MODEL_PROVIDER: "fal-fashn" })).toBe("gemini");
  });

  it("names GEMINI_API_KEY as the one missing key", async () => {
    const err = await generateShot({ task: "photoshoot", productImages: [await photo("#fff")], referenceImages: [] }).catch((e) => e);
    expect(err).toBeInstanceOf(ImageEngineNotConfiguredError);
    expect(err.missingKey).toBe("GEMINI_API_KEY");
  });

  it("reads the Gemini model chain from env", () => {
    expect(resolveGeminiConfig({ GEMINI_API_KEY: "k" })!.models).toEqual(["gemini-3-pro-image-preview", "gemini-2.5-flash-image"]);
    expect(resolveGeminiConfig({ GEMINI_API_KEY: "k", GEMINI_IMAGE_MODEL: "m1", GEMINI_IMAGE_MODEL_FALLBACKS: "" })!.models).toEqual(["m1"]);
  });
});

describe("prompting standard", () => {
  it("states garment fidelity, photorealism and the anti-AI-look list for both tools", () => {
    for (const task of ["photoshoot", "mockup_to_model"] as const) {
      const text = buildShotDirection({ task, productCount: 1, referenceCount: 1 });
      expect(text).toMatch(/Garment fidelity \(non-negotiable\)/);
      expect(text).toMatch(/no waxy or plastic skin/);
      expect(text).toMatch(/five fingers/);
      expect(text).toMatch(/streetwear/);
      expect(text).toMatch(/Avoid: CGI/);
    }
  });

  it("carries the seller's brief, model, scene, light, ratio and a distinct framing per shot", () => {
    const shot = (i: number) => buildShotDirection({
      task: "photoshoot", productCount: 2, referenceCount: 1, brief: "Rooftop at dusk", modelStyle: "male",
      sceneStyle: "street", lightingStyle: "golden_hour", aspectRatio: "9:16", shotIndex: i, shotCount: 4,
    });
    const first = shot(0);
    expect(first).toContain("<brief>Rooftop at dusk</brief>");
    expect(first).toContain("a male model");
    expect(first).toContain("a real city street");
    expect(first).toContain("golden-hour sun");
    expect(first).toContain("9:16 aspect ratio");
    expect(first).toContain("shot 1 of a 4-shot set: Full-length");
    expect(shot(2)).toContain("shot 3 of a 4-shot set: Waist-up");
  });

  it("labels each image by role in the flat (OpenAI) prompt", () => {
    const text = buildFlatPrompt({ task: "photoshoot", productCount: 2, referenceCount: 1 });
    expect(text).toMatch(/Image 1 — PRODUCT PHOTO 1 of 2/);
    expect(text).toMatch(/Image 2 — PRODUCT PHOTO 2 of 2/);
    expect(text).toMatch(/Image 3 — CREATIVE REFERENCE 1 of 1: art direction only/);
  });

  it("parses only supported aspect ratios and maps them to OpenAI canvases", () => {
    expect(parseAspectRatio("4:5")).toBe("4:5");
    expect(parseAspectRatio("7:3")).toBeUndefined();
    expect(openAiSizeForRatio("9:16")).toBe("1024x1536");
    expect(openAiSizeForRatio("1:1")).toBe("1024x1024");
    expect(openAiSizeForRatio("16:9")).toBe("1536x1024");
  });
});

describe("Gemini request", () => {
  it("sends labelled product then reference images, the ratio and 2K size, and returns a JPEG", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    const out = await sharp({ create: { width: 40, height: 50, channels: 3, background: "#808080" } }).png().toBuffer();
    const requests: Array<{ url: string; body: any; headers: Record<string, string> }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      requests.push({ url, body: JSON.parse(String(init.body)), headers: init.headers as Record<string, string> });
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: out.toString("base64") } }] } }] }));
    }));

    const shot = await generateShot({
      task: "photoshoot", productImages: [await photo("#f00"), await photo("#0f0")], referenceImages: [await photo("#00f")],
      brief: "Night market", aspectRatio: "4:5",
    });

    expect(shot.provider).toBe("gemini");
    expect(shot.model).toBe("gemini-3-pro-image-preview");
    expect(shot.mime).toBe("image/jpeg");
    expect((await sharp(shot.image).metadata()).format).toBe("jpeg");
    expect(qa.calls).toBe(0); // no OpenAI key -> no visual QA pass

    expect(requests).toHaveLength(1);
    const { url, body, headers } = requests[0]!;
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent");
    expect(headers["x-goog-api-key"]).toBe("test-key");
    expect(body.generationConfig).toEqual({ responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "4:5", imageSize: "2K" } });
    const parts = body.contents[0].parts;
    expect(parts.map((p: any) => (p.text ? p.text.slice(0, 22) : "IMG"))).toEqual([
      "PRODUCT PHOTO 1 of 2: ", "IMG", "PRODUCT PHOTO 2 of 2: ", "IMG", "CREATIVE REFERENCE 1 o", "IMG", "Task: create one finis",
    ]);
    expect(parts[6].text).toContain("<brief>Night market</brief>");
  });

  it("falls back to the next model when the first is unknown, and runs visual QA when OpenAI is configured", async () => {
    process.env.GEMINI_API_KEY = "k";
    process.env.OPENAI_API_KEY = "sk";
    const out = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#000" } }).png().toBuffer();
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      urls.push(url);
      if (url.includes("gemini-3-pro")) return new Response('{"error":{"message":"models/gemini-3-pro-image-preview is not found"}}', { status: 404 });
      expect(JSON.parse(String(init.body)).generationConfig.imageConfig).toEqual({ aspectRatio: "1:1" }); // flash: no imageSize
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { data: out.toString("base64") } }] } }] }));
    }));
    const shot = await generateShot({ task: "mockup_to_model", productImages: [await photo("#fff")], referenceImages: [await photo("#333")], aspectRatio: "1:1" });
    expect(shot.model).toBe("gemini-2.5-flash-image");
    expect(urls).toHaveLength(2);
    expect(qa.calls).toBe(1);
  });

  it("reports a safety block as a blocked GeminiImageError", async () => {
    process.env.GEMINI_API_KEY = "k";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ candidates: [{ finishReason: "IMAGE_SAFETY", content: { parts: [] } }] }))));
    const err = await generateShot({ task: "photoshoot", productImages: [await photo("#fff")], referenceImages: [] }).catch((e) => e);
    expect(err.name).toBe("GeminiImageError");
    expect(err.kind).toBe("blocked");
  });
});
