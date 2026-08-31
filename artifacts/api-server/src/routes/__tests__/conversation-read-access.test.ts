import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const state = vi.hoisted(() => ({
  userId: "unrelated-user",
  updateCalls: 0,
  updates: [] as Array<{ table: unknown; values: Record<string, unknown>; where: unknown }>,
  memberConversationId: null as string | null,
}));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: unknown, next: () => void) => {
    req.clerkUserId = state.userId;
    next();
  },
}));

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => conditions,
  desc: (value: unknown) => value,
  eq: (...values: unknown[]) => values,
  inArray: (...values: unknown[]) => values,
  or: (...conditions: unknown[]) => conditions,
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    kind: "sql",
    strings: Array.from(strings),
    values,
  }),
}));

vi.mock("@workspace/db", () => {
  const table = (name: string) => new Proxy({ name }, {
    get: (target, key) => key in target ? target[key as keyof typeof target] : String(key),
  });
  const conversations = table("conversations");
  const conversationParticipants = table("conversationParticipants");
  const messages = table("messages");
  const blocks = table("blocks");
  const follows = table("follows");
  const users = table("users");
  const products = table("products");
  const orders = table("orders");
  const posts = table("posts");

  return new Proxy({
    db: {
      select: () => ({
        from: (selectedTable: unknown) => ({
          where: () => ({
            limit: async () => selectedTable === conversationParticipants
              && state.memberConversationId !== null
              ? [{ userId: state.userId }]
              : [],
          }),
        }),
      }),
      update: (updatedTable: unknown) => {
        state.updateCalls += 1;
        return {
          set: (values: Record<string, unknown>) => ({
            where: (where: unknown) => {
              state.updates.push({ table: updatedTable, values, where });
              return Promise.resolve();
            },
          }),
        };
      },
    },
    conversations,
    conversationParticipants,
    messages,
    blocks,
    follows,
    users,
    products,
    orders,
    posts,
  }, {
    get: (target, key) => key in target ? (target as any)[key] : table(String(key)),
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
  beforeEach(() => {
    state.userId = "unrelated-user";
    state.updateCalls = 0;
    state.updates = [];
    state.memberConversationId = null;
  });

  it("does not let a nonparticipant mark another conversation as read", async () => {
    const response = await fetch(`${base}/api/conversations/conversation-owned-by-someone-else/read`, {
      method: "PATCH",
    });
    expect(response.status, await response.text()).toBe(404);
    expect(state.updateCalls).toBe(0);
  });

  it("clears only the authenticated participant and marks inbound messages read", async () => {
    state.userId = "seller-user";
    state.memberConversationId = "seller-buyer-conversation";

    const response = await fetch(`${base}/api/conversations/${state.memberConversationId}/read`, {
      method: "PATCH",
    });

    const body = await response.text();
    expect(response.status, body).toBe(200);
    expect(JSON.parse(body)).toEqual({ ok: true });
    expect(state.updates).toHaveLength(2);

    const participantUpdate = state.updates.find(
      (update) => (update.table as { name?: string }).name === "conversationParticipants",
    );
    expect(participantUpdate?.values).toMatchObject({ unreadCount: 0 });
    expect(participantUpdate?.where).toEqual([
      ["conversationId", state.memberConversationId],
      ["userId", state.userId],
    ]);

    const messageUpdate = state.updates.find(
      (update) => (update.table as { name?: string }).name === "messages",
    );
    expect(messageUpdate?.values).toMatchObject({ status: "read" });
    expect(messageUpdate?.where).toEqual([
      ["conversationId", state.memberConversationId],
      {
        kind: "sql",
        strings: ["", " != ", ""],
        values: ["senderId", "seller-user"],
      },
      {
        kind: "sql",
        strings: ["", " IS NULL"],
        values: ["readAt"],
      },
    ]);
  });
});
