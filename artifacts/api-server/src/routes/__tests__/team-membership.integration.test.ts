/**
 * Regression coverage for authenticated team membership discovery.
 *
 * This route must inspect the caller before teamContext rewrites the request
 * to the store owner. Keep both the active-member and no-membership cases
 * behind the same authenticated router mount so a middleware ordering change
 * cannot silently return the wrong store context.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { db, teamMembers, users } from "@workspace/db";
import { eq } from "drizzle-orm";

const testState = vi.hoisted(() => ({
  userId: "",
}));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.clerkUserId = testState.userId;
    next();
  },
}));

import teamRouter from "../team";

const suffix = crypto.randomBytes(4).toString("hex");
const olderOwnerId = `team-membership-older-owner-${suffix}`;
const newerOwnerId = `team-membership-newer-owner-${suffix}`;
const memberId = `team-membership-member-${suffix}`;
const noMembershipUserId = `team-membership-none-${suffix}`;
const equalOwnerAId = `team-membership-equal-a-${suffix}`;
const equalOwnerBId = `team-membership-equal-b-${suffix}`;
const equalMemberId = `team-membership-equal-member-${suffix}`;
const olderOwnerEmail = `${olderOwnerId}@test.local`;
const newerOwnerEmail = `${newerOwnerId}@test.local`;
const equalOwnerAEmail = `${equalOwnerAId}@test.local`;
const equalOwnerBEmail = `${equalOwnerBId}@test.local`;
const olderAcceptedAt = new Date("2026-08-31T12:34:56.000Z");
const newerAcceptedAt = new Date("2026-08-31T13:45:00.000Z");
const equalAcceptedAt = new Date("2026-08-31T14:00:00.000Z");

let server: Server;
let baseUrl = "";

async function getMembership(userId: string) {
  testState.userId = userId;
  const response = await fetch(`${baseUrl}/api/team/my-membership`);
  return {
    status: response.status,
    body: await response.json(),
  };
}

beforeAll(async () => {
  await db.insert(users).values([
    {
      clerkId: olderOwnerId,
      email: olderOwnerEmail,
      name: "Older store owner fallback name",
      displayName: "Older Store Owner Display Name",
      role: "seller",
      accountType: "seller",
    },
    {
      clerkId: newerOwnerId,
      email: newerOwnerEmail,
      name: "Newest store owner fallback name",
      displayName: "Newest Store Owner Display Name",
      role: "seller",
      accountType: "seller",
    },
    {
      clerkId: equalOwnerAId,
      email: equalOwnerAEmail,
      name: "Equal timestamp owner A fallback name",
      displayName: "Equal Timestamp Store A",
      role: "seller",
      accountType: "seller",
    },
    {
      clerkId: equalOwnerBId,
      email: equalOwnerBEmail,
      name: "Equal timestamp owner B fallback name",
      displayName: "Equal Timestamp Store B",
      role: "seller",
      accountType: "seller",
    },
  ]);

  await db.insert(teamMembers).values({
    ownerId: olderOwnerId,
    memberClerkId: memberId,
    email: `${memberId}@test.local`,
    name: "Joined older team",
    role: "staff",
    status: "active",
    acceptedAt: olderAcceptedAt,
  });

  await db.insert(teamMembers).values({
    ownerId: newerOwnerId,
    memberClerkId: memberId,
    email: `${memberId}@test.local`,
    name: "Joined newest team",
    role: "manager",
    status: "active",
    acceptedAt: newerAcceptedAt,
  });

  await db.insert(teamMembers).values([
    {
      ownerId: equalOwnerBId,
      memberClerkId: equalMemberId,
      email: `${equalMemberId}@test.local`,
      name: "Joined equal timestamp team B",
      role: "staff",
      status: "active",
      acceptedAt: equalAcceptedAt,
    },
    {
      ownerId: equalOwnerAId,
      memberClerkId: equalMemberId,
      email: `${equalMemberId}@test.local`,
      name: "Joined equal timestamp team A",
      role: "manager",
      status: "active",
      acceptedAt: equalAcceptedAt,
    },
  ]);

  await db.insert(teamMembers).values({
    ownerId: olderOwnerId,
    memberClerkId: noMembershipUserId,
    email: `${noMembershipUserId}@test.local`,
    name: "Pending team member",
    role: "staff",
    status: "pending",
  });

  const app = express();
  app.use((req: any, _res, next) => {
    req.log = { error: vi.fn() };
    next();
  });
  app.use("/api/team", teamRouter);

  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(teamMembers).where(eq(teamMembers.ownerId, olderOwnerId));
  await db.delete(teamMembers).where(eq(teamMembers.ownerId, newerOwnerId));
  await db.delete(teamMembers).where(eq(teamMembers.ownerId, equalOwnerAId));
  await db.delete(teamMembers).where(eq(teamMembers.ownerId, equalOwnerBId));
  await db.delete(users).where(eq(users.clerkId, olderOwnerId));
  await db.delete(users).where(eq(users.clerkId, newerOwnerId));
  await db.delete(users).where(eq(users.clerkId, equalOwnerAId));
  await db.delete(users).where(eq(users.clerkId, equalOwnerBId));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("authenticated team membership discovery", () => {
  it("returns the newest active membership with its matching store details", async () => {
    const result = await getMembership(memberId);

    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      membership: {
        id: expect.any(String),
        ownerId: newerOwnerId,
        role: "manager",
        acceptedAt: newerAcceptedAt.toISOString(),
        ownerName: "Newest Store Owner Display Name",
      },
    });
  });

  it("selects the same membership when active memberships share an acceptance timestamp", async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () => getMembership(equalMemberId)),
    );

    for (const result of results) {
      expect(result.status).toBe(200);
      expect(result.body).toEqual({
        membership: {
          id: expect.any(String),
          ownerId: equalOwnerAId,
          role: "manager",
          acceptedAt: equalAcceptedAt.toISOString(),
          ownerName: "Equal Timestamp Store A",
        },
      });
    }
  });

  it("returns a null membership for an authenticated user without an active membership", async () => {
    const result = await getMembership(noMembershipUserId);

    expect(result.status).toBe(200);
    expect(result.status).not.toBe(500);
    expect(result.body).toEqual({ membership: null });
  });
});