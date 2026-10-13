import { describe, expect, it } from "vitest";
import {
  allowedCloseFriendIds, closeFriendIdsFromBody, isSellerAccountType, parseSuggestionsLimit,
  SUGGESTIONS_DEFAULT_LIMIT, SUGGESTIONS_MAX_LIMIT,
} from "./closeFriendsRules";

const ok = { deleted: false, suspended: false };

describe("allowedCloseFriendIds", () => {
  const base = {
    myId: "me",
    followGraph: new Set(["follower"]),
    paidBuyers: new Set(["buyer", "blockedBuyer", "goneBuyer"]),
    blocked: new Set(["blockedBuyer"]),
    profiles: new Map([
      ["me", ok], ["follower", ok], ["buyer", ok], ["blockedBuyer", ok], ["stranger", ok],
      ["goneBuyer", { deleted: true, suspended: false }],
    ]),
  };

  it("allows the follow graph and paid buyers, keeps request order", () => {
    expect(allowedCloseFriendIds({ ...base, requested: ["buyer", "follower"] })).toEqual(["buyer", "follower"]);
  });

  it("rejects self, strangers, blocked, deleted and unknown ids", () => {
    expect(allowedCloseFriendIds({
      ...base, requested: ["me", "stranger", "blockedBuyer", "goneBuyer", "ghost"],
    })).toEqual([]);
  });

  it("a paid buyer is not allowed without the paid-order relation", () => {
    expect(allowedCloseFriendIds({ ...base, paidBuyers: new Set(), requested: ["buyer"] })).toEqual([]);
  });
});

describe("helpers", () => {
  it("isSellerAccountType", () => {
    expect(isSellerAccountType("seller")).toBe(true);
    expect(isSellerAccountType("both")).toBe(true);
    expect(isSellerAccountType("buyer")).toBe(false);
    expect(isSellerAccountType(null)).toBe(false);
  });

  it("parseSuggestionsLimit", () => {
    expect(parseSuggestionsLimit(undefined)).toBe(SUGGESTIONS_DEFAULT_LIMIT);
    expect(parseSuggestionsLimit("abc")).toBe(SUGGESTIONS_DEFAULT_LIMIT);
    expect(parseSuggestionsLimit("-3")).toBe(SUGGESTIONS_DEFAULT_LIMIT);
    expect(parseSuggestionsLimit("5")).toBe(5);
    expect(parseSuggestionsLimit("999")).toBe(SUGGESTIONS_MAX_LIMIT);
  });

  it("closeFriendIdsFromBody accepts userIds or friendIds", () => {
    expect(closeFriendIdsFromBody({ userIds: ["a"] })).toEqual(["a"]);
    expect(closeFriendIdsFromBody({ friendIds: ["b"] })).toEqual(["b"]);
    expect(closeFriendIdsFromBody({ userIds: ["a"], friendIds: ["b"] })).toEqual(["a"]);
    expect(closeFriendIdsFromBody(null)).toBeUndefined();
  });
});
