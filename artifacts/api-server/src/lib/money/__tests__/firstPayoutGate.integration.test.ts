/**
 * First-payout identity gate (feature 62): a new seller's first money out
 * waits for Stripe Identity; sellers already paid before are not held.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { sql, inArray } from "drizzle-orm";
import { db, users } from "@workspace/db";
import { checkFirstPayout, firstPayoutGateEnabled } from "../firstPayoutGate";

const ON = { PAYOUT_REQUIRE_IDENTITY: "on" } as NodeJS.ProcessEnv;
const suffix = crypto.randomBytes(6).toString("hex");
const NEW_SELLER = `fpg-new-${suffix}`;
const VERIFIED = `fpg-verified-${suffix}`;
const PAID_BEFORE = `fpg-paid-${suffix}`;
const CASHED_OUT = `fpg-cash-${suffix}`;
const ALL = [NEW_SELLER, VERIFIED, PAID_BEFORE, CASHED_OUT];
let txId = "";

beforeAll(async () => {
  await db.insert(users).values(ALL.map((id, i) => ({
    clerkId: id, email: `${id}@t.local`, name: id, username: `fpg${i}_${suffix}`, role: "seller", accountType: "seller",
    ...(id === VERIFIED ? { verified: true, verificationStatus: "verified" } : {}),
  })));
  const tx = await db.execute(sql`
    INSERT INTO ledger_transactions (idempotency_key, kind, seller_id)
    VALUES (${`fpg-test/${suffix}`}, 'order_transferred', ${PAID_BEFORE}) RETURNING id
  `);
  txId = ((tx as unknown as { rows: Array<{ id: string }> }).rows)[0].id;
  await db.execute(sql`
    INSERT INTO ledger_postings (transaction_id, account, party_id, amount_cents)
    VALUES (${txId}::uuid, 'seller_held', ${PAID_BEFORE}, -500), (${txId}::uuid, 'seller_paid_out', ${PAID_BEFORE}, 500)
  `);
  await db.execute(sql`
    INSERT INTO seller_cashout_attempts (owner_id, idempotency_key, amount_cents, currency, status)
    VALUES (${CASHED_OUT}, ${`fpg-${suffix}`}, 1000, 'usd', 'succeeded')
  `);
});

afterAll(async () => {
  // The ledger is append-only (ledger_reject_mutation); its rows stay in the isolated test DB.
  await db.execute(sql`DELETE FROM seller_cashout_attempts WHERE owner_id = ${CASHED_OUT}`);
  await db.delete(users).where(inArray(users.clerkId, ALL));
});

describe("checkFirstPayout", () => {
  it("holds a new seller who hasn't verified their identity", async () => {
    expect(await checkFirstPayout(db, NEW_SELLER, ON)).toEqual({ ok: false, reason: "identity_required" });
  });

  it("pays a verified seller", async () => {
    expect(await checkFirstPayout(db, VERIFIED, ON)).toEqual({ ok: true, reason: "verified" });
  });

  it("doesn't hold sellers who were already paid by transfer or cash-out", async () => {
    expect(await checkFirstPayout(db, PAID_BEFORE, ON)).toEqual({ ok: true, reason: "already_paid" });
    expect(await checkFirstPayout(db, CASHED_OUT, ON)).toEqual({ ok: true, reason: "already_paid" });
  });

  it("holds an unknown seller", async () => {
    expect((await checkFirstPayout(db, `nobody-${suffix}`, ON)).ok).toBe(false);
  });

  it("is lifted by PAYOUT_REQUIRE_IDENTITY=off", async () => {
    expect(await checkFirstPayout(db, NEW_SELLER, { PAYOUT_REQUIRE_IDENTITY: "off" } as NodeJS.ProcessEnv))
      .toEqual({ ok: true, reason: "gate_off" });
  });
});

describe("firstPayoutGateEnabled", () => {
  it("is on unless explicitly turned off", () => {
    expect(firstPayoutGateEnabled({} as NodeJS.ProcessEnv)).toBe(true);
    expect(firstPayoutGateEnabled(ON)).toBe(true);
    for (const v of ["off", "false", "0", " OFF "]) {
      expect(firstPayoutGateEnabled({ PAYOUT_REQUIRE_IDENTITY: v } as NodeJS.ProcessEnv)).toBe(false);
    }
  });
});
