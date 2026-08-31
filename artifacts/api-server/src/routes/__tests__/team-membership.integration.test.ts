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
const ownerId = `team-membership-owner-${suffix}`;
const memberId = `team-membership-member-${suffix}`;
const noMembershipUserId = `team-membership-none-${suffix}`;
const ownerEmail = `${ownerId}@test.local`;
const acceptedAt = new Date("2026-08-31T12:34:56.000Z");

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
  await db.insert(users).values({
    clerkId: ownerId,
    email: ownerEmail,
    name: "Store owner fallback name",
    displayName: "Store Owner Display Name",
    role: "seller",
    accountType: "seller",
  });

  await db.insert(teamMembers).values({
    ownerId,
    memberClerkId: memberId,
    email: `${memberId}@test.local`,
    name: "Joined team member",
    role: "staff",
    status: "active",
    acceptedAt,
  });

  await db.insert(teamMembers).values({
    ownerId,
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
  await db.delete(teamMembers).where(eq(teamMembers.ownerId, ownerId));
  await db.delete(users).where(eq(users.clerkId, ownerId));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("authenticated team membership discovery", () => {
  it("returns the active member role, store owner, acceptance time, and display name", async () => {
    const result = await getMembership(memberId);

    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      membership: {
        id: expect.any(String),
        ownerId,
        role: "staff",
        acceptedAt: acceptedAt.toISOString(),
        ownerName: "Store Owner Display Name",
      },
    });
  });

  it("returns a null membership for an authenticated user without an active membership", async () => {
    const result = await getMembership(noMembershipUserId);

    expect(result.status).toBe(200);
    expect(result.status).not.toBe(500);
    expect(result.body).toEqual({ membership: null });
  });
});