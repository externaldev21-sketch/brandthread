import { describe, expect, it } from "vitest";
import {
  INVITE_CODE_ALPHABET,
  REFERRAL_MAX_PAID_PER_INVITER,
  REFERRAL_MIN_ORDER_CENTS,
  canonicalEmail,
  decideQualification,
  generateInviteCode,
  inviteLink,
  normalizeInviteCode,
  referralIdempotencyKey,
  type QualificationInput,
} from "../policy";

const joinedAt = new Date("2026-01-01T00:00:00Z");

function input(overrides: {
  referral?: Partial<QualificationInput["referral"]>;
  order?: Partial<QualificationInput["order"]>;
  inviterEmail?: string | null;
  inviteeEmail?: string | null;
  inviterRewardedCount?: number;
} = {}): QualificationInput {
  return {
    referral: { status: "pending", inviterId: "inviter", inviteeId: "invitee", joinedAt, ...overrides.referral },
    order: {
      buyerId: "invitee",
      status: "processing",
      paidCents: 2500,
      createdAt: new Date("2026-01-02T00:00:00Z"),
      ...overrides.order,
    },
    inviterEmail: overrides.inviterEmail ?? "a@example.com",
    inviteeEmail: overrides.inviteeEmail ?? "b@example.com",
    inviterRewardedCount: overrides.inviterRewardedCount ?? 0,
  };
}

describe("decideQualification", () => {
  it("rewards the inviter $10 for the invitee's first qualifying order", () => {
    expect(decideQualification(input())).toEqual({ action: "reward", amountCents: 1000 });
  });

  it("never pays twice for one referral", () => {
    expect(decideQualification(input({ referral: { status: "rewarded" } }))).toEqual({
      action: "skip",
      reason: "already_qualified",
    });
    expect(decideQualification(input({ referral: { status: "capped" } })).action).toBe("skip");
  });

  it("rejects self-referral and orders from someone else", () => {
    expect(decideQualification(input({ referral: { inviterId: "invitee" } }))).toMatchObject({ reason: "self_referral" });
    expect(decideQualification(input({ order: { buyerId: "other" } }))).toMatchObject({ reason: "not_invitee_order" });
    expect(decideQualification(input({ order: { buyerId: null } }))).toMatchObject({ reason: "not_invitee_order" });
  });

  it("dedupes the same person using email aliases", () => {
    expect(decideQualification(input({ inviterEmail: "jane.doe@gmail.com", inviteeEmail: "janedoe+promo@googlemail.com" })))
      .toMatchObject({ reason: "same_person" });
  });

  it("requires the minimum real-money order and ignores Thread Cash paid amounts", () => {
    expect(decideQualification(input({ order: { paidCents: REFERRAL_MIN_ORDER_CENTS - 1 } })))
      .toMatchObject({ reason: "below_minimum" });
    expect(decideQualification(input({ order: { paidCents: REFERRAL_MIN_ORDER_CENTS } })).action).toBe("reward");
  });

  it("skips refunded, cancelled and pre-join orders", () => {
    for (const status of ["refund_pending", "cancelled", "refunded"]) {
      expect(decideQualification(input({ order: { status } }))).toMatchObject({ reason: "order_not_paid" });
    }
    expect(decideQualification(input({ order: { createdAt: new Date("2025-12-31T00:00:00Z") } })))
      .toMatchObject({ reason: "order_before_join" });
  });

  it("caps paid referrals per inviter", () => {
    expect(decideQualification(input({ inviterRewardedCount: REFERRAL_MAX_PAID_PER_INVITER - 1 })).action).toBe("reward");
    expect(decideQualification(input({ inviterRewardedCount: REFERRAL_MAX_PAID_PER_INVITER }))).toEqual({ action: "cap" });
  });
});

describe("codes and keys", () => {
  it("generates unambiguous 6-char codes", () => {
    for (let i = 0; i < 200; i++) {
      const code = generateInviteCode();
      expect(code).toHaveLength(6);
      expect([...code].every((c) => INVITE_CODE_ALPHABET.includes(c))).toBe(true);
    }
    expect(new Set(Array.from({ length: 200 }, () => generateInviteCode())).size).toBeGreaterThan(190);
  });

  it("keeps legacy codes valid and rejects junk", () => {
    expect(normalizeInviteCode(" k7m2pq ")).toBe("K7M2PQ");
    expect(normalizeInviteCode("../x")).toBeNull();
    expect(normalizeInviteCode(42)).toBeNull();
  });

  it("builds idempotency keys per invitee and role", () => {
    expect(referralIdempotencyKey("user_1", "inviter")).toBe("referral:user_1:inviter");
    expect(referralIdempotencyKey("user_1", "invitee")).toBe("referral:user_1:invitee");
  });

  it("links and canonical emails", () => {
    expect(inviteLink("ABC234")).toBe("https://brandthread.app/invite/ABC234");
    expect(canonicalEmail("A.B+c@Gmail.com")).toBe("ab@gmail.com");
    expect(canonicalEmail("x@corp.com")).toBe("x@corp.com");
    expect(canonicalEmail(null)).toBeNull();
  });
});
