import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const state = vi.hoisted(() => ({
  editCalls: [] as Array<{ files: number; options: unknown }>,
}));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: () => void) => {
    req.auth = { userId: "photoshoot-ratio-test-user" };
    next();
  },
}));

vi.mock("@workspace/integrations-openai-ai-server/image", () => ({
  buildFashionPrompt: (_op: string, brief: string) => brief,
  generateWithVisualQa: async (input: { prompt: string; generate: (prompt: string) => Promise<Buffer> }) =>
    input.generate(input.prompt),
  ImageQualityError: class ImageQualityError extends Error {},
  ImageQualityUnavailableError: class ImageQualityUnavailableError extends Error {},
  editImages: async (files: string[], _prompt: string, _out?: string, options?: unknown) => {
    state.editCalls.push({ files: files.length, options });
    return Buffer.from("shot");
  },
}));

import photographyRouter, { photoshootSizeForRatio } from "../photography";

let server: Server;
let base = "";

function pngDataUrl() {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return `data:image/png;base64,${Buffer.concat([sig, Buffer.from("product")]).toString("base64")}`;
}

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
  state.editCalls = [];
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

describe("POST /api/photography/generate ratio", () => {
  it("passes the ratio's output size to the image edit call", async () => {
    const res = await generate({ images: [pngDataUrl()], prompt: "studio", ratio: "9:16" });
    expect(res.status).toBe(200);
    expect(state.editCalls).toHaveLength(1);
    expect(state.editCalls[0].options).toEqual({ size: "1024x1536" });
  });

  it("keeps the provider default size when no ratio is sent", async () => {
    const res = await generate({ images: [pngDataUrl()], prompt: "studio" });
    expect(res.status).toBe(200);
    expect(state.editCalls[0].options).toBeUndefined();
  });

  it("still rejects more than 4 images in total", async () => {
    const res = await generate({ images: Array.from({ length: 5 }, pngDataUrl), ratio: "1:1" });
    expect(res.status).toBe(400);
    expect(state.editCalls).toHaveLength(0);
  });
});
