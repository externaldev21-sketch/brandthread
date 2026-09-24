import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const state = vi.hoisted(() => ({
  userId: "reacting-user",
  selectQueue: [] as unknown[][],
  insertQueue: [] as unknown[][],
  deleteCalls: [] as Array<{ table: unknown; where: unknown }>,
  notifications: [] as Array<Record<string, unknown>>,
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

// A minimal thenable query-builder stand-in: every chained method
// (.limit/.orderBy/.offset) is a no-op that returns the same rows, and the
// object resolves to `rows` whether or not the caller chains further.
function chainable(rows: unknown[]) {
  const obj: any = {
    limit: () => chainable(rows),
    orderBy: () => chainable(rows),
    offset: () => chainable(rows),
    then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
      Promise.resolve(rows).then(resolve, reject),
    catch: (reject: (e: unknown) => void) => Promise.resolve(rows).catch(reject),
  };
  return obj;
}

vi.mock("@workspace/db", () => {
  const table = (name: string) => new Proxy({ name }, {
    get: (target, key) => key in target ? target[key as keyof typeof target] : String(key),
  });
  const conversations = table("conversations");
  const conversationParticipants = table("conversationParticipants");
  const messages = table("messages");
  const messageReactions = table("messageReactions");
  const blocks = table("blocks");
  const follows = table("follows");
  const users = table("users");
  const products = table("products");
  const orders = table("orders");
  const posts = table("posts");

  return new Proxy({
    db: {
      select: () => ({
        from: () => ({
          where: () => chainable(state.selectQueue.shift() ?? []),
        }),
      }),
      insert: (insertedTable: unknown) => ({
        values: () => ({
          onConflictDoUpdate: () => ({
            returning: async () => state.insertQueue.shift() ?? [],
          }),
        }),
      }),
      delete: (deletedTable: unknown) => ({
        where: (where: unknown) => {
          state.deleteCalls.push({ table: deletedTable, where });
          return Promise.resolve();
        },
      }),
    },
    conversations,
    conversationParticipants,
    messages,
    messageReactions,
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
  publishNotification: async (n: Record<string, unknown>) => {
    state.notifications.push(n);
  },
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

const CONVERSATION_ID = "conversation-1";
const MESSAGE_ID = "6f1c2f0e-8a54-4d2b-9f7e-1d2c3b4a5e6f";

const MEMBERSHIP_ROW = {
  conversationId: CONVERSATION_ID,
  userId: "reacting-user",
  name: "Jordan",
  handle: "@jordan",
  initials: "J",
  color: "#8B5CF6",
};

const MESSAGE_ROW = {
  id: MESSAGE_ID,
  conversationId: CONVERSATION_ID,
  senderId: "message-author",
  senderName: "Author",
  senderInitials: "A",
  senderColor: "#0891B2",
  body: "hello there",
  attachment: null,
  attachments: [],
  replyToId: null,
  status: "sent",
  moderationStatus: "clear",
  deliveredAt: null,
  readAt: null,
  deletedAt: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
};

beforeEach(() => {
  state.userId = "reacting-user";
  state.selectQueue = [];
  state.insertQueue = [];
  state.deleteCalls = [];
  state.notifications = [];
});

describe("message reactions", () => {
  it("adds a reaction and notifies the message sender (not the reactor)", async () => {
    state.selectQueue = [[MEMBERSHIP_ROW], [MESSAGE_ROW]];
    state.insertQueue = [[{
      id: "reaction-1",
      messageId: MESSAGE_ID,
      userId: "reacting-user",
      reactionType: "like",
      createdAt: new Date("2026-01-02T00:00:00Z"),
    }]];

    const response = await fetch(
      `${base}/api/conversations/${CONVERSATION_ID}/messages/${MESSAGE_ID}/reactions`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reactionType: "like" }),
      },
    );

    const body = await response.text();
    expect(response.status, body).toBe(200);
    expect(JSON.parse(body)).toMatchObject({
      userId: "reacting-user",
      userName: "Jordan",
      reactionType: "like",
    });

    expect(state.notifications).toHaveLength(1);
    expect(state.notifications[0]).toMatchObject({
      userId: "message-author",
      type: "message_reaction",
      targetId: CONVERSATION_ID,
    });
  });

  it("replaces an existing reaction via upsert", async () => {
    state.selectQueue = [[MEMBERSHIP_ROW], [MESSAGE_ROW]];
    state.insertQueue = [[{
      id: "reaction-1",
      messageId: MESSAGE_ID,
      userId: "reacting-user",
      reactionType: "love",
      createdAt: new Date("2026-01-02T01:00:00Z"),
    }]];

    const response = await fetch(
      `${base}/api/conversations/${CONVERSATION_ID}/messages/${MESSAGE_ID}/reactions`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reactionType: "love" }),
      },
    );

    const body = await response.text();
    expect(response.status, body).toBe(200);
    expect(JSON.parse(body)).toMatchObject({ reactionType: "love" });
  });

  it("rejects an invalid reactionType", async () => {
    state.selectQueue = [[MEMBERSHIP_ROW], [MESSAGE_ROW]];

    const response = await fetch(
      `${base}/api/conversations/${CONVERSATION_ID}/messages/${MESSAGE_ID}/reactions`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reactionType: "not-a-real-reaction" }),
      },
    );

    expect(response.status).toBe(400);
  });

  it("does not let a non-participant react", async () => {
    state.selectQueue = [[]]; // membership lookup finds nothing

    const response = await fetch(
      `${base}/api/conversations/${CONVERSATION_ID}/messages/${MESSAGE_ID}/reactions`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reactionType: "like" }),
      },
    );

    expect(response.status).toBe(403);
    expect(state.insertQueue).toHaveLength(0);
    expect(state.notifications).toHaveLength(0);
  });

  it("removes the caller's reaction", async () => {
    state.selectQueue = [[{ userId: "reacting-user" }], [{ id: MESSAGE_ID }]];

    const response = await fetch(
      `${base}/api/conversations/${CONVERSATION_ID}/messages/${MESSAGE_ID}/reactions`,
      { method: "DELETE" },
    );

    const body = await response.text();
    expect(response.status, body).toBe(200);
    expect(JSON.parse(body)).toEqual({ ok: true });
    expect(state.deleteCalls).toHaveLength(1);
  });

  it("does not let a non-participant remove a reaction", async () => {
    state.selectQueue = [[]];

    const response = await fetch(
      `${base}/api/conversations/${CONVERSATION_ID}/messages/${MESSAGE_ID}/reactions`,
      { method: "DELETE" },
    );

    expect(response.status).toBe(403);
    expect(state.deleteCalls).toHaveLength(0);
  });

  it("includes reactions on messages returned from the messages list", async () => {
    state.selectQueue = [
      [{ userId: "reacting-user" }], // isMember
      [MESSAGE_ROW], // messages
      [MEMBERSHIP_ROW, { ...MEMBERSHIP_ROW, userId: "message-author", name: "Author" }], // participants
      [{
        id: "reaction-1",
        messageId: MESSAGE_ID,
        userId: "reacting-user",
        reactionType: "fire",
        createdAt: new Date("2026-01-02T02:00:00Z"),
      }],
    ];

    const response = await fetch(
      `${base}/api/conversations/${CONVERSATION_ID}/messages`,
    );

    const body = await response.text();
    expect(response.status, body).toBe(200);
    const messagesList = JSON.parse(body);
    expect(messagesList).toHaveLength(1);
    expect(messagesList[0].reactions).toEqual([
      {
        userId: "reacting-user",
        userName: "Jordan",
        reactionType: "fire",
        createdAt: "2026-01-02T02:00:00.000Z",
      },
    ]);
  });
});
