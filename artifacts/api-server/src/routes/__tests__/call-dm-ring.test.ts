import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const state = vi.hoisted(() => ({
  userId: "caller-user",
  participants: [] as Array<{ userId: string; name: string; initials: string; color: string }>,
  published: [] as Array<Record<string, unknown>>,
}));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: unknown, next: () => void) => {
    req.clerkUserId = state.userId;
    req.log = { error: () => undefined };
    next();
  },
}));

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => conditions,
  eq: (...values: unknown[]) => values,
}));

vi.mock("@workspace/db", () => {
  const table = (name: string) => new Proxy({ name }, {
    get: (target, key) => key in target ? target[key as keyof typeof target] : String(key),
  });
  return {
    db: {
      select: () => ({
        from: () => ({
          where: async () => state.participants,
        }),
      }),
    },
    conversationParticipants: table("conversationParticipants"),
    manufacturerActivityEvents: table("manufacturerActivityEvents"),
    manufacturers: table("manufacturers"),
    manufacturerThreads: table("manufacturerThreads"),
  };
});

vi.mock("../notifications-feed", () => ({
  publishNotification: async (n: Record<string, unknown>) => { state.published.push(n); },
}));

import callRouter, { buildDmRingNotifications } from "../call";

let server: Server;
let base = "";
const originalEnv = { ...process.env };

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/call", callRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  process.env = originalEnv;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function ring(body: unknown) {
  return fetch(`${base}/api/call/dm/ring`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("buildDmRingNotifications", () => {
  const participants = [
    { userId: "caller-user", name: "Ava Stone", initials: "AS", color: "#111111" },
    { userId: "callee-user", name: "Maison Vela", initials: "MV", color: "#222222" },
  ];

  it("notifies only the other participants, naming the caller and the mode", () => {
    const out = buildDmRingNotifications("caller-user", "conv-1", "video", participants);
    expect(out).toEqual([expect.objectContaining({
      userId: "callee-user",
      type: "dm_call_video",
      targetType: "dm_call",
      targetId: "conv-1",
      actorId: "caller-user",
      body: "Ava Stone is calling you",
    })]);
  });

  it("returns null when the caller is not in the conversation", () => {
    expect(buildDmRingNotifications("stranger", "conv-1", "voice", participants)).toBeNull();
  });
});

describe("POST /api/call/dm/ring", () => {
  beforeEach(() => {
    state.userId = "caller-user";
    state.published = [];
    state.participants = [
      { userId: "caller-user", name: "Ava Stone", initials: "AS", color: "#111111" },
      { userId: "callee-user", name: "Maison Vela", initials: "MV", color: "#222222" },
    ];
    process.env.AGORA_APP_ID = "app-id";
    process.env.AGORA_APP_CERTIFICATE = "app-cert";
  });

  it("refuses with 503 and rings nobody when calling is not configured", async () => {
    delete process.env.AGORA_APP_ID;
    const response = await ring({ conversationId: "conv-1", mode: "voice" });
    expect(response.status).toBe(503);
    expect(((await response.json()) as { code?: string }).code).toBe("CALLING_NOT_CONFIGURED");
    expect(state.published).toHaveLength(0);
  });

  it("rejects a caller who is not a participant", async () => {
    state.userId = "stranger";
    const response = await ring({ conversationId: "conv-1", mode: "voice" });
    expect(response.status).toBe(403);
    expect(state.published).toHaveLength(0);
  });

  it("validates the body", async () => {
    expect((await ring({ mode: "voice" })).status).toBe(400);
    expect((await ring({ conversationId: "conv-1", mode: "fax" })).status).toBe(400);
  });

  it("publishes an incoming-call notification to the callee", async () => {
    const response = await ring({ conversationId: "conv-1", mode: "voice" });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ rung: 1 });
    expect(state.published).toEqual([expect.objectContaining({
      userId: "callee-user",
      type: "dm_call_voice",
      targetType: "dm_call",
      targetId: "conv-1",
    })]);
  });
});
