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

vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: testState.userId }),
}));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.clerkUserId = testState.userId;
    next();
  },
}));

import teamRouter from "../team";
import { requireRole, teamContext } from "../../middlewares/requireRole";

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
let removedMembershipId = "";

type MembershipResponse = {
  membership: {
    id: string;
    ownerId: string;
    role: string;
    acceptedAt: string;
    ownerName: string;
  } | null;
};

type MembershipsResponse = {
  memberships: NonNullable<MembershipResponse["membership"]>[];
};

type ContextResponse = {
  actingStoreOwner: string;
  actorRole: string;
  teamMembershipId: string | null;
  code?: string;
};

async function getMembership(userId: string) {
  testState.userId = userId;
  const response = await fetch(`${baseUrl}/api/team/my-membership`);
  return {
    status: response.status,
    body: await response.json() as MembershipResponse,
  };
}

async function getMemberships(userId: string) {
  testState.userId = userId;
  const response = await fetch(`${baseUrl}/api/team/my-memberships`);
  return {
    status: response.status,
    body: await response.json() as MembershipsResponse,
  };
}

async function getContext(userId: string, storeContext?: string) {
  testState.userId = userId;
  const response = await fetch(`${baseUrl}/api/team-context`, {
    headers: storeContext ? { "X-Store-Context": storeContext } : undefined,
  });
  return {
    status: response.status,
    body: await response.json() as ContextResponse,
  };
}

async function selectContext(userId: string, storeContext: string) {
  testState.userId = userId;
  const response = await fetch(`${baseUrl}/api/team/context`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ storeContext }),
  });
  return {
    status: response.status,
    body: await response.json() as {
      storeContext?: string;
      storeOwnerId?: string;
      teamMembershipId?: string | null;
      role?: string;
      code?: string;
    },
  };
}

async function getOwnerOnly(userId: string, storeContext: string) {
  testState.userId = userId;
  const response = await fetch(`${baseUrl}/api/owner-only`, {
    headers: { "X-Store-Context": storeContext },
  });
  return {
    status: response.status,
    body: await response.json() as { code?: string; currentRole?: string },
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

  const [removedMembership] = await db.insert(teamMembers).values({
    ownerId: olderOwnerId,
    memberClerkId: memberId,
    email: `${memberId}-removed@test.local`,
    name: "Removed membership",
    role: "manager",
    status: "removed",
    acceptedAt: new Date("2026-08-31T15:00:00.000Z"),
  }).returning({ id: teamMembers.id });
  removedMembershipId = removedMembership!.id;

  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.log = { error: vi.fn() };
    next();
  });
  app.use("/api/team", teamRouter);
  app.get("/api/team-context", teamContext(), (req, res) => {
    res.json({
      actingStoreOwner: (req as any).clerkUserId,
      actorRole: (req as any).actorRole,
      teamMembershipId: (req as any).teamContext?.teamMembershipId ?? null,
    });
  });
  app.get("/api/owner-only", requireRole("owner"), (_req, res) => {
    res.json({ ok: true });
  });

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

  it("resolves the same owner and role across discovery and request context for equal timestamps", async () => {
    const membershipResult = await getMembership(equalMemberId);
    const contextResult = await getContext(equalMemberId);
    const membership = membershipResult.body.membership;

    expect(membershipResult.status).toBe(200);
    expect(contextResult.status).toBe(200);
    expect(membership).not.toBeNull();
    expect(membership).toMatchObject({
      ownerId: equalOwnerAId,
      role: "manager",
      acceptedAt: equalAcceptedAt.toISOString(),
      ownerName: "Equal Timestamp Store A",
    });
    expect(contextResult.body).toEqual({
      actingStoreOwner: membership!.ownerId,
      actorRole: membership!.role,
      teamMembershipId: membership!.id,
    });
  });

  it("returns every active store membership in deterministic order", async () => {
    const result = await getMemberships(memberId);

    expect(result.status).toBe(200);
    expect(result.body.memberships).toHaveLength(2);
    expect(result.body.memberships.map((membership) => membership.ownerId)).toEqual([
      newerOwnerId,
      olderOwnerId,
    ]);
  });

  it("uses an explicitly selected active membership instead of the newest one", async () => {
    const membershipResult = await getMemberships(memberId);
    const olderMembership = membershipResult.body.memberships.find(
      (membership) => membership.ownerId === olderOwnerId,
    );
    expect(olderMembership).toBeDefined();

    const contextResult = await getContext(memberId, olderMembership!.id);

    expect(contextResult.status).toBe(200);
    expect(contextResult.body).toEqual({
      actingStoreOwner: olderOwnerId,
      actorRole: "staff",
      teamMembershipId: olderMembership!.id,
    });
  });

  it("rejects a membership that belongs to a different caller", async () => {
    const otherMemberships = await getMemberships(equalMemberId);
    const otherMembershipId = otherMemberships.body.memberships[0]!.id;

    const contextResult = await getContext(memberId, otherMembershipId);

    expect(contextResult.status).toBe(403);
    expect(contextResult.body.code).toBe("STORE_CONTEXT_NOT_ALLOWED");
  });

  it("validates and returns an explicit selection through the team API", async () => {
    const memberships = await getMemberships(memberId);
    const selected = memberships.body.memberships.find(
      (membership) => membership.ownerId === olderOwnerId,
    )!;

    const result = await selectContext(memberId, selected.id);

    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      storeContext: selected.id,
      storeOwnerId: olderOwnerId,
      teamMembershipId: selected.id,
      role: "staff",
    });
  });

  it("rejects a selected membership after access has been removed", async () => {
    const result = await selectContext(memberId, removedMembershipId);

    expect(result.status).toBe(403);
    expect(result.body.code).toBe("STORE_CONTEXT_NOT_ALLOWED");
  });

  it("preserves role boundaries in an explicitly selected store", async () => {
    const memberships = await getMemberships(memberId);
    const managerMembership = memberships.body.memberships.find(
      (membership) => membership.ownerId === newerOwnerId,
    )!;

    const result = await getOwnerOnly(memberId, managerMembership.id);

    expect(result.status).toBe(403);
    expect(result.body).toMatchObject({
      code: "ROLE_REQUIRED",
      currentRole: "manager",
    });
  });

  it("returns a null membership for an authenticated user without an active membership", async () => {
    const result = await getMembership(noMembershipUserId);

    expect(result.status).toBe(200);
    expect(result.status).not.toBe(500);
    expect(result.body).toEqual({ membership: null });
  });
});