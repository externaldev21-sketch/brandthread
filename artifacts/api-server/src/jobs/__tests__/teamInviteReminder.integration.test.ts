import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import { db, teamMembers, users } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";

const sendTeamInviteEmail = vi.hoisted(() => vi.fn(async () => true));

vi.mock("../../lib/teamInvites", () => ({
  inviteUrls: (token: string) => ({
    inviteUrl: `https://example.com/?token=${token}`,
  }),
  sendTeamInviteEmail,
  teamInviteReminderIdempotencyKey: (inviteId: string, inviteToken: string) =>
    `team-invite-reminder/${inviteId}/${inviteToken}`,
}));

vi.mock("../../lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { runTeamInviteReminder } from "../teamInviteReminder";

const testId = crypto.randomUUID();
const ownerId = `invite-reminder-schema-owner-${testId}`;
const inviteEmail = `invite-reminder-schema-${testId}@test.local`;
let inviteId = "";

beforeEach(async () => {
  process.env.RESEND_API_KEY = "test-key";
  sendTeamInviteEmail.mockClear();
});

afterAll(async () => {
  if (inviteId) {
    await db.delete(teamMembers).where(eq(teamMembers.id, inviteId));
  }
  await db.delete(users).where(eq(users.clerkId, ownerId));
});

describe("team invite reminder database contract", () => {
  it("keeps nullable timestamptz reminder columns aligned with the worker path", async () => {
    const drizzleColumns = getTableConfig(teamMembers)
      .columns.filter(({ name }) =>
        ["reminder_claimed_at", "reminder_sent_at"].includes(name),
      )
      .map((column) => ({
        name: column.name,
        notNull: column.notNull,
        sqlType: column.getSQLType(),
      }))
      .sort((left, right) => left.name.localeCompare(right.name));

    expect(
      drizzleColumns,
      "Drizzle reminder columns must remain nullable TIMESTAMPTZ",
    ).toEqual([
      {
        name: "reminder_claimed_at",
        notNull: false,
        sqlType: "timestamp with time zone",
      },
      {
        name: "reminder_sent_at",
        notNull: false,
        sqlType: "timestamp with time zone",
      },
    ]);

    const result = await db.execute(sql`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'team_members'
        AND column_name IN ('reminder_claimed_at', 'reminder_sent_at')
      ORDER BY column_name
    `);

    expect(
      result.rows,
      "team_members reminder tracking columns must remain nullable TIMESTAMPTZ",
    ).toEqual([
      {
        column_name: "reminder_claimed_at",
        data_type: "timestamp with time zone",
        is_nullable: "YES",
      },
      {
        column_name: "reminder_sent_at",
        data_type: "timestamp with time zone",
        is_nullable: "YES",
      },
    ]);

    await db.insert(users).values({
      clerkId: ownerId,
      email: `${ownerId}@test.local`,
      name: "Invite Reminder Schema Owner",
      role: "seller",
      accountType: "seller",
    });

    const [invite] = await db
      .insert(teamMembers)
      .values({
        ownerId,
        email: inviteEmail,
        role: "staff",
        status: "pending",
        inviteToken: `schema-token-${testId}`,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      })
      .returning({ id: teamMembers.id });
    inviteId = invite.id;

    await Promise.all([runTeamInviteReminder(), runTeamInviteReminder()]);

    expect(sendTeamInviteEmail).toHaveBeenCalledTimes(1);
    expect(sendTeamInviteEmail).toHaveBeenCalledWith(
      inviteEmail,
      "Invite Reminder Schema Owner",
      "staff",
      expect.stringContaining(`schema-token-${testId}`),
      {
        reminder: true,
        idempotencyKey: `team-invite-reminder/${invite.id}/schema-token-${testId}`,
      },
    );

    const [sentInvite] = await db
      .select({
        reminderSentAt: teamMembers.reminderSentAt,
        reminderClaimedAt: teamMembers.reminderClaimedAt,
      })
      .from(teamMembers)
      .where(eq(teamMembers.id, invite.id));
    expect(sentInvite.reminderSentAt).toBeInstanceOf(Date);
    expect(sentInvite.reminderClaimedAt).toBeNull();
  });

  it("clears a failed delivery claim so the next run can retry", async () => {
    const retryToken = `retry-token-${testId}`;
    await db.insert(users).values({
      clerkId: `${ownerId}-retry`,
      email: `${ownerId}-retry@test.local`,
      name: "Invite Reminder Retry Owner",
      role: "seller",
      accountType: "seller",
    });
    const [retryInvite] = await db
      .insert(teamMembers)
      .values({
        ownerId: `${ownerId}-retry`,
        email: `${ownerId}-retry@test.local`,
        role: "staff",
        status: "pending",
        inviteToken: retryToken,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      })
      .returning({ id: teamMembers.id });

    try {
      sendTeamInviteEmail
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);

      await runTeamInviteReminder();
      const [afterFailure] = await db
        .select({
          reminderSentAt: teamMembers.reminderSentAt,
          reminderClaimedAt: teamMembers.reminderClaimedAt,
        })
        .from(teamMembers)
        .where(eq(teamMembers.id, retryInvite.id));
      expect(afterFailure.reminderSentAt).toBeNull();
      expect(afterFailure.reminderClaimedAt).toBeNull();

      await runTeamInviteReminder();

      expect(sendTeamInviteEmail).toHaveBeenCalledTimes(2);
      const [afterRetry] = await db
        .select({
          reminderSentAt: teamMembers.reminderSentAt,
          reminderClaimedAt: teamMembers.reminderClaimedAt,
        })
        .from(teamMembers)
        .where(eq(teamMembers.id, retryInvite.id));
      expect(afterRetry.reminderSentAt).toBeInstanceOf(Date);
      expect(afterRetry.reminderClaimedAt).toBeNull();
    } finally {
      await db.delete(teamMembers).where(eq(teamMembers.id, retryInvite.id));
      await db.delete(users).where(eq(users.clerkId, `${ownerId}-retry`));
    }
  });
});
