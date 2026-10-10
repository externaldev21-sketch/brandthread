import { describe, expect, it, vi } from "vitest";

// No database in unit tests: the tables are plain sentinels and the executor
// below is an in-memory fake, so only recordLegalAcceptance's own logic runs.
vi.mock("@workspace/db", () => ({
  users: { clerkId: "users.clerk_id", id: "users.id" },
  legalAcceptances: { clerkId: "legal_acceptances.clerk_id", version: "legal_acceptances.version" },
}));
vi.mock("drizzle-orm", () => ({ eq: (a: unknown, b: unknown) => ({ a, b }) }));

import { legalAcceptances, users } from "@workspace/db";
import { LEGAL_ACCEPTANCE_SOURCES, recordLegalAcceptance } from "./legalAcceptance";

type HistoryRow = { clerkId: string; version: string; source: string; acceptedAt: Date };

/**
 * In-memory stand-in for the two tables, honouring the unique
 * (clerk_id, version) index that legal_acceptances has in the database.
 */
function fakeExecutor(existingUsers: string[], targetClerkId: string) {
  const userRows = new Map(
    existingUsers.map((clerkId) => [clerkId, { termsVersion: null as string | null, termsAcceptedAt: null as Date | null }]),
  );
  const history: HistoryRow[] = [];
  const executor = {
    update(table: unknown) {
      expect(table).toBe(users);
      return {
        set(values: Record<string, any>) {
          return {
            where(_cond: unknown) {
              return {
                returning: async () => {
                  const row = userRows.get(targetClerkId);
                  if (!row) return [];
                  row.termsVersion = values.termsVersion;
                  row.termsAcceptedAt = values.termsAcceptedAt;
                  return [{ id: targetClerkId }];
                },
              };
            },
          };
        },
      };
    },
    insert(table: unknown) {
      expect(table).toBe(legalAcceptances);
      return {
        values(row: HistoryRow) {
          return {
            onConflictDoNothing: async (_opts: unknown) => {
              if (!history.some((h) => h.clerkId === row.clerkId && h.version === row.version)) history.push(row);
            },
          };
        },
      };
    },
  };
  return { executor, userRows, history };
}

describe("recordLegalAcceptance", () => {
  it("updates the user row and inserts one history row", async () => {
    const fake = fakeExecutor(["user_1"], "user_1");
    const at = new Date("2026-09-30T10:00:00Z");
    const found = await recordLegalAcceptance(fake.executor, { clerkId: "user_1", version: "2026-09-23", source: "signup", acceptedAt: at });
    expect(found).toBe(true);
    expect(fake.userRows.get("user_1")).toMatchObject({ termsVersion: "2026-09-23", termsAcceptedAt: at });
    expect(fake.history).toEqual([{ clerkId: "user_1", version: "2026-09-23", source: "signup", acceptedAt: at }]);
  });

  it("is idempotent per user and version, keeping the first timestamp and source", async () => {
    const fake = fakeExecutor(["user_1"], "user_1");
    const first = new Date("2026-09-30T10:00:00Z");
    const second = new Date("2026-10-01T10:00:00Z");
    await recordLegalAcceptance(fake.executor, { clerkId: "user_1", version: "2026-09-23", source: "signup", acceptedAt: first });
    await recordLegalAcceptance(fake.executor, { clerkId: "user_1", version: "2026-09-23", source: "update_prompt", acceptedAt: second });
    expect(fake.history).toHaveLength(1);
    expect(fake.history[0]).toMatchObject({ source: "signup", acceptedAt: first });
    // the user row always shows the latest agreement
    expect(fake.userRows.get("user_1")?.termsAcceptedAt).toEqual(second);
  });

  it("adds a new history row for a new version", async () => {
    const fake = fakeExecutor(["user_1"], "user_1");
    await recordLegalAcceptance(fake.executor, { clerkId: "user_1", version: "2026-09-23" });
    await recordLegalAcceptance(fake.executor, { clerkId: "user_1", version: "2026-12-01", source: "update_prompt" });
    expect(fake.history.map((h) => [h.version, h.source])).toEqual([["2026-09-23", "signup"], ["2026-12-01", "update_prompt"]]);
  });

  it("writes nothing and reports false when the account does not exist yet", async () => {
    const fake = fakeExecutor([], "ghost");
    expect(await recordLegalAcceptance(fake.executor, { clerkId: "ghost", version: "2026-09-23" })).toBe(false);
    expect(fake.history).toHaveLength(0);
  });

  it("records a separate agreement in history only when updateAccountTerms is false", async () => {
    const fake = fakeExecutor(["user_1"], "user_1");
    expect(await recordLegalAcceptance(fake.executor, {
      clerkId: "user_1", version: "manufacturer-terms/2026-10-10", updateAccountTerms: false,
    })).toBe(true);
    expect(fake.userRows.get("user_1")?.termsVersion).toBeNull();
    expect(fake.history.map((h) => h.version)).toEqual(["manufacturer-terms/2026-10-10"]);
    // No users row needed (portal-only manufacturer accounts).
    const ghost = fakeExecutor([], "ghost");
    expect(await recordLegalAcceptance(ghost.executor, { clerkId: "ghost", version: "manufacturer-terms/2026-10-10", updateAccountTerms: false })).toBe(true);
    expect(ghost.history).toHaveLength(1);
  });

  it("accepts only the two known sources", () => {
    expect([...LEGAL_ACCEPTANCE_SOURCES]).toEqual(["signup", "update_prompt"]);
  });
});
