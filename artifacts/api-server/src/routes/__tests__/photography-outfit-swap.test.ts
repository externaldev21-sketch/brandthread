import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import fs from "node:fs/promises";

const state = vi.hoisted(() => ({
  calls: [] as string[][],
  failGarment: "",
}));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: unknown, next: () => void) => {
    req.auth = { userId: "outfit-swap-test-user" };
    next();
  },
}));

vi.mock("@workspace/integrations-openai-ai-server/image", () => ({
  editImages: async (files: string[]) => {
    const contents = await Promise.all(files.map(async (file) => (await fs.readFile(file)).subarray(8).toString("utf8")));
    state.calls.push(contents);
    if (state.failGarment && contents[1] === state.failGarment) {
      throw new Error("provider failure");
    }
    return Buffer.from(`swap:${contents[1]}`);
  },
}));

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
      body: JSON.stringify({ garmentImages: [dataUrl("shirt")] }),
    });

    expect(response.status).toBe(400);
    expect(state.calls).toEqual([]);
  });

  it("rejects a declared image that does not contain valid image bytes", async () => {
    state.calls = [];
    const response = await fetch(`${base}/api/photography/outfit-swap`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        heroImage: `data:image/png;base64,${Buffer.from("not-a-png").toString("base64")}`,
        garmentImages: [dataUrl("shirt")],
      }),
    });

    expect(response.status).toBe(400);
    expect(state.calls).toEqual([]);
  });

  it("reuses the same hero photo for each garment and preserves input order", async () => {
    state.calls = [];
    state.failGarment = "";
    const response = await fetch(`${base}/api/photography/outfit-swap`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        heroImage: dataUrl("locked-hero"),
        garmentImages: [dataUrl("first-garment"), dataUrl("second-garment")],
        prompt: "Keep the scene editorial.",
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
  });

  it("returns successful garments alongside safe partial-failure metadata", async () => {
    state.calls = [];
    state.failGarment = "broken-garment";
    const response = await fetch(`${base}/api/photography/outfit-swap`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        heroImage: dataUrl("locked-hero"),
        garmentImages: [dataUrl("good-garment"), dataUrl("broken-garment")],
      }),
    });

    expect(response.status).toBe(200);
    const body: any = await response.json();
    expect(body.results).toEqual([
      { garmentIndex: 1, b64_json: Buffer.from("swap:good-garment").toString("base64") },
    ]);
    expect(body.errors).toEqual([{ garmentIndex: 2 }]);
  });
});