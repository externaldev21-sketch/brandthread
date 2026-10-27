/**
 * POST /api/bg-removal/remove: the seller's photo goes to the self-hosted
 * segmenter (lib/bgRemoval), the cutout PNG comes back with its id/size, and
 * it is also stored under the caller's own bg-removal/<userId>/ prefix.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const state = vi.hoisted(() => {
  process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID = "bucket-test";
  process.env.PRIVATE_OBJECT_DIR = "/bucket-test/.private";
  return {
    saved: [] as Array<{ bucket: string; name: string; bytes: number }>,
    coverage: 0.4,
    fail: false,
  };
});

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: () => void) => {
    req.clerkUserId = "user_bg_test";
    next();
  },
}));

vi.mock("../../lib/objectStorage", () => ({
  objectStorageClient: {
    bucket: (bucket: string) => ({
      file: (name: string) => ({
        save: async (buffer: Buffer) => { state.saved.push({ bucket, name, bytes: buffer.length }); },
        exists: async () => [false],
      }),
    }),
  },
}));

vi.mock("../../lib/bgRemoval", () => ({
  removeBackground: async () => {
    if (state.fail) throw new Error("worker exited");
    return { png: Buffer.from("cutout-png"), width: 640, height: 800, coverage: state.coverage, model: "birefnet-general-lite" };
  },
}));

import bgRemovalRouter from "../bg-removal";

let server: Server;
let base = "";
const jpeg = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).toString("base64")}`;
const remove = (image: string) =>
  fetch(`${base}/api/bg-removal/remove`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ image }) });

beforeAll(async () => {
  const app = express();
  app.use(express.json({ limit: "20mb" }));
  app.use("/api/bg-removal", bgRemovalRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });
beforeEach(() => { state.saved = []; state.coverage = 0.4; state.fail = false; });

describe("POST /api/bg-removal/remove", () => {
  it("returns the cutout PNG and stores it under the caller's own prefix", async () => {
    const res = await remove(jpeg);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(Buffer.from(body.b64_json, "base64").toString()).toBe("cutout-png");
    expect(body).toMatchObject({ mime: "image/png", width: 640, height: 800, size: 10 });
    expect(body.storageKey).toBe(`.private/bg-removal/user_bg_test/${body.id}.png`);
    expect(state.saved).toEqual([{ bucket: "bucket-test", name: body.storageKey, bytes: 10 }]);
  });

  it("answers 422 when no subject was found instead of returning an empty cutout", async () => {
    state.coverage = 0;
    const res = await remove(jpeg);
    expect(res.status).toBe(422);
    expect(state.saved).toEqual([]);
  });

  it("answers a retryable 502 when the segmenter fails", async () => {
    state.fail = true;
    const res = await remove(jpeg);
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ retryable: true });
  });

  it("rejects non-images before running the model", async () => {
    const res = await remove("data:image/gif;base64,R0lGOD");
    expect(res.status).toBe(400);
  });
});
