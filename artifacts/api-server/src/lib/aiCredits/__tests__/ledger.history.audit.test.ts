/**
 * Audit B08: credit history pagination must never skip entries, and refund
 * rows must record what was actually credited.
 *
 * Rows written in one transaction (a monthly roll plus the debit that caused
 * it) share created_at to the microsecond, and created_at has microsecond
 * precision while a JS Date has milliseconds. A cursor that is only the
 * millisecond created_at skipped every remaining row of such a group.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { inArray, like, sql } from "drizzle-orm";
import { aiCreditAccounts, aiCreditLedger, aiSpendDaily, db } from "@workspace/db";

vi.mock("../../nativeEntitlements", () => ({
  getEffectiveEntitlement: vi.fn(async () => ({ planId: "starter", provider: "stripe", status: "active" })),
}));

import { debitCredits, getAccount, listHistory, refundDebit } from "../ledger";

const users: string[] = [];
const newUser = () => {
  const id = `ai-credits-test-starter-audit-${crypto.randomUUID()}`;
  users.push(id);
  return id;
};

afterEach(async () => {
  if (users.length) {
    await db.delete(aiCreditLedger).where(inArray(aiCreditLedger.clerkUserId, users));
    await db.delete(aiCreditAccounts).where(inArray(aiCreditAccounts.clerkUserId, users));
    await db.delete(aiSpendDaily).where(like(aiSpendDaily.clerkUserId, "%ai-credits-test-starter-audit-%"));
    users.length = 0;
  }
  await db.execute(sql`DELETE FROM ai_spend_daily WHERE clerk_user_id = '*'`);
});

async function pageAll(userId: string, limit: number, maxPages = 20) {
  const seen: string[] = [];
  let before: string | undefined;
  for (let i = 0; i < maxPages; i += 1) {
    const page = await listHistory(userId, { limit, before });
    seen.push(...page.entries.map((e) => e.id));
    if (!page.nextCursor) break;
    before = page.nextCursor;
  }
  return seen;
}

describe("listHistory pagination (audit)", () => {
  it("returns every entry exactly once when several share one transaction's timestamp", async () => {
    const u = newUser();
    await getAccount(u, new Date("2031-01-05T00:00:00Z"));
    // The February debit rolls the month and debits in one transaction:
    // rollover + monthly_grant + debit all carry the same created_at.
    expect((await debitCredits({ clerkUserId: u, cost: 10, toolKey: "t", now: new Date("2031-02-05T00:00:00Z") })).ok).toBe(true);

    const all = (await listHistory(u, { limit: 100 })).entries.map((e) => e.id);
    expect(all.length).toBe(4);

    for (const limit of [1, 2, 3]) {
      const paged = await pageAll(u, limit);
      expect(paged, `limit ${limit}`).toEqual(all);
    }
  });

  it("a refund that lands after the month rolled records only what it credited back", async () => {
    const u = newUser();
    await getAccount(u, new Date("2031-01-05T00:00:00Z"));
    const d = await debitCredits({ clerkUserId: u, cost: 10, toolKey: "t", now: new Date("2031-01-31T23:59:00Z") });
    if (!d.ok) throw new Error("debit failed");
    // Another request rolls the account into February before the refund runs.
    await getAccount(u, new Date("2031-02-01T00:01:00Z"));
    expect(await refundDebit(d.entryId)).toBe(true);

    const acct = (await db.execute(sql`SELECT rollover_balance + monthly_balance + purchased_balance AS total FROM ai_credit_accounts WHERE clerk_user_id = ${u}`)).rows[0] as { total: number };
    const ledger = (await db.execute(sql`SELECT COALESCE(SUM(delta), 0)::int AS total FROM ai_credit_ledger WHERE clerk_user_id = ${u}`)).rows[0] as { total: number };
    expect(ledger.total).toBe(Number(acct.total));
    const refund = (await db.execute(sql`SELECT delta, monthly_delta, rollover_delta FROM ai_credit_ledger WHERE clerk_user_id = ${u} AND kind = 'refund'`)).rows[0] as Record<string, number>;
    expect(refund).toMatchObject({ delta: 0, monthly_delta: 0, rollover_delta: 0 });
  });

  it("still accepts a plain ISO timestamp cursor from older app builds", async () => {
    const u = newUser();
    await getAccount(u);
    const far = new Date(Date.now() + 86_400_000).toISOString();
    expect((await listHistory(u, { before: far })).entries).toHaveLength(1);
    expect((await listHistory(u, { before: "2000-01-01T00:00:00.000Z" })).entries).toHaveLength(0);
  });
});
