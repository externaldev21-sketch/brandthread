import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const state = vi.hoisted(() => ({
  executeResults: [] as Array<{ rows: unknown[] }>,
  blocked: false,
  viewer: null as string | null,
}));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: unknown, next: () => void) => {
    req.clerkUserId = "viewer-1";
    next();
  },
  requirePlan: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("@workspace/db", () => ({
  db: { execute: async () => state.executeResults.shift() ?? { rows: [] } },
}));

vi.mock("../../lib/safety", () => ({
  isBlockedEitherWay: async () => state.blocked,
  optionalViewerId: () => state.viewer,
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

const STREAM_ID = "6f1c2f0e-8a54-4d2b-9f7e-1d2c3b4a5e6f";

let server: Server;
let base = "";

async function call(path: string, method = "GET", body?: unknown) {
  const response = await fetch(`${base}/api/live${path}`, {
    method,
    headers: { "content-type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json() as any };
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/live", liveRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  state.executeResults = [];
  state.blocked = false;
  state.viewer = "viewer-1";
});

describe("live block checks", () => {
  it("refuses a chat comment when the commenter and host are blocked", async () => {
    state.blocked = true;
    state.executeResults = [
      { rows: [{ display_name: "V", brand_name: null, profile_image_url: null }] }, // viewer profile
      { rows: [{ seller_id: "host-1" }] }, // stream host
    ];
    const res = await call(`/${STREAM_ID}/comment`, "POST", { message: "hello" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("BLOCKED");
  });

  it("posts a chat comment when not blocked", async () => {
    state.executeResults = [
      { rows: [{ display_name: "V", brand_name: null, profile_image_url: null }] },
      { rows: [{ seller_id: "host-1" }] },
      { rows: [{ id: "c1", message: "hello" }] }, // insert
    ];
    const res = await call(`/${STREAM_ID}/comment`, "POST", { message: "hello" });
    expect(res.status).toBe(201);
  });

  it("hides the stream from a viewer who is blocked with the host", async () => {
    state.blocked = true;
    state.executeResults = [{ rows: [{ id: STREAM_ID, seller_id: "host-1", status: "live" }] }];
    const res = await call(`/${STREAM_ID}`);
    expect(res.status).toBe(404);
  });

  it("shows the stream to an unblocked viewer", async () => {
    state.executeResults = [{ rows: [{ id: STREAM_ID, seller_id: "host-1", status: "live" }] }];
    const res = await call(`/${STREAM_ID}`);
    expect(res.status).toBe(200);
    expect(res.body.stream.id).toBe(STREAM_ID);
  });

  it("refuses to join a live when blocked with the host", async () => {
    state.blocked = true;
    state.executeResults = [{ rows: [{ id: STREAM_ID, seller_id: "host-1", channel_name: "c", status: "live" }] }];
    const res = await call(`/${STREAM_ID}/join`, "POST");
    expect(res.status).toBe(404);
  });
});
