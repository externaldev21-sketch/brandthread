/**
 * GET /api/social/search — buyer AND seller account search.
 *
 * This environment has no reachable Postgres superuser for provisioning a
 * disposable integration-test database (su/sudo are blocked in this
 * sandboxed worktree) — same documented constraint already noted in
 * routes/__tests__/discover-feed.integration.test.ts. Per that established
 * fallback, this asserts against a fully mocked `@workspace/db` object
 * instead of a real one: a real express() app and the real route handler
 * still run, only the table reads are stubbed. Ranking/filtering that lives
 * in the SQL itself (exact/prefix/contains tiers, verified/follower
 * tie-breaks, blocked/suspended exclusion) was verified by code review of
 * the `matchTier` / `notBlockedWith` / `isNull(...)` predicates in
 * routes/social.ts, not by this test.
 *
 * Covers:
 *  - the response shape includes accountType, verified and a roleTag for
 *    both buyer and seller rows
 *  - roleTagFor (pure function): "Buyer" for buyers, the seller's brandName
 *    when set, else "Seller"
 *  - the formatted response never includes an email field
 *  - `limit` is parsed, defaulted and passed to the query
 */
import { describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { roleTagFor } from "../social";

const state = vi.hoisted(() => ({
  rows: [] as any[],
  lastLimit: undefined as number | undefined,
  followingRows: [] as any[],
}));

// `@workspace/db`'s real module throws at import time unless DATABASE_URL is
// set (see lib/db/src/index.ts), so this mock never delegates to the real
// module (no `vi.importActual`) — this sandbox has no way to provision a
// disposable Postgres instance (su/sudo are blocked; see the file banner).
// Drizzle table objects are only ever passed *through* our own `select`
// stub below (never introspected by it), so plain opaque stand-ins are
// enough for every table `../social` imports.
vi.mock("@workspace/db", () => {
  const tableStub = (name: string) => new Proxy({}, {
    get: (_t, prop) => (typeof prop === "string" ? `${name}.${prop}` : undefined),
  });
  return {
    users: tableStub("users"),
    follows: tableStub("follows"),
    stories: tableStub("stories"),
    storyLikes: tableStub("storyLikes"),
    storyViews: tableStub("storyViews"),
    blocks: tableStub("blocks"),
    posts: tableStub("posts"),
    interactions: tableStub("interactions"),
    notificationsFeed: tableStub("notificationsFeed"),
    suggestionDismissals: tableStub("suggestionDismissals"),
    db: {
      select: (..._args: any[]) => ({
        from: () => ({
          // The users query chains `.orderBy().limit()`; the plain follows
          // lookup just awaits `.where(...)` directly — this single stand-in
          // supports both call shapes without needing to track which table
          // was requested (the real args are opaque proxies here anyway).
          where: () => ({
            orderBy: () => ({
              limit: async (n: number) => {
                state.lastLimit = n;
                return state.rows;
              },
            }),
            then: (resolve: (rows: unknown[]) => void) => resolve(state.followingRows),
          }),
        }),
      }),
    },
  };
});

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: () => void) => {
    req.clerkUserId = "viewer-1";
    next();
  },
}));

vi.mock("../notifications-feed", () => ({
  publishNotification: async () => undefined,
}));

function userRow(overrides: Record<string, unknown> = {}) {
  return {
    clerkId: "u1",
    email: "should-never-leak@test.local",
    name: "Jordan Lee",
    displayName: null,
    username: "jordanlee",
    bio: null,
    profileImageUrl: null,
    avatarUrl: null,
    accountType: "buyer",
    verified: false,
    brandName: null,
    ...overrides,
  };
}

async function startServer() {
  const { default: socialRouter } = await import("../social");
  const app = express();
  app.use(express.json());
  app.use("/api/social", socialRouter);
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { server, base };
}

describe("roleTagFor", () => {
  it("tags a buyer account as Buyer", () => {
    expect(roleTagFor(userRow({ accountType: "buyer" }) as any)).toBe("Buyer");
  });

  it("tags a seller with a storefront name as that store name", () => {
    expect(roleTagFor(userRow({ accountType: "seller", brandName: "Vault Studio" }) as any)).toBe("Vault Studio");
  });

  it("falls back to Seller when a seller has no storefront name", () => {
    expect(roleTagFor(userRow({ accountType: "seller", brandName: null }) as any)).toBe("Seller");
    expect(roleTagFor(userRow({ accountType: "seller", brandName: "   " }) as any)).toBe("Seller");
  });

  it("tags a dual buyer+seller account by its storefront, not Buyer", () => {
    expect(roleTagFor(userRow({ accountType: "both", brandName: "Northloom" }) as any)).toBe("Northloom");
  });
});

describe("GET /api/social/search — response shape", () => {
  it("returns buyer and seller rows with accountType/verified/roleTag and no email", async () => {
    state.rows = [
      userRow({ clerkId: "buyer-1", name: "Jordan Lee", accountType: "buyer", verified: true }),
      userRow({ clerkId: "seller-1", name: "Zylo Studio", accountType: "seller", brandName: "Zylo Studio", verified: false }),
    ];
    state.followingRows = [];

    const { server, base } = await startServer();
    try {
      const response = await fetch(`${base}/api/social/search?q=zylo&limit=10`);
      expect(response.status).toBe(200);
      const body = await response.json() as Array<Record<string, unknown>>;
      expect(body).toHaveLength(2);

      const buyer = body.find((r) => r.userId === "buyer-1")!;
      expect(buyer.accountType).toBe("buyer");
      expect(buyer.roleTag).toBe("Buyer");
      expect(buyer.verified).toBe(true);
      expect(buyer).not.toHaveProperty("email");

      const seller = body.find((r) => r.userId === "seller-1")!;
      expect(seller.accountType).toBe("seller");
      expect(seller.roleTag).toBe("Zylo Studio");
      expect(seller).not.toHaveProperty("email");

      expect(state.lastLimit).toBe(10);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("caps an oversized limit at 50 and defaults a missing one to 20", async () => {
    state.rows = [];
    state.followingRows = [];
    const { server, base } = await startServer();
    try {
      await fetch(`${base}/api/social/search?q=zylo&limit=9999`);
      expect(state.lastLimit).toBe(50);

      await fetch(`${base}/api/social/search?q=zylo`);
      expect(state.lastLimit).toBe(20);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("short-circuits with an empty array for an empty or too-short query, never hitting the DB", async () => {
    state.rows = [{ shouldNeverBeReturned: true }];
    const { server, base } = await startServer();
    try {
      const empty = await fetch(`${base}/api/social/search?q=`);
      expect(await empty.json()).toEqual([]);

      const tooShort = await fetch(`${base}/api/social/search?q=a`);
      expect(await tooShort.json()).toEqual([]);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
