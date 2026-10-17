import { afterAll, beforeAll, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { db, teamMembers, teamActivityLogs } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { touchTeamMemberActivity, TEAM_SESSION_GAP_MS } from "../teamSessionLog";

const suffix = crypto.randomBytes(6).toString("hex");
const ownerId = `session-owner-${suffix}`;
const memberClerkId = `session-member-${suffix}`;
let membershipId = "";

async function sessionLogs() {
  return db.select().from(teamActivityLogs)
    .where(and(eq(teamActivityLogs.ownerId, ownerId), eq(teamActivityLogs.resourceType, "session")));
}

beforeAll(async () => {
  const [m] = await db.insert(teamMembers).values({
    ownerId, email: `m-${suffix}@test.local`, name: "Sam Staff", role: "orders", status: "active", memberClerkId,
  }).returning({ id: teamMembers.id });
  membershipId = m.id;
});

afterAll(async () => {
  await db.delete(teamActivityLogs).where(eq(teamActivityLogs.ownerId, ownerId));
  await db.delete(teamMembers).where(eq(teamMembers.id, membershipId));
});

describe("touchTeamMemberActivity", () => {
  it("logs one sign-in per session and touches lastActiveAt", async () => {
    const t0 = new Date("2026-01-01T10:00:00Z");
    await Promise.all([
      touchTeamMemberActivity(membershipId, ownerId, memberClerkId, "orders", t0),
      touchTeamMemberActivity(membershipId, ownerId, memberClerkId, "orders", t0),
    ]);
    await touchTeamMemberActivity(membershipId, ownerId, memberClerkId, "orders", new Date(t0.getTime() + 60_000));
    let logs = await sessionLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      action: "Signed in to the store", actorClerkId: memberClerkId, actorRole: "orders",
      actorName: "Sam Staff", memberId: membershipId, resourceId: membershipId,
    });

    const [row] = await db.select({ lastActiveAt: teamMembers.lastActiveAt }).from(teamMembers).where(eq(teamMembers.id, membershipId));
    expect(row.lastActiveAt?.getTime()).toBe(t0.getTime() + 60_000);

    // Back after a gap longer than the session window → a new sign-in.
    await touchTeamMemberActivity(membershipId, ownerId, memberClerkId, "orders", new Date(t0.getTime() + 60_000 + TEAM_SESSION_GAP_MS + 1000));
    logs = await sessionLogs();
    expect(logs).toHaveLength(2);
  });
});
