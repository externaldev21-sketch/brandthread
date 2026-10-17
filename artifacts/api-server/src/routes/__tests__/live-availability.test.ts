import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: unknown, next: () => void) => {
    req.clerkUserId = "seller-1";
    next();
  },
  requirePlan: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../../lib/ageGate", () => ({ denyIfAgeRestricted: async () => false }));
vi.mock("@workspace/db", () => ({ db: { execute: async () => ({ rows: [] }) } }));
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
import {
  REPLAY_RECORDING_ENV_VARS, liveAvailability, missingReplayRecordingEnv,
} from "../../lib/liveAvailability";

const ENV_KEYS = [...REPLAY_RECORDING_ENV_VARS, "AGORA_APP_CERTIFICATE"];
const saved: Record<string, string | undefined> = {};
for (const key of ENV_KEYS) saved[key] = process.env[key];

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

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

function clearAgoraEnv() {
  for (const key of ENV_KEYS) delete process.env[key];
}

describe("live availability", () => {
  it("GET /status reports both streaming and replays as not configured without Agora env", async () => {
    clearAgoraEnv();
    const res = await fetch(`${base}/api/live/status`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      streaming: { available: false, code: "LIVE_NOT_CONFIGURED" },
      replays: { available: false, code: "REPLAYS_NOT_CONFIGURED" },
    });
  });

  it("treats the .env.example placeholder as unset", () => {
    expect(liveAvailability({ AGORA_APP_ID: "replace_me" } as NodeJS.ProcessEnv).streaming.available).toBe(false);
  });

  it("streaming works with just the app id; replays need all 7 recording vars", () => {
    const env = { AGORA_APP_ID: "app" } as NodeJS.ProcessEnv;
    expect(liveAvailability(env)).toEqual({
      streaming: { available: true, code: null },
      replays: { available: false, code: "REPLAYS_NOT_CONFIGURED" },
    });
    expect(missingReplayRecordingEnv(env)).toHaveLength(6);
    const full = Object.fromEntries(REPLAY_RECORDING_ENV_VARS.map((k) => [k, "x"])) as NodeJS.ProcessEnv;
    expect(liveAvailability(full).replays).toEqual({ available: true, code: null });
  });

  it("POST /start answers a structured LIVE_NOT_CONFIGURED error, never the env var name", async () => {
    clearAgoraEnv();
    const res = await fetch(`${base}/api/live/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Drop day" }),
    });
    expect(res.status).toBe(503);
    const body = await res.json() as any;
    expect(body.code).toBe("LIVE_NOT_CONFIGURED");
    expect(body.error).toMatch(/isn't set up yet/);
    expect(JSON.stringify(body)).not.toContain("AGORA");
  });
});
