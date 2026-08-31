import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

type Member = {
  id: string;
  ownerId: string;
  email: string;
  name: string | null;
  role: "manager" | "staff";
  status: "pending" | "active" | "removed";
  memberClerkId: string | null;
  inviteToken: string | null;
  expiresAt: Date | null;
  invitedAt: Date;
  acceptedAt: Date | null;
  lastActiveAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

const OWNER_ID = "owner-clerk-id";
const EXPIRED_ID = "11111111-1111-1111-1111-111111111111";
const ACTIVE_ID = "22222222-2222-2222-2222-222222222222";
const REMOVED_ID = "33333333-3333-3333-3333-333333333333";

const state = vi.hoisted(() => ({
  members: [] as Member[],
  activity: [] as unknown[][],
}));

function member(overrides: Partial<Member>): Member {
  const now = new Date();
  return {
    id: "member-id",
    ownerId: OWNER_ID,
    email: "member@example.com",
    name: "Team member",
    role: "staff",
    status: "pending",
    memberClerkId: null,
    inviteToken: "invite-token",
    expiresAt: new Date(now.getTime() - 60_000),
    invitedAt: now,
    acceptedAt: null,
    lastActiveAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: unknown, next: () => void) => {
    req.clerkUserId = OWNER_ID;
    next();
  },
}));

vi.mock("../../middlewares/requireRole", () => ({
  teamContext: () => (req: any, _res: unknown, next: () => void) => {
    req.actorClerkId = OWNER_ID;
    req.actorRole = "owner";
    next();
  },
  requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => ({ kind: "and", conditions }),
  eq: (column: string, value: unknown) => ({ kind: "eq", column, value }),
  ne: (column: string, value: unknown) => ({ kind: "ne", column, value }),
  or: (...conditions: unknown[]) => ({ kind: "or", conditions }),
  desc: (column: string) => ({ kind: "desc", column }),
  gt: (column: string, value: unknown) => ({ kind: "gt", column, value }),
  sql: () => ({ kind: "sql" }),
}));

vi.mock("@workspace/db", () => {
  const teamMembers = {
    id: "id",
    ownerId: "ownerId",
    email: "email",
    name: "name",
    role: "role",
    status: "status",
    memberClerkId: "memberClerkId",
    inviteToken: "inviteToken",
    expiresAt: "expiresAt",
    invitedAt: "invitedAt",
    acceptedAt: "acceptedAt",
    lastActiveAt: "lastActiveAt",
    createdAt: "createdAt",
    updatedAt: "updatedAt",
  };
  const users = {
    clerkId: "clerkId",
    email: "email",
    name: "name",
    displayName: "displayName",
    brandName: "brandName",
    createdAt: "createdAt",
  };
  const teamActivityLogs = {
    ownerId: "ownerId",
    actorClerkId: "actorClerkId",
    memberId: "memberId",
    createdAt: "createdAt",
  };

  const valueFor = (row: Record<string, unknown>, column: string) => row[column];
  const matches = (row: Record<string, unknown>, condition: any): boolean => {
    if (!condition) return true;
    if (condition.kind === "and") return condition.conditions.every((c: any) => matches(row, c));
    if (condition.kind === "or") return condition.conditions.some((c: any) => matches(row, c));
    if (condition.kind === "eq") return valueFor(row, condition.column) === condition.value;
    if (condition.kind === "ne") return valueFor(row, condition.column) !== condition.value;
    if (condition.kind === "gt") return (valueFor(row, condition.column) as any) > condition.value;
    return true;
  };

  const memberQuery = (condition: unknown) => ({
    orderBy: async () => state.members.filter((row) => matches(row, condition)),
    limit: async () => state.members.filter((row) => matches(row, condition)).slice(0, 1),
  });

  return {
    teamMembers,
    users,
    teamActivityLogs,
    db: {
      select: () => ({
        from: (table: unknown) => ({
          where: (condition: unknown) => table === teamMembers
            ? memberQuery(condition)
            : {
                limit: async () => [{
                  email: "owner@example.com",
                  name: "Owner",
                  displayName: "Owner",
                  brandName: "Owner Brand",
                  createdAt: new Date(),
                }],
              },
        }),
      }),
      update: () => ({
        set: (values: Record<string, unknown>) => ({
          where: (condition: unknown) => ({
            returning: async () => {
              const row = state.members.find((candidate) => matches(candidate, condition));
              if (!row) return [];
              Object.assign(row, values);
              return [row];
            },
          }),
        }),
      }),
    },
  };
});

vi.mock("../../lib/activityLog", () => ({
  logActivity: vi.fn((...args: unknown[]) => {
    state.activity.push(args);
    return Promise.resolve();
  }),
  reqActor: () => ({
    ownerClerkId: OWNER_ID,
    actorClerkId: OWNER_ID,
    actorRole: "owner",
  }),
}));

vi.mock("../../lib/teamInvites", () => ({
  inviteUrls: (token: string) => ({
    inviteUrl: `https://example.test/team-invite?token=${token}`,
    deepLink: `mobile://team-invite?token=${token}`,
  }),
  resetTeamInviteReminderTracking: () => ({}),
  sendTeamInviteEmail: vi.fn(async () => false),
}));

vi.mock("../../lib/planAccess", () => ({
  getVerifiedPlanAccess: vi.fn(),
  sendPlanLimitReached: vi.fn(),
  sendPlanLookupUnavailable: vi.fn(),
}));

import teamRouter from "../team";

let server: Server;
let baseUrl = "";

async function request(path: string, method = "GET") {
  const response = await fetch(`${baseUrl}${path}`, { method });
  return {
    status: response.status,
    body: await response.json() as any,
  };
}

beforeAll(async () => {
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
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  state.members = [
    member({
      id: EXPIRED_ID,
      email: "expired@example.com",
      name: "Expired invite",
      status: "pending",
      memberClerkId: null,
      inviteToken: "expired-token",
      expiresAt: new Date(Date.now() - 60_000),
    }),
    member({
      id: ACTIVE_ID,
      email: "active@example.com",
      name: "Active member",
      status: "active",
      memberClerkId: "active-member-clerk-id",
      inviteToken: null,
      expiresAt: new Date(Date.now() - 60_000),
      acceptedAt: new Date(),
    }),
    member({
      id: REMOVED_ID,
      email: "removed@example.com",
      name: "Removed member",
      status: "removed",
    }),
  ];
  state.activity = [];
});

describe("team expired invite cleanup", () => {
  it("soft-removes an expired pending invite and excludes it from members", async () => {
    const before = await request("/api/team/members");
    expect(before.status).toBe(200);
    expect(before.body.map((row: { id: string }) => row.id)).toEqual(
      expect.arrayContaining(["owner", ACTIVE_ID, EXPIRED_ID]),
    );
    expect(before.body).toHaveLength(3);
    expect(before.body.find((row: { id: string }) => row.id === EXPIRED_ID)).toMatchObject({
      status: "pending",
      expired: true,
    });

    const removed = await request(`/api/team/members/${EXPIRED_ID}`, "DELETE");

    expect(removed.status).toBe(200);
    expect(removed.body).toEqual({ ok: true });
    expect(state.members.find((row) => row.id === EXPIRED_ID)).toMatchObject({
      status: "removed",
      memberClerkId: null,
      inviteToken: null,
    });
    expect(state.activity[0]?.[3]).toBe("Dismissed expired invite for Expired invite");

    const after = await request("/api/team/members");
    expect(after.body.map((row: { id: string }) => row.id)).toEqual(["owner", ACTIVE_ID]);
    expect(after.body.some((row: { id: string }) => row.id === EXPIRED_ID)).toBe(false);
  });

  it("keeps active-member removal on the normal path without treating it as an expired invite", async () => {
    const removed = await request(`/api/team/members/${ACTIVE_ID}`, "DELETE");

    expect(removed.status).toBe(200);
    expect(state.members.find((row) => row.id === ACTIVE_ID)).toMatchObject({
      status: "removed",
      memberClerkId: null,
      inviteToken: null,
    });
    expect(state.activity[0]?.[3]).toBe("Removed Active member from the team");
    expect(state.activity[0]?.[3]).not.toContain("Dismissed expired invite");

    const after = await request("/api/team/members");
    expect(after.body.map((row: { id: string }) => row.id)).toEqual(["owner", EXPIRED_ID]);
    expect(after.body.find((row: { id: string }) => row.id === EXPIRED_ID)).toMatchObject({
      status: "pending",
      expired: true,
    });
  });
});