import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const state = vi.hoisted(() => ({ rows: [] as any[], queries: [] as string[] }));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: unknown, next: () => void) => {
    req.clerkUserId = "seller-1";
    next();
  },
  requirePlan: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../../lib/ageGate", () => ({ denyIfAgeRestricted: async () => false }));
vi.mock("@workspace/db", () => ({
  db: {
    execute: async (query: any) => {
      const chunks = query?.queryChunks ?? [];
      state.queries.push(chunks.map((c: any) => (Array.isArray(c?.value) ? c.value.join("") : "")).join(""));
      return { rows: state.rows };
    },
  },
}));
vi.mock("../../lib/safety", () => ({
  isBlockedEitherWay: async () => false,
  optionalViewerId: () => null,
  publishingRestriction: async () => null,
}));
vi.mock("../../lib/contentModerator", () => ({ evaluateContent: () => ({ action: "allow" }) }));
vi.mock("../../lib/liveReplay", () => ({
  beginCloudRecording: async () => undefined,
  stopCloudRecordingAndMaybeFinalize: async () => ({ postId: null }),
}));
vi.mock("../../lib/liveFeed", () => ({ rankLiveFeed: (rows: unknown[]) => rows }));
vi.mock("../../ws/liveHub", () => ({ broadcastToRoom: () => undefined }));

import liveRouter from "../live";

let server: Server;
let base = "";

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/live", liveRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  state.rows = [];
  state.queries = [];
});

const STREAM_ID = "00000000-0000-4000-8000-000000000001";

describe("GET /api/live/:id/summary", () => {
  it("returns the host's post-show numbers from the stream's own rows", async () => {
    state.rows = [{
      id: STREAM_ID,
      title: "Friday drop",
      status: "ended",
      started_at: "2026-10-17T18:00:00.000Z",
      ended_at: "2026-10-17T18:42:30.000Z",
      peak_viewer_count: 37,
      product_tags: [{ productId: "p1" }, { productId: "p2" }],
      total_viewers: 112,
      comment_count: 58,
    }];
    const res = await fetch(`${base}/api/live/${STREAM_ID}/summary`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      summary: {
        id: STREAM_ID,
        title: "Friday drop",
        status: "ended",
        durationSeconds: 2550,
        peakViewers: 37,
        totalViewers: 112,
        comments: 58,
        productsShown: 2,
      },
    });
    // Scoped to the signed-in host, so nobody else can read the numbers.
    expect(state.queries[0]).toContain("s.seller_id =");
  });

  it("404s when the stream is not the caller's", async () => {
    const res = await fetch(`${base}/api/live/${STREAM_ID}/summary`);
    expect(res.status).toBe(404);
  });
});
