import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const provider = vi.hoisted(() => ({
  generate: vi.fn(async () => ({ data: [{ b64_json: Buffer.from("generated").toString("base64") }] })),
  edit: vi.fn(async () => ({ data: [{ b64_json: Buffer.from("edited").toString("base64") }] })),
}));

vi.mock("openai", () => ({
  default: class OpenAI {
    images = { generate: provider.generate, edit: provider.edit };
  },
  toFile: vi.fn(async () => ({ name: "reference.png" })),
}));

import { editImages, generateImageBuffer } from "@workspace/integrations-openai-ai-server/image";

describe("premium provider contract", () => {
  let tmpDir = "";

  beforeEach(async () => {
    provider.generate.mockClear();
    provider.edit.mockClear();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "image-quality-provider-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("requests high quality for image generation by default", async () => {
    await generateImageBuffer("premium fashion logo", "1024x1024");
    expect(provider.generate).toHaveBeenCalledWith(expect.objectContaining({
      model: "gpt-image-1",
      quality: "high",
      size: "1024x1024",
    }));
  });

  it("requests high quality for edits while preserving transparent backgrounds", async () => {
    const source = path.join(tmpDir, "source.png");
    await fs.writeFile(source, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    await editImages([source], "remove background", undefined, { background: "transparent" });
    expect(provider.edit).toHaveBeenCalledWith(expect.objectContaining({
      model: "gpt-image-1",
      quality: "high",
      background: "transparent",
    }));
  });
});