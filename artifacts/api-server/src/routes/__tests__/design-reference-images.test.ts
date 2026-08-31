import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import fs from "node:fs/promises";

const state = vi.hoisted(() => ({
  editCalls: [] as Array<{ contents: string[]; prompt: string; options?: unknown }>,
  generationCalls: [] as string[],
}));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: () => void) => {
    req.auth = { userId: "design-reference-test-user" };
    next();
  },
}));

vi.mock("../../lib/objectStorage", () => ({
  objectStorageClient: {
    bucket: () => ({
      file: () => ({
        save: async () => {},
        exists: async () => [false],
        createReadStream: () => null,
      }),
    }),
  },
}));

vi.mock("@workspace/integrations-openai-ai-server/image", () => ({
  buildFashionPrompt: (operation: string, brief: string, context: string) =>
    `${operation}. ${context} Keep the foreground subject or product exactly as supplied. Use Image 2 as the new background when requested. Fabric drape, seams, stitching, artwork, and typography must remain faithful. ${brief}`,
  generateWithVisualQa: async (input: { prompt: string; generate: (prompt: string) => Promise<Buffer> }) =>
    input.generate(input.prompt),
  ImageQualityError: class ImageQualityError extends Error {
    reasons: string[] = [];
  },
  ImageQualityUnavailableError: class ImageQualityUnavailableError extends Error {},
  generateImageBuffer: async (prompt: string) => {
    state.generationCalls.push(prompt);
    return Buffer.from("generated");
  },
  editImages: async (files: string[], prompt: string, _size?: unknown, options?: unknown) => {
    const contents = await Promise.all(
      files.map(async (file) => (await fs.readFile(file)).subarray(8).toString("utf8")),
    );
    state.editCalls.push({ contents, prompt, options });
    return Buffer.from("edited");
  },
}));

import mockupRouter from "../mockup";
import bgRemovalRouter from "../bg-removal";

let server: Server;
let base = "";

function dataUrl(value: string) {
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return `data:image/png;base64,${Buffer.concat([pngSignature, Buffer.from(value)]).toString("base64")}`;
}

beforeAll(async () => {
  const app = express();
  app.use(express.json({ limit: "30mb" }));
  app.use("/api/mockup", mockupRouter);
  app.use("/api/bg-removal", bgRemovalRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("Design reference image routes", () => {
  it("uses editImages with the supplied sketch or source design", async () => {
    state.editCalls = [];
    state.generationCalls = [];
    const response = await fetch(`${base}/api/mockup/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prompt: "Turn this sketch into a polished hoodie.",
        referenceImage: dataUrl("specific-sketch"),
      }),
    });

    expect(response.status).toBe(200);
    expect(state.editCalls).toHaveLength(1);
    expect(state.editCalls[0].contents).toEqual(["specific-sketch"]);
    expect(state.editCalls[0].prompt).toContain("authoritative source design");
    expect(state.generationCalls).toEqual([]);
  });

  it("keeps text-only mockups on image generation", async () => {
    state.editCalls = [];
    state.generationCalls = [];
    const response = await fetch(`${base}/api/mockup/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "A minimal black hoodie." }),
    });

    expect(response.status).toBe(200);
    expect(state.generationCalls).toHaveLength(1);
    expect(state.editCalls).toEqual([]);
  });

  it("passes both the source and uploaded replacement background in order", async () => {
    state.editCalls = [];
    const response = await fetch(`${base}/api/bg-removal/replace`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        image: dataUrl("locked-product"),
        backgroundImage: dataUrl("new-background"),
        bgType: "upload",
      }),
    });

    expect(response.status).toBe(200);
    expect(state.editCalls).toHaveLength(1);
    expect(state.editCalls[0].contents).toEqual(["locked-product", "new-background"]);
    expect(state.editCalls[0].prompt).toContain("Use Image 2 as the new background");
    expect(state.editCalls[0].prompt).toContain("Keep the foreground subject or product exactly");
  });

  it("uses transparent image editing for background removal", async () => {
    state.editCalls = [];
    const response = await fetch(`${base}/api/bg-removal/remove`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ image: dataUrl("remove-me") }),
    });

    expect(response.status).toBe(200);
    expect(state.editCalls).toHaveLength(1);
    expect(state.editCalls[0].contents).toEqual(["remove-me"]);
    expect(state.editCalls[0].options).toEqual({ background: "transparent" });
  });

  it("rejects HEIC before it can be mislabeled for the image provider", async () => {
    state.editCalls = [];
    const response = await fetch(`${base}/api/bg-removal/remove`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        image: `data:image/heic;base64,${Buffer.from("unsupported-heic").toString("base64")}`,
      }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining("PNG, JPG, JPEG, or WebP"),
    });
    expect(state.editCalls).toEqual([]);
  });
});