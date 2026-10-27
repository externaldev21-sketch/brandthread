/**
 * POST /api/photography/generate (AI Photoshoot) against the shared image
 * engine's boundary: product photos and creative references arrive labelled
 * and separate, the seller's ratio/brief/style choices reach the engine, the
 * caps match the app's pickers, and a missing image key is a 503 naming it.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const state = vi.hoisted(() => ({
  shots: [] as Array<Record<string, unknown> & { productImages: Buffer[]; referenceImages: Buffer[] }>,
  notConfigured: false,
}));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: () => void) => {
    req.auth = { userId: "photoshoot-ratio-test-user" };
    next();
  },
}));

vi.mock("@workspace/integrations-openai-ai-server/image", () => ({
  buildFashionPrompt: (_op: string, brief: string) => brief,
  generateWithVisualQa: async () => Buffer.from(""),
  editImages: async () => Buffer.from(""),
  ImageQualityError: class ImageQualityError extends Error {},
  ImageQualityUnavailableError: class ImageQualityUnavailableError extends Error {},
}));

vi.mock("../../lib/aiImageEngine", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/aiImageEngine")>();
  return {
    ...actual,
    generateShot: async (input: any) => {
      if (state.notConfigured) throw new actual.ImageEngineNotConfiguredError();
      state.shots.push(input);
      return { image: Buffer.from("shot"), mime: "image/jpeg", provider: "gemini", model: "gemini-test" };
    },
  };
});

import photographyRouter, { photoshootSizeForRatio } from "../photography";

let server: Server;
let base = "";

function pngDataUrl(label = "product") {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return `data:image/png;base64,${Buffer.concat([sig, Buffer.from(label)]).toString("base64")}`;
}
const text = (b: Buffer) => b.subarray(8).toString("utf8");

async function generate(body: object) {
  return fetch(`${base}/api/photography/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  const app = express();
  app.use(express.json({ limit: "30mb" }));
  app.use("/api/photography", photographyRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  state.shots = [];
  state.notConfigured = false;
});

describe("photoshootSizeForRatio", () => {
  it("maps square, portrait and landscape ratios to supported edit sizes", () => {
    expect(photoshootSizeForRatio("1:1")).toBe("1024x1024");
    expect(photoshootSizeForRatio("4:5")).toBe("1024x1536");
    expect(photoshootSizeForRatio("9:16")).toBe("1024x1536");
    expect(photoshootSizeForRatio("16:9")).toBe("1536x1024");
  });

  it("ignores missing or malformed ratios", () => {
    expect(photoshootSizeForRatio(undefined)).toBeUndefined();
    expect(photoshootSizeForRatio("square")).toBeUndefined();
    expect(photoshootSizeForRatio("0:5")).toBeUndefined();
    expect(photoshootSizeForRatio(45)).toBeUndefined();
  });
});

describe("POST /api/photography/generate", () => {
  it("sends product photos and creative references to the engine as separate, labelled inputs", async () => {
    const res = await generate({
      productImages: [pngDataUrl("tee-front"), pngDataUrl("tee-back")],
      referenceImages: [pngDataUrl("rooftop-ref")],
      prompt: "Golden-hour rooftop, editorial",
      ratio: "9:16",
      modelStyle: "female",
      sceneStyle: "street",
      lightingStyle: "golden_hour",
      shotIndex: 1,
      shotCount: 4,
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.mime).toBe("image/jpeg");
    expect(Buffer.from(body.b64_json, "base64").toString()).toBe("shot");
    expect(state.shots).toHaveLength(1);
    const shot = state.shots[0]!;
    expect(shot.task).toBe("photoshoot");
    expect(shot.productImages.map(text)).toEqual(["tee-front", "tee-back"]);
    expect(shot.referenceImages.map(text)).toEqual(["rooftop-ref"]);
    expect(shot).toMatchObject({
      brief: "Golden-hour rooftop, editorial",
      aspectRatio: "9:16",
      modelStyle: "female",
      sceneStyle: "street",
      lightingStyle: "golden_hour",
      shotIndex: 1,
      shotCount: 4,
    });
  });

  it("honours every ratio chip the app offers", async () => {
    for (const ratio of ["1:1", "4:5", "9:16"]) {
      await generate({ productImages: [pngDataUrl()], ratio });
    }
    expect(state.shots.map((s) => s.aspectRatio)).toEqual(["1:1", "4:5", "9:16"]);
  });

  it("drops an unknown ratio or style instead of passing it through", async () => {
    await generate({ productImages: [pngDataUrl()], ratio: "7:3", sceneStyle: "<script>" });
    expect(state.shots[0]!.aspectRatio).toBeUndefined();
    expect(state.shots[0]!.sceneStyle).toBeUndefined();
  });

  it("still accepts the legacy { images } body as product photos", async () => {
    const res = await generate({ images: [pngDataUrl("legacy")], prompt: "studio" });
    expect(res.status).toBe(200);
    expect(state.shots[0]!.productImages.map(text)).toEqual(["legacy"]);
    expect(state.shots[0]!.referenceImages).toEqual([]);
  });

  it("allows 4 product photos plus 6 references, and refuses more of either", async () => {
    const ok = await generate({ productImages: Array.from({ length: 4 }, () => pngDataUrl()), referenceImages: Array.from({ length: 6 }, () => pngDataUrl("r")) });
    expect(ok.status).toBe(200);
    const tooManyRefs = await generate({ productImages: [pngDataUrl()], referenceImages: Array.from({ length: 7 }, () => pngDataUrl("r")) });
    expect(tooManyRefs.status).toBe(400);
    const tooManyProducts = await generate({ productImages: Array.from({ length: 5 }, () => pngDataUrl()) });
    expect(tooManyProducts.status).toBe(400);
    expect(state.shots).toHaveLength(1);
  });

  it("requires at least one product photo", async () => {
    const res = await generate({ referenceImages: [pngDataUrl("r")] });
    expect(res.status).toBe(400);
    expect(state.shots).toHaveLength(0);
  });

  it("answers 503 with the missing key name when no image model is configured", async () => {
    state.notConfigured = true;
    const res = await generate({ productImages: [pngDataUrl()] });
    expect(res.status).toBe(503);
    const body = await res.json() as any;
    expect(body).toMatchObject({ code: "ai_image_engine_not_configured", missingKey: "GEMINI_API_KEY", retryable: false });
  });
});
