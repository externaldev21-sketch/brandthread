/**
 * purgeAccount must erase the person's search history (search_log), which the
 * App Store privacy labels declare as Search History linked to the account.
 * Runs against a mocked database: it captures the SQL the purge transaction
 * would execute and renders it with drizzle's Postgres dialect.
 */
import { describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

const state = vi.hoisted(() => ({ statements: [] as unknown[] }));

vi.mock("@workspace/db", () => {
  const columns = new Proxy({}, { get: (_t, key) => String(key) });
  const tx = {
    execute: async (statement: unknown) => {
      state.statements.push(statement);
      return { rows: [] };
    },
    update: () => ({ set: () => ({ where: async () => [] }) }),
  };
  return {
    users: columns,
    accountDeletionCodes: columns,
    db: {
      select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ id: "user-row-1" }] }) }) }),
      transaction: async (fn: (t: typeof tx) => Promise<void>) => fn(tx),
    },
  };
});

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return { ...actual, eq: () => undefined };
});

vi.mock("@clerk/express", () => ({ clerkClient: {} }));
vi.mock("../mailer", () => ({ isMailerConfigured: () => false, sendAccountDeletionCodeEmail: async () => false }));

describe("purgeAccount", () => {
  it("deletes the account's search_log rows inside the purge transaction", async () => {
    const { purgeAccount } = await import("../accountDeletion");
    expect(await purgeAccount("user_abc")).toBe(true);

    const dialect = new PgDialect();
    const rendered = state.statements.map((s) => dialect.sqlToQuery(s as SQL));
    const searchDelete = rendered.find((q) => /DELETE FROM search_log WHERE user_id = \$1/.test(q.sql));
    expect(searchDelete, "purgeAccount must delete search_log rows").toBeDefined();
    expect(searchDelete!.params).toEqual(["user_abc"]);
  });
});
