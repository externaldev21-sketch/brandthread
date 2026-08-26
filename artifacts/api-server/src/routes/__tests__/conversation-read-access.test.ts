import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const state = vi.hoisted(() => ({ updateCalls: 0 }));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: unknown, next: () => void) => {
    req.clerkUserId = "unrelated-user";
    next();
  },
}));

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => conditions,
  desc: (value: unknown) => value,
  eq: (...values: unknown[]) => values,
  inArray: (...values: unknown[]) => values,
  or: (...conditions: unknown[]) => conditions,
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
}));

vi.mock("@workspace/db", () => {
  const columns = new Proxy({}, { get: (_target, key) => String(key) });
  const query = {
    from: () => ({
      where: () => ({
        limit: async () => [],
      }),
    }),
  };
  return new Proxy({
    db: {
      select: () => query,
      update: () => {
        state.updateCalls += 1;
        return { set: () => ({ where: () => Promise.resolve() }) };
      },
    },
    conversations: columns,
    conversationParticipants: columns,
    messages: columns,
    blocks: columns,
    follows: columns,
    users: columns,
    products: columns,
    orders: columns,
    posts: columns,
  }, {
    get: (target, key) => key in target ? (target as any)[key] : columns,
  });
});

vi.mock("../../lib/contentModerator", () => ({
  moderateMessage: () => ({ allowed: true }),
}));
vi.mock("../notifications-feed", () => ({
  publishNotification: async () => undefined,
}));

import conversationsRouter from "../conversations";

let server: Server;
let base = "";

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/conversations", conversationsRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("conversation read receipts", () => {
  it("does not let a nonparticipant mark another conversation as read", async () => {
    state.updateCalls = 0;
    const response = await fetch(`${base}/api/conversations/conversation-owned-by-someone-else/read`, {
      method: "PATCH",
    });
    expect(response.status, await response.text()).toBe(404);
    expect(state.updateCalls).toBe(0);
  });
});