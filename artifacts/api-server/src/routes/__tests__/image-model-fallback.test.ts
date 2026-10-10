import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const provider = vi.hoisted(() => ({
  generate: vi.fn(),
  edit: vi.fn(),
}));

vi.mock("openai", () => ({
  default: class OpenAI {
    images = { generate: provider.generate, edit: provider.edit };
  },
  toFile: vi.fn(async () => ({ name: "reference.png" })),
}));

import {
  editImages, generateImageBuffer, getImageModelChain, isModelUnavailableError, withImageModelFallback,
} from "@workspace/integrations-openai-ai-server/image";

const ok = (text: string) => ({ data: [{ b64_json: Buffer.from(text).toString("base64") }] });
const modelGone = (model: string) =>
  Object.assign(new Error(`The model \`${model}\` does not exist or you do not have access to it.`), { status: 404, code: "model_not_found" });

describe("image model config", () => {
  afterEach(() => {
    delete process.env.OPENAI_IMAGE_MODEL;
    delete process.env.OPENAI_IMAGE_MODEL_FALLBACKS;
  });

  it("defaults to the current GA model with older models as fallbacks", () => {
    expect(getImageModelChain({})).toEqual(["gpt-image-2", "gpt-image-1.5", "gpt-image-1"]);
  });

  it("reads OPENAI_IMAGE_MODEL and OPENAI_IMAGE_MODEL_FALLBACKS", () => {
    expect(getImageModelChain({ OPENAI_IMAGE_MODEL: "gpt-image-3", OPENAI_IMAGE_MODEL_FALLBACKS: " gpt-image-2 , ,gpt-image-3" }))
      .toEqual(["gpt-image-3", "gpt-image-2"]);
    expect(getImageModelChain({ OPENAI_IMAGE_MODEL: " ", OPENAI_IMAGE_MODEL_FALLBACKS: "" })).toEqual(["gpt-image-2"]);
  });

  it("recognises only model-unavailable provider errors", () => {
    expect(isModelUnavailableError(modelGone("gpt-image-1"))).toBe(true);
    expect(isModelUnavailableError({ status: 400, message: "The model gpt-image-1 has been deprecated." })).toBe(true);
    expect(isModelUnavailableError({ status: 404, error: { code: "model_not_found" } })).toBe(true);
    expect(isModelUnavailableError({ status: 400, message: "Your request was rejected by the safety system." })).toBe(false);
    expect(isModelUnavailableError({ status: 429, message: "Rate limit reached for model gpt-image-2" })).toBe(false);
    expect(isModelUnavailableError({ status: 500, message: "model not found" })).toBe(false);
    expect(isModelUnavailableError(new Error("socket hang up"))).toBe(false);
  });
});

describe("shared image client fallback", () => {
  let tmpDir = "";

  beforeEach(async () => {
    provider.generate.mockReset();
    provider.edit.mockReset();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "image-model-fallback-"));
  });

  afterEach(async () => {
    delete process.env.OPENAI_IMAGE_MODEL;
    delete process.env.OPENAI_IMAGE_MODEL_FALLBACKS;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("uses OPENAI_IMAGE_MODEL for generations", async () => {
    process.env.OPENAI_IMAGE_MODEL = "gpt-image-1.5";
    provider.generate.mockResolvedValue(ok("generated"));
    await generateImageBuffer("logo");
    expect(provider.generate).toHaveBeenCalledTimes(1);
    expect(provider.generate.mock.calls[0]![0]).toMatchObject({ model: "gpt-image-1.5", quality: "high" });
  });

  it("falls back to the next model when the provider retires the primary", async () => {
    process.env.OPENAI_IMAGE_MODEL = "gpt-image-1";
    process.env.OPENAI_IMAGE_MODEL_FALLBACKS = "gpt-image-2";
    provider.generate.mockImplementation(async ({ model }: { model: string }) => {
      if (model === "gpt-image-1") throw modelGone(model);
      return ok(`from ${model}`);
    });
    const out = await generateImageBuffer("logo");
    expect(out.toString()).toBe("from gpt-image-2");
    expect(provider.generate.mock.calls.map((c) => c[0].model)).toEqual(["gpt-image-1", "gpt-image-2"]);
  });

  it("falls back for edits too, keeping the edit options", async () => {
    process.env.OPENAI_IMAGE_MODEL = "retired-model";
    process.env.OPENAI_IMAGE_MODEL_FALLBACKS = "gpt-image-2";
    const source = path.join(tmpDir, "source.png");
    await fs.writeFile(source, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    provider.edit.mockImplementation(async ({ model }: { model: string }) => {
      if (model === "retired-model") throw { status: 400, message: "The model retired-model has been retired." };
      return ok("edited");
    });
    await editImages([source], "remove background", undefined, { background: "transparent" });
    expect(provider.edit.mock.calls.map((c) => c[0])).toEqual([
      expect.objectContaining({ model: "retired-model", background: "transparent" }),
      expect.objectContaining({ model: "gpt-image-2", background: "transparent", quality: "high" }),
    ]);
  });

  it("does not retry other models on content or rate-limit errors", async () => {
    const policy = { status: 400, message: "Your request was rejected by the safety system." };
    provider.generate.mockRejectedValue(policy);
    await expect(generateImageBuffer("logo")).rejects.toBe(policy);
    expect(provider.generate).toHaveBeenCalledTimes(1);
  });

  it("throws the last error when every model is gone", async () => {
    process.env.OPENAI_IMAGE_MODEL = "a";
    process.env.OPENAI_IMAGE_MODEL_FALLBACKS = "b";
    provider.generate.mockImplementation(async ({ model }: { model: string }) => { throw modelGone(model); });
    await expect(generateImageBuffer("logo")).rejects.toThrow(/`b` does not exist/);
    expect(provider.generate).toHaveBeenCalledTimes(2);
  });

  it("reports each fallback", async () => {
    const seen: string[] = [];
    const out = await withImageModelFallback(async (m) => { if (m !== "z") throw modelGone(m); return m; }, {
      models: ["x", "y", "z"], onFallback: (from, to) => seen.push(`${from}->${to}`),
    });
    expect(out).toBe("z");
    expect(seen).toEqual(["x->y", "y->z"]);
  });
});
