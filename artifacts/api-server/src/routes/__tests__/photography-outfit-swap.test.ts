import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import fs from "node:fs/promises";

const state = vi.hoisted(() => ({
  calls: [] as string[][],
  prompts: [] as string[],
  failGarment: "",
  qualityFailGarment: "",
  authEnabled: true,
  userId: "outfit-swap-test-user",
}));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: () => void) => {
    if (!state.authEnabled) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    req.auth = { userId: state.userId };
    next();
  },
}));

vi.mock("@workspace/integrations-openai-ai-server/image", () => {
  class MockImageQualityError extends Error {
    reasons: string[];
    constructor(reasons: string[]) {
      super("quality failed");
      this.reasons = reasons;
    }
  }
  return {
    buildFashionPrompt: (operation: string, brief: string, context: string) =>
      `${operation}. ${context} Preserve the exact same model identity, pose, framing, scene continuity, fabric drape, seams, stitching, artwork, and typography. ${brief}`,
    generateWithVisualQa: async (input: { prompt: string; generate: (prompt: string) => Promise<Buffer> }) => {
      const output = await input.generate(input.prompt);
      if (state.qualityFailGarment && output.toString("utf8") === `swap:${state.qualityFailGarment}`) {
        throw new MockImageQualityError(["garment artwork shifted"]);
      }
      return output;
    },
    ImageQualityError: MockImageQualityError,
    ImageQualityUnavailableError: class ImageQualityUnavailableError extends Error {},
    editImages: async (files: string[], prompt: string) => {
      const contents = await Promise.all(files.map(async (file) => (await fs.readFile(file)).subarray(8).toString("utf8")));
      state.calls.push(contents);
      state.prompts.push(prompt);
      if (state.failGarment && contents[1] === state.failGarment) {
        throw new Error("provider failure");
      }
      return Buffer.from(`swap:${contents[1]}`);
    },
  };
});

import photographyRouter from "../photography";

let server: Server;
let base = "";

function dataUrl(value: string) {
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return `data:image/png;base64,${Buffer.concat([pngSignature, Buffer.from(value)]).toString("base64")}`;
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

describe("Outfit Swap batch generation", () => {
  it("requires one locked hero photo and at least one garment", async () => {
    state.calls = [];
    const response = await fetch(`${base}/api/photography/outfit-swap`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        heroImage: dataUrl("locked-hero"),
        garmentImages: [dataUrl("faithful-garment"), dataUrl("wrong-artwork")],
      }),
    });

    expect(response.status).toBe(400);
    expect(state.calls).toEqual([]);
  });

  it("reuses the same hero photo for each garment and preserves input order", async () => {
    state.calls = [];
    state.prompts = [];
    state.failGarment = "";
    state.qualityFailGarment = "";
    const response = await fetch(`${base}/api/photography/outfit-swap`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        heroImage: dataUrl("locked-hero"),
        garmentImages: [dataUrl("faithful-garment"), dataUrl("wrong-artwork")],
      }),
    });

    expect(response.status).toBe(400);
    expect(state.calls).toEqual([]);
  });

  it("reuses the same hero photo for each garment and preserves input order", async () => {
    state.calls = [];
    state.prompts = [];
    state.failGarment = "";
    state.qualityFailGarment = "";
    const response = await fetch(`${base}/api/photography/outfit-swap`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        heroImage: dataUrl("locked-hero"),
        garmentImages: [dataUrl("faithful-garment"), dataUrl("wrong-artwork")],
      }),
    });

    expect(response.status).toBe(400);
    expect(state.calls).toEqual([]);
  });

  it("reuses the same hero photo for each garment and preserves input order", async () => {
    state.calls = [];
    state.prompts = [];
    state.failGarment = "";
    state.qualityFailGarment = "";
    const response = await fetch(`${base}/api/photography/outfit-swap`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        heroImage: dataUrl("locked-hero"),
        garmentImages: [dataUrl("faithful-garment"), dataUrl("wrong-artwork")],
      }),
    });

    expect(response.status).toBe(200);
    const body: any = await response.json();
    expect(state.calls).toEqual([
      ["locked-hero", "first-garment"],
      ["locked-hero", "second-garment"],
    ]);
    expect(body.results).toEqual([
      { garmentIndex: 1, b64_json: Buffer.from("swap:first-garment").toString("base64") },
      { garmentIndex: 2, b64_json: Buffer.from("swap:second-garment").toString("base64") },
    ]);
    expect(state.prompts).toHaveLength(2);
    expect(state.prompts.every((prompt) =>
      prompt.includes("locked base hero photo") &&
      prompt.includes("Preserve the exact same model identity") &&
      prompt.includes("scene continuity") &&
      prompt.includes("fabric drape") &&
      prompt.includes("Keep the scene editorial."),
    )).toBe(true);
  });

  it("does not apply a conflicting process-local generation limit", async () => {
    state.calls = [];
    state.failGarment = "";
    state.qualityFailGarment = "";
    state.userId = "outfit-swap-rate-limit-user";

    const firstBatch = await fetch(`${base}/api/photography/outfit-swap`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        heroImage: dataUrl("locked-hero"),
        garmentImages: [dataUrl("one"), dataUrl("two"), dataUrl("three"), dataUrl("four")],
      }),
    });
    const secondBatch = await fetch(`${base}/api/photography/outfit-swap`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ heroImage: dataUrl("locked-hero"), garmentImages: [dataUrl("five"), dataUrl("six")] }),
    });

    expect(firstBatch.status).toBe(200);
    expect(secondBatch.status).toBe(200);
    state.userId = "outfit-swap-test-user";
  });

  it("returns successful garments alongside safe partial-failure metadata", async () => {
    state.calls = [];
    state.failGarment = "broken-garment";
    state.qualityFailGarment = "";
    const response = await fetch(`${base}/api/photography/outfit-swap`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        heroImage: dataUrl("locked-hero"),
        garmentImages: [dataUrl("faithful-garment"), dataUrl("wrong-artwork")],
      }),
    });

    expect(response.status).toBe(200);
    const body: any = await response.json();
    expect(body.results).toEqual([
      { garmentIndex: 1, b64_json: Buffer.from("swap:good-garment").toString("base64") },
    ]);
    expect(body.errors).toEqual([{ garmentIndex: 2 }]);
  });

  it("preserves garments that pass when another garment fails visual QA", async () => {
    state.calls = [];
    state.failGarment = "";
    state.qualityFailGarment = "wrong-artwork";
    state.userId = "outfit-swap-quality-partial-user";
    const response = await fetch(`${base}/api/photography/outfit-swap`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        heroImage: dataUrl("locked-hero"),
        garmentImages: [dataUrl("faithful-garment"), dataUrl("wrong-artwork")],
      }),
    });

    expect(response.status).toBe(200);
    const body: any = await response.json();
    expect(body.results).toEqual([
      { garmentIndex: 1, b64_json: Buffer.from("swap:faithful-garment").toString("base64") },
    ]);
    expect(body.errors).toEqual([{ garmentIndex: 2 }]);
    expect(body.qualityErrors).toEqual([
      { garmentIndex: 2, reasons: ["garment artwork shifted"] },
    ]);
    state.userId = "outfit-swap-test-user";
  });
});
