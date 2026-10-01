import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const state = vi.hoisted(() => ({
  selectResults: [] as unknown[][],
  blocked: false,
  blockRows: [] as Array<{ blockerId: string; blockedId: string }>,
}));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: unknown, next: () => void) => {
    req.clerkUserId = "joiner";
    next();
  },
}));
vi.mock("../../middlewares/rateLimit", () => ({
  rateLimit: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("drizzle-orm", () => {
  const op = (...args: unknown[]) => args;
  return {
    and: op, asc: op, desc: op, eq: op, gt: op, ilike: op, inArray: op, isNull: op, lt: op,
    notInArray: op, or: op,
    sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
  };
});

vi.mock("@workspace/db", () => {
  const columns = new Proxy({}, { get: (_target, key) => String(key) });
  // select().from().where() is both awaitable (block rows) and has .limit() (row lookups).
  const select = () => ({
    from: () => ({
      where: () => {
        const result = Promise.resolve(state.blockRows);
        return Object.assign(result, {
          limit: async () => state.selectResults.shift() ?? [],
        });
      },
    }),
  });
  return new Proxy({
    db: { select },
    users: columns, blocks: columns, communities: columns, communityMembers: columns,
    communityMessages: columns, communityMessageReactions: columns, communityBans: columns,
    communityJoinRequests: columns,
  }, {
    get: (target, key) => key in target ? (target as any)[key] : columns,
  });
});

vi.mock("../../lib/safety", () => ({
  isBlockedEitherWay: async () => state.blocked,
  publishingRestriction: async () => null,
  profilesById: async () => new Map(),
}));
vi.mock("../../lib/contentModerator", () => ({ moderateMessage: () => ({ action: "allow" }) }));
vi.mock("../../lib/imageModeration", () => ({
  IMAGE_REJECTED_MESSAGE: "", IMAGE_UNAVAILABLE_MESSAGE: "", moderateImage: async () => ({ ok: true }),
}));
vi.mock("../../lib/communityMedia", () => ({
  communityImageExtension: () => "jpg",
  isModeratedCommunityImageUrl: () => true,
  storeCommunityImage: async () => "",
  StorageNotConfiguredError: class extends Error {},
}));
vi.mock("../../ws/communityHub", () => ({
  broadcastToCommunity: () => undefined,
  closeCommunityRoom: () => undefined,
  kickFromCommunity: () => undefined,
}));
vi.mock("../../lib/communityPush", () => ({ noteCommunityMessage: () => undefined }));
vi.mock("../../lib/webOrigin", () => ({ getWebOrigin: () => "https://example.test" }));
vi.mock("../../lib/logger", () => ({ logger: { error: () => undefined, warn: () => undefined, info: () => undefined } }));

import communitiesRouter from "../communities";

const COMMUNITY_ID = "6f1c2f0e-8a54-4d2b-9f7e-1d2c3b4a5e6f";
const community = {
  id: COMMUNITY_ID, ownerId: "group-owner", kind: "community", visibility: "public", requireApproval: false,
  name: "Group", memberCount: 3,
};

let server: Server;
let base = "";

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((_req, _res, next) => next());
  app.use("/api/communities", communitiesRouter);
  app.use((err: any, _req: any, res: any, _next: any) => { console.log("ERRX", err?.message); res.status(500).json({ error: err?.message }); });
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  state.selectResults = [];
  state.blocked = false;
  state.blockRows = [];
});

describe("community block checks", () => {
  it("refuses to join a group whose owner is blocked either way", async () => {
    state.blocked = true;
    state.selectResults = [[community], []]; // community, not banned
    const res = await fetch(`${base}/api/communities/${COMMUNITY_ID}/join`, { method: "POST" });
    expect(res.status).toBe(403);
    expect((await res.json() as any).code).toBe("BLOCKED");
  });

  it("does not block joining when there is no block", async () => {
    state.selectResults = [[community], [], [{ communityId: COMMUNITY_ID, userId: "joiner", role: "member" }]];
    const res = await fetch(`${base}/api/communities/${COMMUNITY_ID}/join`, { method: "POST" });
    expect((await res.json() as any).code).not.toBe("BLOCKED");
  });
});
