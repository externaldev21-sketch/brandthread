/**
 * GET/PUT /api/seller/cancel-window (migration 272): only the listed hours
 * or null ("until shipped") are stored; everything else is a 400 and never
 * reaches the database.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const state = vi.hoisted(() => ({
  stored: null as number | null,
  exists: true,
  writes: [] as Array<Record<string, unknown>>,
}));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: () => void) => { req.clerkUserId = "seller-1"; next(); },
}));
vi.mock("../../lib/objectStorage", () => ({ ObjectStorageService: class {} }));
vi.mock("../../lib/mediaModeration", () => ({ MEDIA_REJECTED_MESSAGE: "", screenImageBuffer: async () => ({ ok: true }) }));
vi.mock("../../lib/productImageResize", () => ({ normalizeUploadedImage: async () => ({}) }));
vi.mock("@workspace/db", () => {
  const table = () => new Proxy({}, { get: (_t, key) => String(key) });
  return {
    users: table(), orders: table(), posts: table(), interactions: table(),
    db: {
      execute: async () => ({ rows: [] }),
      select: () => ({
        from: () => ({
          where: () => ({ limit: async () => (state.exists ? [{ hours: state.stored }] : []) }),
        }),
      }),
      update: () => ({
        set: (values: Record<string, unknown>) => ({
          where: () => ({
            returning: async () => {
              if (!state.exists) return [];
              state.writes.push(values);
              state.stored = values.buyerCancelWindowHours as number | null;
              return [{ hours: state.stored }];
            },
          }),
        }),
      }),
    },
  };
});

import sellerProfileRouter from "../seller-profile";

let server: Server;
let base = "";

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/seller", sellerProfileRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  state.stored = null;
  state.exists = true;
  state.writes = [];
});

function put(body: unknown) {
  return fetch(`${base}/api/seller/cancel-window`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("seller cancel window", () => {
  it("reads null (the default) until the seller picks a window", async () => {
    const res = await fetch(`${base}/api/seller/cancel-window`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ hours: null, options: [1, 12, 24, 72] });
  });

  it("saves each listed window and clears back to the default", async () => {
    for (const hours of [1, 12, 24, 72, null]) {
      const res = await put({ hours });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ hours });
    }
    expect(state.writes.map((w) => w.buyerCancelWindowHours)).toEqual([1, 12, 24, 72, null]);
  });

  it("rejects values outside the list without writing", async () => {
    for (const hours of [0, 2, -1, 1.5, 504, "24", true]) {
      const res = await put({ hours });
      expect(res.status).toBe(400);
    }
    expect((await put({})).status).toBe(400);
    expect(state.writes).toEqual([]);
  });

  it("is a 404 when the seller row is missing", async () => {
    state.exists = false;
    expect((await fetch(`${base}/api/seller/cancel-window`)).status).toBe(404);
    expect((await put({ hours: 24 })).status).toBe(404);
  });
});
