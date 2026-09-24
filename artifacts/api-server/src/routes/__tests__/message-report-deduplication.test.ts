import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const state = vi.hoisted(() => ({
  selectResults: [] as unknown[][],
  updateCalls: 0,
}));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: unknown, next: () => void) => {
    req.clerkUserId = "reporting-user";
    next();
  },
  requireModerator: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

// Rate limiting is backed by a Postgres table (rate_limit_buckets); this test
// mounts the router in isolation with no real DB, so stub it out rather than
// have every request fail closed with a 503 from the unmocked db.execute call.
vi.mock("../../middlewares/rateLimit", () => ({
  rateLimit: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  appRateLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => conditions,
  desc: (value: unknown) => value,
  eq: (...values: unknown[]) => values,
  or: (...conditions: unknown[]) => conditions,
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
}));

vi.mock("@workspace/db", () => {
  const columns = new Proxy({}, { get: (_target, key) => String(key) });
  const select = () => ({
    from: () => ({
      where: () => ({
        limit: async () => state.selectResults.shift() ?? [],
      }),
    }),
  });
  return new Proxy({
    db: {
      select,
      insert: () => ({
        values: () => ({
          onConflictDoNothing: () => ({
            returning: async () => [],
          }),
        }),
      }),
      update: () => {
        state.updateCalls += 1;
        return { set: () => ({ where: () => Promise.resolve() }) };
      },
    },
    conversationParticipants: columns,
    conversations: columns,
    messageReports: columns,
    messages: columns,
    reports: columns,
    users: columns,
  }, {
    get: (target, key) => key in target ? (target as any)[key] : columns,
  });
});

import reportsRouter from "../reports";

const MESSAGE_ID = "6f1c2f0e-8a54-4d2b-9f7e-1d2c3b4a5e6f";

let server: Server;
let base = "";

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/reports", reportsRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("message report deduplication", () => {
  it("does not increment message or conversation moderation state for a duplicate report", async () => {
    state.updateCalls = 0;
    state.selectResults = [
      [{ id: MESSAGE_ID, senderId: "message-author", body: "hello", conversationId: "conversation-1" }],
      [{ userId: "reporting-user" }],
    ];

    const response = await fetch(`${base}/api/reports`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ targetType: "message", targetId: MESSAGE_ID, reason: "spam" }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "already_reported" });
    expect(state.updateCalls).toBe(0);
  });
});