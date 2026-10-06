import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  selects: [] as unknown[][],
  updates: [] as unknown[][],
  executeRows: [] as Array<Record<string, unknown>>,
  sets: [] as Array<Record<string, unknown>>,
  inserts: [] as Array<Record<string, unknown>>,
  passwordEnabled: true,
  verifyPassword: vi.fn(),
  getSessionList: vi.fn(),
  revokeSession: vi.fn(),
  deleteUser: vi.fn(),
  mailerConfigured: true,
  mailSent: true,
  sentCodes: [] as string[],
  purged: [] as string[],
  blockersFor: {} as Record<string, number>,
}));

vi.mock("drizzle-orm", () => {
  const passthrough = (...args: unknown[]) => args;
  const sql = Object.assign((strings: TemplateStringsArray) => strings.join("?"), {});
  return {
    and: passthrough, eq: passthrough, isNull: passthrough, isNotNull: passthrough,
    lte: passthrough, asc: passthrough, desc: passthrough, sql,
  };
});

vi.mock("@workspace/db", () => {
  const columns = new Proxy({}, { get: (_t, key) => String(key) });
  const chain = (kind: "select" | "update" | "insert"): any => {
    const c: any = new Proxy(function () {}, {
      get(_t, key) {
        if (key === "then") {
          return (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
            const queue = kind === "select" ? state.selects : kind === "update" ? state.updates : [];
            return Promise.resolve(queue.length ? queue.shift() : kind === "update" ? [{ id: "row" }] : []).then(resolve, reject);
          };
        }
        if (key === "set") return (v: Record<string, unknown>) => { state.sets.push(v); return c; };
        if (key === "values") return (v: Record<string, unknown>) => { state.inserts.push(v); return c; };
        return () => c;
      },
    });
    return c;
  };
  return {
    users: columns,
    accountDeletionCodes: columns,
    db: {
      select: () => chain("select"),
      update: () => chain("update"),
      insert: () => chain("insert"),
      execute: async () => ({ rows: [state.executeRows[0] ?? {}] }),
      transaction: async () => undefined,
    },
  };
});

vi.mock("@clerk/express", () => ({
  clerkClient: {
    users: {
      getUser: async () => ({ passwordEnabled: state.passwordEnabled }),
      verifyPassword: (args: unknown) => state.verifyPassword(args),
      deleteUser: (id: string) => state.deleteUser(id),
    },
    sessions: {
      getSessionList: (args: unknown) => state.getSessionList(args),
      revokeSession: (id: string) => state.revokeSession(id),
    },
  },
}));

vi.mock("../mailer", () => ({
  isMailerConfigured: () => state.mailerConfigured,
  sendAccountDeletionCodeEmail: async ({ code }: { code: string }) => {
    state.sentCodes.push(code);
    return state.mailSent;
  },
}));

import {
  DELETION_GRACE_DAYS,
  graceSyncUpdates,
  recentDeletionCancellation,
  generateDeletionCode,
  getDeletionBlockers,
  hashDeletionCode,
  issueDeletionCode,
  restoreAccount,
  revokeAllSessions,
  scheduleAccountDeletion,
  verifyDeletionReauth,
} from "../accountDeletion";

beforeEach(() => {
  state.selects = [];
  state.updates = [];
  state.executeRows = [];
  state.sets = [];
  state.inserts = [];
  state.passwordEnabled = true;
  state.verifyPassword.mockReset();
  state.getSessionList.mockReset();
  state.revokeSession.mockReset();
  state.mailerConfigured = true;
  state.mailSent = true;
  state.sentCodes = [];
});

describe("deletion blockers gate", () => {
  it("returns no blockers when nothing is open", async () => {
    state.executeRows = [{ n: 0, cents: 0 }];
    expect(await getDeletionBlockers("user_1")).toEqual([]);
  });

  it("reports blockers when work is still open", async () => {
    state.executeRows = [{ n: 2, cents: 5000 }];
    const blockers = await getDeletionBlockers("user_1");
    expect(blockers.map((b) => b.code)).toContain("seller_open_orders");
    expect(blockers.map((b) => b.code)).toContain("seller_held_funds");
  });
});

describe("re-authentication", () => {
  it("requires a password for password accounts", async () => {
    const result = await verifyDeletionReauth("user_1", {});
    expect(result).toMatchObject({ ok: false, status: 401, code: "REAUTH_REQUIRED" });
    expect(state.verifyPassword).not.toHaveBeenCalled();
  });

  it("rejects a wrong password (verified:false and Clerk 422)", async () => {
    state.verifyPassword.mockResolvedValueOnce({ verified: false });
    expect(await verifyDeletionReauth("user_1", { password: "nope" })).toMatchObject({ ok: false, status: 403, code: "INVALID_PASSWORD" });
    state.verifyPassword.mockRejectedValueOnce(Object.assign(new Error("incorrect_password"), { status: 422 }));
    expect(await verifyDeletionReauth("user_1", { password: "nope" })).toMatchObject({ ok: false, code: "INVALID_PASSWORD" });
  });

  it("does not swallow Clerk outages as a wrong password", async () => {
    state.verifyPassword.mockRejectedValueOnce(Object.assign(new Error("down"), { status: 503 }));
    await expect(verifyDeletionReauth("user_1", { password: "x" })).rejects.toThrow("down");
  });

  it("accepts the right password, verified by Clerk with the caller's own id", async () => {
    state.verifyPassword.mockResolvedValueOnce({ verified: true });
    expect(await verifyDeletionReauth("user_1", { password: "hunter22" })).toEqual({ ok: true });
    expect(state.verifyPassword).toHaveBeenCalledWith({ userId: "user_1", password: "hunter22" });
  });

  describe("password-less accounts", () => {
    beforeEach(() => { state.passwordEnabled = false; });

    it("asks for the emailed code", async () => {
      expect(await verifyDeletionReauth("user_1", {})).toMatchObject({ ok: false, code: "REAUTH_REQUIRED" });
      expect(await verifyDeletionReauth("user_1", { code: "12ab" })).toMatchObject({ ok: false, code: "INVALID_CODE" });
    });

    it("accepts a valid unused code exactly once", async () => {
      const code = "123456";
      const row = { id: "c1", codeHash: hashDeletionCode(code), usedAt: null, expiresAt: new Date(Date.now() + 60_000) };
      state.selects = [[row]];
      state.updates = [[{ id: "c1" }]];
      expect(await verifyDeletionReauth("user_1", { code })).toEqual({ ok: true });

      state.selects = [[row]];
      state.updates = [[]]; // a concurrent retry lost the claim
      expect(await verifyDeletionReauth("user_1", { code })).toMatchObject({ ok: false, code: "INVALID_CODE" });
    });

    it("rejects wrong, used and expired codes", async () => {
      const good = hashDeletionCode("123456");
      state.selects = [[{ id: "c", codeHash: good, usedAt: null, expiresAt: new Date(Date.now() + 60_000) }]];
      expect(await verifyDeletionReauth("user_1", { code: "654321" })).toMatchObject({ ok: false, code: "INVALID_CODE" });
      state.selects = [[{ id: "c", codeHash: good, usedAt: new Date(), expiresAt: new Date(Date.now() + 60_000) }]];
      expect(await verifyDeletionReauth("user_1", { code: "123456" })).toMatchObject({ ok: false, code: "INVALID_CODE" });
      state.selects = [[{ id: "c", codeHash: good, usedAt: null, expiresAt: new Date(Date.now() - 1) }]];
      expect(await verifyDeletionReauth("user_1", { code: "123456" })).toMatchObject({ ok: false, code: "CODE_EXPIRED" });
      state.selects = [[]];
      expect(await verifyDeletionReauth("user_1", { code: "123456" })).toMatchObject({ ok: false, code: "INVALID_CODE" });
    });

    it("issues a hashed code by email, never storing the plain code", async () => {
      state.selects = [[]];
      expect(await issueDeletionCode("user_1", "a@b.co")).toEqual({ ok: true });
      expect(state.sentCodes).toHaveLength(1);
      expect(state.sentCodes[0]).toMatch(/^\d{6}$/);
      expect(state.inserts[0]).toMatchObject({ clerkId: "user_1", codeHash: hashDeletionCode(state.sentCodes[0]) });
      expect(JSON.stringify(state.inserts[0])).not.toContain(`"${state.sentCodes[0]}"`);
    });

    it("returns a typed error (no crash) when the mailer is not configured", async () => {
      state.mailerConfigured = false;
      expect(await issueDeletionCode("user_1", "a@b.co")).toMatchObject({ ok: false, status: 422, code: "MAIL_NOT_CONFIGURED" });
      expect(state.inserts).toHaveLength(0);
    });

    it("throttles repeat requests", async () => {
      state.selects = [[{ createdAt: new Date() }]];
      expect(await issueDeletionCode("user_1", "a@b.co")).toMatchObject({ ok: false, status: 429, code: "CODE_RECENTLY_SENT" });
    });

    it("reports a failed send", async () => {
      state.selects = [[]];
      state.mailSent = false;
      expect(await issueDeletionCode("user_1", "a@b.co")).toMatchObject({ ok: false, status: 502, code: "MAIL_SEND_FAILED" });
    });
  });

  it("does not email codes to password accounts", async () => {
    expect(await issueDeletionCode("user_1", "a@b.co")).toMatchObject({ ok: false, code: "PASSWORD_REAUTH" });
  });

  it("generates six-digit codes", () => {
    for (let i = 0; i < 50; i++) expect(generateDeletionCode()).toMatch(/^\d{6}$/);
  });
});

describe("schedule / restore", () => {
  it("schedules deletion exactly 30 days out", async () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const scheduledFor = await scheduleAccountDeletion("user_1", now);
    expect(scheduledFor?.toISOString()).toBe("2026-01-31T00:00:00.000Z");
    expect(DELETION_GRACE_DAYS).toBe(30);
    expect(state.sets[0]).toMatchObject({ deletionRequestedAt: now, deletionScheduledFor: scheduledFor });
    expect(state.sets[0]).not.toHaveProperty("deletedAt");
    expect(state.sets[0]).toMatchObject({ deletionCancelledAt: null });
  });

  it("is a no-op when already pending or purged", async () => {
    state.updates = [[]];
    expect(await scheduleAccountDeletion("user_1")).toBeNull();
  });

  it("restore clears both dates", async () => {
    expect(await restoreAccount("user_1")).toBe(true);
    expect(state.sets[0]).toMatchObject({ deletionRequestedAt: null, deletionScheduledFor: null });
    expect(state.sets[0].deletionCancelledAt).toBeInstanceOf(Date);
  });

  it("restore reports false when the account is not pending", async () => {
    state.updates = [[]];
    expect(await restoreAccount("user_1")).toBe(false);
  });

  it("revokes every active Clerk session", async () => {
    state.getSessionList.mockResolvedValueOnce({ data: [{ id: "s1" }, { id: "s2" }] });
    expect(await revokeAllSessions("user_1")).toBe(2);
    expect(state.revokeSession).toHaveBeenCalledWith("s1");
    expect(state.revokeSession).toHaveBeenCalledWith("s2");
  });
});

describe("sync during grace", () => {
  it("signing back in cancels a pending deletion instead of rejecting the account", () => {
    const now = new Date("2026-02-01T00:00:00.000Z");
    expect(graceSyncUpdates({ deletedAt: null, deletionRequestedAt: new Date() }, now))
      .toEqual({ deletionRequestedAt: null, deletionScheduledFor: null, deletionCancelledAt: now });
  });

  it("leaves active accounts and purged tombstones alone", () => {
    expect(graceSyncUpdates({ deletedAt: null, deletionRequestedAt: null })).toBeNull();
    expect(graceSyncUpdates({ deletedAt: new Date(), deletionRequestedAt: new Date() })).toBeNull();
  });

  it("shows the cancellation notice for a week only", () => {
    const now = new Date("2026-02-10T00:00:00.000Z");
    expect(recentDeletionCancellation(new Date("2026-02-05T00:00:00.000Z"), now)).toBe("2026-02-05T00:00:00.000Z");
    expect(recentDeletionCancellation(new Date("2026-01-20T00:00:00.000Z"), now)).toBeNull();
    expect(recentDeletionCancellation(null, now)).toBeNull();
  });
});
