import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import crypto from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { blocks, db, follows, users } from "@workspace/db";

const auth = vi.hoisted(() => ({ userId: "" }));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: () => void) => {
    req.clerkUserId = req.header("x-test-user-id") || auth.userId;
    next();
  },
}));

vi.mock("../notifications-feed", () => ({
  publishNotification: async () => undefined,
}));

const suffix = crypto.randomBytes(8).toString("hex");
const followerId = `social-follow-follower-${suffix}`;
const targetId = `social-follow-target-${suffix}`;
const userIds = [followerId, targetId];
let server: Server;
let base = "";

type FollowResponse = {
  ok: true;
  isFollowing: boolean;
  followersCount: number;
};

async function mutate(method: "POST" | "DELETE") {
  const response = await fetch(
    method === "POST"
      ? `${base}/api/social/follow`
      : `${base}/api/social/follow/${targetId}`,
    {
      method,
      headers: method === "POST" ? { "content-type": "application/json" } : undefined,
      body: method === "POST" ? JSON.stringify({ userId: targetId }) : undefined,
    },
  );
  expect(response.status).toBe(200);
  return response.json() as Promise<FollowResponse>;
}

async function block(blockerId: string, blockedId: string) {
  return fetch(`${base}/api/social/block`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-test-user-id": blockerId,
    },
    body: JSON.stringify({ userId: blockedId }),
  });
}

async function follow(follower: string, target: string) {
  return fetch(`${base}/api/social/follow`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-test-user-id": follower,
    },
    body: JSON.stringify({ userId: target }),
  });
}

async function relationshipState() {
  const [relationshipRows, countRows] = await Promise.all([
    db.select()
      .from(follows)
      .where(and(eq(follows.followerId, followerId), eq(follows.followingId, targetId))),
    db.select({ n: sql<number>`cast(count(*) as int)` })
      .from(follows)
      .where(eq(follows.followingId, targetId)),
  ]);
  return {
    isFollowing: relationshipRows.length === 1,
    followersCount: countRows[0]?.n ?? 0,
  };
}

beforeAll(async () => {
  await db.insert(users).values([
    {
      clerkId: followerId,
      email: `${followerId}@test.local`,
      name: "Concurrent Follower",
      role: "buyer",
      accountType: "buyer",
    },
    {
      clerkId: targetId,
      email: `${targetId}@test.local`,
      name: "Concurrent Target",
      role: "buyer",
      accountType: "buyer",
    },
  ]);
  auth.userId = followerId;

  const { default: socialRouter } = await import("../social");
  const app = express();
  app.use(express.json());
  app.use("/api/social", socialRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", (error) => {
      if (error) throw error;
      resolve();
    });
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

beforeEach(async () => {
  await db.delete(follows).where(or(
    and(eq(follows.followerId, followerId), eq(follows.followingId, targetId)),
    and(eq(follows.followerId, targetId), eq(follows.followingId, followerId)),
  ));
  await db.delete(blocks).where(or(
    and(eq(blocks.blockerId, followerId), eq(blocks.blockedId, targetId)),
    and(eq(blocks.blockerId, targetId), eq(blocks.blockedId, followerId)),
  ));
});

afterAll(async () => {
  await db.delete(blocks).where(or(
    inArray(blocks.blockerId, userIds),
    inArray(blocks.blockedId, userIds),
  ));
  await db.delete(follows).where(
    inArray(follows.followerId, userIds),
  );
  await db.delete(follows).where(
    inArray(follows.followingId, userIds),
  );
  await db.delete(users).where(inArray(users.clerkId, userIds));
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
});

describe("social follow concurrency", () => {
  it("creates one relationship for concurrent duplicate follows", async () => {
    const responses = await Promise.all(
      Array.from({ length: 12 }, () => mutate("POST")),
    );
    const state = await relationshipState();

    expect(state).toEqual({ isFollowing: true, followersCount: 1 });
    expect(responses).toEqual(
      Array.from({ length: 12 }, () => ({
        ok: true,
        isFollowing: true,
        followersCount: 1,
      })),
    );
  });

  it("serializes racing follow and unfollow operations to a valid final state", async () => {
    const completed: FollowResponse[] = [];
    await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        mutate(index % 2 === 0 ? "POST" : "DELETE").then((body) => {
          completed.push(body);
        }),
      ),
    );

    const state = await relationshipState();
    expect(state.followersCount).toBe(state.isFollowing ? 1 : 0);
    expect(completed.at(-1)).toMatchObject(state);
    for (const response of completed) {
      expect(response.followersCount).toBe(response.isFollowing ? 1 : 0);
    }
  });

  it("never restores a follow relationship when follow races with block", async () => {
    const responses = await Promise.all([
      ...Array.from({ length: 12 }, () => follow(followerId, targetId)),
      ...Array.from({ length: 12 }, () => follow(targetId, followerId)),
      block(targetId, followerId),
    ]);

    expect(responses.every((response) => response.status === 200 || response.status === 403)).toBe(true);

    const [blockRows, followRows] = await Promise.all([
      db.select().from(blocks).where(
        and(eq(blocks.blockerId, targetId), eq(blocks.blockedId, followerId)),
      ),
      db.select().from(follows).where(or(
        and(eq(follows.followerId, followerId), eq(follows.followingId, targetId)),
        and(eq(follows.followerId, targetId), eq(follows.followingId, followerId)),
      )),
    ]);
    expect(blockRows).toHaveLength(1);
    expect(followRows).toHaveLength(0);
  });
});