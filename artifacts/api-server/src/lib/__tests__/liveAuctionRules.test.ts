import { describe, expect, it } from "vitest";
import {
  ANTI_SNIPE_SECONDS, AUCTION_DURATIONS, PAY_WINDOW_HOURS, bidRejection, bidderDisplayName, extendedEndsAt,
  minIncrementCents, minNextBidCents, oneOfOneVariant, parseStartInput, settleOutcome,
} from "../liveAuctionRules";

const NOW = new Date("2026-10-13T12:00:00.000Z");
const open = {
  status: "open", endsAt: new Date(NOW.getTime() + 8000), sellerId: "host", leaderUserId: null as string | null,
  startingBidCents: 500, currentBidCents: null as number | null, bidCount: 0,
};

describe("increments", () => {
  it("steps up by price band", () => {
    expect(minIncrementCents(0)).toBe(100);
    expect(minIncrementCents(1_999)).toBe(100);
    expect(minIncrementCents(2_000)).toBe(200);
    expect(minIncrementCents(9_999)).toBe(200);
    expect(minIncrementCents(10_000)).toBe(500);
    expect(minIncrementCents(50_000)).toBe(1_000);
    expect(minIncrementCents(100_000)).toBe(2_500);
  });
  it("the first bid may equal the starting bid; later bids must beat the current one by the increment", () => {
    expect(minNextBidCents(open)).toBe(500);
    expect(minNextBidCents({ ...open, currentBidCents: 500, bidCount: 1 })).toBe(600);
    expect(minNextBidCents({ ...open, currentBidCents: 2_400, bidCount: 3 })).toBe(2_600);
    expect(minNextBidCents({ ...open, currentBidCents: 12_000, bidCount: 9 })).toBe(12_500);
  });
});

describe("bidRejection", () => {
  it("accepts a valid bid", () => {
    expect(bidRejection({ auction: open, bidderId: "a", amountCents: 500, now: NOW })).toBeNull();
    expect(bidRejection({ auction: open, bidderId: "a", amountCents: 9_000, now: NOW })).toBeNull();
  });
  it("rejects the host bidding on their own auction", () => {
    expect(bidRejection({ auction: open, bidderId: "host", amountCents: 500, now: NOW })).toBe("SELF_BID");
  });
  it("rejects low, closed, already-leading and nonsense bids", () => {
    expect(bidRejection({ auction: open, bidderId: "a", amountCents: 499, now: NOW })).toBe("BID_TOO_LOW");
    expect(bidRejection({ auction: { ...open, currentBidCents: 500, bidCount: 1, leaderUserId: "b" }, bidderId: "a", amountCents: 550, now: NOW })).toBe("BID_TOO_LOW");
    expect(bidRejection({ auction: { ...open, currentBidCents: 500, bidCount: 1, leaderUserId: "a" }, bidderId: "a", amountCents: 600, now: NOW })).toBe("ALREADY_LEADING");
    expect(bidRejection({ auction: { ...open, endsAt: NOW }, bidderId: "a", amountCents: 500, now: NOW })).toBe("AUCTION_CLOSED");
    expect(bidRejection({ auction: { ...open, status: "sold" }, bidderId: "a", amountCents: 500, now: NOW })).toBe("AUCTION_CLOSED");
    expect(bidRejection({ auction: open, bidderId: "a", amountCents: 5.5, now: NOW })).toBe("INVALID_AMOUNT");
    expect(bidRejection({ auction: open, bidderId: "a", amountCents: -1, now: NOW })).toBe("INVALID_AMOUNT");
  });
});

describe("anti-snipe", () => {
  it(`a bid in the last ${ANTI_SNIPE_SECONDS}s resets the clock to ${ANTI_SNIPE_SECONDS}s`, () => {
    const endsAt = new Date(NOW.getTime() + 3000);
    expect(extendedEndsAt(endsAt, NOW, false).getTime()).toBe(NOW.getTime() + ANTI_SNIPE_SECONDS * 1000);
  });
  it("leaves the clock alone with more time left, and always in sudden death", () => {
    const far = new Date(NOW.getTime() + 25_000);
    expect(extendedEndsAt(far, NOW, false)).toBe(far);
    const near = new Date(NOW.getTime() + 2000);
    expect(extendedEndsAt(near, NOW, true)).toBe(near);
  });
});

describe("1-of-1", () => {
  it("needs exactly one unit across all variants", () => {
    expect(oneOfOneVariant([{ id: "v1", stock: 1 }])).toBe("v1");
    expect(oneOfOneVariant([{ id: "v1", stock: 0 }, { id: "v2", stock: 1 }])).toBe("v2");
    expect(oneOfOneVariant([{ id: "v1", stock: 2 }])).toBeNull();
    expect(oneOfOneVariant([{ id: "v1", stock: 1 }, { id: "v2", stock: 1 }])).toBeNull();
    expect(oneOfOneVariant([{ id: "v1", stock: 0 }])).toBeNull();
    expect(oneOfOneVariant([])).toBeNull();
  });
});

describe("start input", () => {
  const productId = "11111111-1111-1111-1111-111111111111";
  it("offers Whatnot's 10/15/30/60 second timers", () => {
    expect([...AUCTION_DURATIONS]).toEqual([10, 15, 30, 60]);
  });
  it("validates product, starting bid and duration", () => {
    expect(parseStartInput({ productId, startingBidCents: 100, durationSeconds: 15, suddenDeath: true }))
      .toEqual({ ok: true, value: { productId, startingBidCents: 100, durationSeconds: 15, suddenDeath: true } });
    expect(parseStartInput({ productId, startingBidCents: 99, durationSeconds: 15 }).ok).toBe(false);
    expect(parseStartInput({ productId, startingBidCents: 100, durationSeconds: 20 }).ok).toBe(false);
    expect(parseStartInput({ productId: "x", startingBidCents: 100, durationSeconds: 15 }).ok).toBe(false);
    expect(parseStartInput({ productId, startingBidCents: 150.5, durationSeconds: 15 }).ok).toBe(false);
  });
});

describe("settle", () => {
  it("sells to the leader with a pay window, else unsold", () => {
    expect(settleOutcome({ leaderUserId: "a", currentBidCents: 900 }, NOW)).toEqual({
      status: "sold", winnerUserId: "a", payBy: new Date(NOW.getTime() + PAY_WINDOW_HOURS * 3_600_000),
    });
    expect(settleOutcome({ leaderUserId: null, currentBidCents: null }, NOW)).toEqual({ status: "unsold", winnerUserId: null, payBy: null });
  });
  it("shows a handle, else a first name — never a full name", () => {
    expect(bidderDisplayName({ username: "ana.l", displayName: "Ana Lopez" })).toBe("ana.l");
    expect(bidderDisplayName({ displayName: "Ana Lopez" })).toBe("Ana");
    expect(bidderDisplayName(null)).toBe("Someone");
  });
});
