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

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => conditions,
  desc: (value: unknown) => value,
  eq: (...values: unknown[]) => values,
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
      [{ id: "message-1", conversationId: "conversation-1" }],
      [{ userId: "reporting-user" }],
    ];

    const response = await fetch(`${base}/api/reports`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ targetType: "message", targetId: "message-1", reason: "spam" }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "already_reported" });
    expect(state.updateCalls).toBe(0);
  });
});