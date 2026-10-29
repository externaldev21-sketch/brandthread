/**
 * The invitee's welcome credit passes the same Thread Cash earn kill switch as
 * every other reward: with earning switched off the referral is still
 * recorded, but no credit is paid.
 */
import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db, loyaltyPoints, referrals, threadCashEntries, users } from "@workspace/db";
import { allowThreadCashRewards, seedRewardsGmv } from "../../../testUtils/threadCashRewards";
import { applyReferralCode } from "../rewards";

const sfx = crypto.randomBytes(5).toString("hex");
const INVITER = `audit-ref-inviter-${sfx}`;
const INVITEE = `audit-ref-invitee-${sfx}`;
const CODE = `Q${sfx.toUpperCase()}`.slice(0, 8);
let restoreEnv: () => void;

beforeAll(async () => {
  // Budget open, but the earn kill switch is off.
  restoreEnv = allowThreadCashRewards({ THREAD_CASH_EARN_ENABLED: "false" });
  await seedRewardsGmv();
  await db.insert(users).values([
    { clerkId: INVITER, email: `${INVITER}@example.test`, name: "Inviter", accountType: "buyer", inviteCode: CODE },
    { clerkId: INVITEE, email: `${INVITEE}@example.test`, name: "Invitee", accountType: "buyer" },
  ]);
});

afterAll(async () => {
  await db.delete(threadCashEntries).where(inArray(threadCashEntries.buyerId, [INVITER, INVITEE]));
  await db.delete(loyaltyPoints).where(inArray(loyaltyPoints.buyerId, [INVITER, INVITEE]));
  await db.delete(referrals).where(eq(referrals.inviteeId, INVITEE));
  await db.delete(users).where(inArray(users.clerkId, [INVITER, INVITEE]));
  restoreEnv();
});

describe("applyReferralCode with Thread Cash earning switched off", () => {
  it("records the referral but pays no welcome credit", async () => {
    const result = await applyReferralCode({ inviteeId: INVITEE, code: CODE });
    expect(result).toMatchObject({ ok: true, inviterId: INVITER, inviteeRewardCents: 0 });
    const entries = await db.select().from(threadCashEntries).where(eq(threadCashEntries.buyerId, INVITEE));
    expect(entries).toHaveLength(0);
    const [ref] = await db.select().from(referrals).where(eq(referrals.inviteeId, INVITEE));
    expect(ref).toMatchObject({ inviterId: INVITER, status: "pending" });
  });
});
