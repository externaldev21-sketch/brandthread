import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  candidate: {
    id: "invite-123",
    email: "member@example.com",
    role: "staff",
    inviteToken: "current-token",
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    ownerName: "Brandthread Studio",
    ownerDisplayName: null as string | null,
    ownerLegalName: null as string | null,
  },
  reminderSentAt: null as Date | null,
  reminderClaimedAt: null as Date | null,
  sendResults: [] as boolean[],
  sendOptions: [] as Array<{ reminder?: boolean; idempotencyKey?: string }>,
  persistSuccess: true,
  noCandidates: false,
  infoMessages: [] as Array<{ fields: Record<string, unknown>; message: string }>,
}));

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => conditions,
  eq: (...values: unknown[]) => values,
  gte: (...values: unknown[]) => values,
  isNull: (value: unknown) => value,
  lt: (...values: unknown[]) => values,
  lte: (...values: unknown[]) => values,
  or: (...conditions: unknown[]) => conditions,
}));

vi.mock("@workspace/db", () => {
  const columns = new Proxy({}, { get: (_target, key) => String(key) });
  const activeLease = () =>
    state.reminderClaimedAt &&
    Date.now() - state.reminderClaimedAt.getTime() < 15 * 60 * 1000;

  const queryResult = (run: () => unknown[]) => ({
    returning: async () => run(),
    then: (resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(run()).then(resolve, reject),
  });

  return {
    db: {
      select: () => ({
        from: () => ({
          leftJoin: () => ({
            where: async () =>
              state.noCandidates || state.reminderSentAt ? [] : [state.candidate],
          }),
        }),
      }),
      update: () => ({
        set: (values: Record<string, Date | null>) => ({
          where: () => {
            if (values.reminderClaimedAt instanceof Date) {
              return queryResult(() => {
                if (state.reminderSentAt || activeLease()) return [];
                state.reminderClaimedAt = values.reminderClaimedAt as Date;
                return [{ id: state.candidate.id }];
              });
            }

            if (values.reminderSentAt instanceof Date) {
              return queryResult(() => {
                if (!state.persistSuccess) return [];
                state.reminderSentAt = values.reminderSentAt as Date;
                state.reminderClaimedAt = null;
                return [{ id: state.candidate.id }];
              });
            }

            return queryResult(() => {
              state.reminderClaimedAt = null;
              return [];
            });
          },
        }),
      }),
    },
    teamMembers: columns,
    users: columns,
  };
});

vi.mock("../../lib/logger", () => ({
  logger: {
    info: (fields: Record<string, unknown>, message: string) => {
      state.infoMessages.push({ fields, message });
    },
    warn: () => {},
    error: () => {},
  },
}));

vi.mock("../../lib/teamInvites", () => ({
  inviteUrls: (token: string) => ({ inviteUrl: `https://example.com/?token=${token}` }),
  sendTeamInviteEmail: async (
    _to: string,
    _ownerName: string,
    _role: string,
    _url: string,
    options: { reminder?: boolean; idempotencyKey?: string },
  ) => {
    state.sendOptions.push(options);
    return state.sendResults.shift() ?? true;
  },
  teamInviteReminderIdempotencyKey: (inviteId: string, inviteToken: string) =>
    `team-invite-reminder/${inviteId}/${inviteToken}`,
}));

import { runTeamInviteReminder } from "../teamInviteReminder";

beforeEach(() => {
  process.env.RESEND_API_KEY = "test-key";
  state.reminderSentAt = null;
  state.reminderClaimedAt = null;
  state.sendResults = [];
  state.sendOptions = [];
  state.persistSuccess = true;
  state.noCandidates = false;
  state.infoMessages = [];
  state.candidate.inviteToken = "current-token";
  state.candidate.expiresAt = new Date(Date.now() + 60 * 60 * 1000);
});

describe("team invite reminder job", () => {
  it("claims an invite once when job runs overlap", async () => {
    await Promise.all([runTeamInviteReminder(), runTeamInviteReminder()]);

    expect(state.sendOptions).toHaveLength(1);
    expect(state.reminderSentAt).toBeInstanceOf(Date);
    expect(state.reminderClaimedAt).toBeNull();
  });

  it("retries after a failed delivery without marking the invite sent", async () => {
    state.sendResults = [false, true];

    await runTeamInviteReminder();
    expect(state.reminderSentAt).toBeNull();
    expect(state.reminderClaimedAt).toBeNull();

    await runTeamInviteReminder();
    expect(state.sendOptions).toHaveLength(2);
    expect(state.reminderSentAt).toBeInstanceOf(Date);
  });

  it("reuses the idempotency key after an ambiguous post-send persistence failure", async () => {
    state.persistSuccess = false;
    await runTeamInviteReminder();
    expect(state.reminderSentAt).toBeNull();
    expect(state.reminderClaimedAt).toBeInstanceOf(Date);

    // Simulate the original worker stopping; its bounded lease can now retry.
    state.reminderClaimedAt = new Date(Date.now() - 16 * 60 * 1000);
    state.persistSuccess = true;
    await runTeamInviteReminder();

    expect(state.sendOptions).toEqual([
      {
        reminder: true,
        idempotencyKey: "team-invite-reminder/invite-123/current-token",
      },
      {
        reminder: true,
        idempotencyKey: "team-invite-reminder/invite-123/current-token",
      },
    ]);
    expect(state.reminderSentAt).toBeInstanceOf(Date);
  });

  it("logs a clear no-work result when no invites are due", async () => {
    state.noCandidates = true;

    await runTeamInviteReminder();

    expect(state.infoMessages).toContainEqual({
      fields: { job: "teamInviteReminder", candidates: 0 },
      message: "No invite reminders due",
    });
  });

  it("reminds once for a re-issued invite link after prior reminder tracking is reset", async () => {
    await runTeamInviteReminder();
    expect(state.sendOptions).toHaveLength(1);

    // Regeneration rotates the token and clears both reminder fields. The
    // replacement link must be eligible for its own reminder exactly once.
    state.candidate.inviteToken = "renewed-token";
    state.reminderSentAt = null;
    state.reminderClaimedAt = null;

    await Promise.all([runTeamInviteReminder(), runTeamInviteReminder()]);

    expect(state.sendOptions).toHaveLength(2);
    expect(state.sendOptions[1]).toEqual({
      reminder: true,
      idempotencyKey: "team-invite-reminder/invite-123/renewed-token",
    });
    expect(state.reminderSentAt).toBeInstanceOf(Date);
    expect(state.reminderClaimedAt).toBeNull();
  });
});