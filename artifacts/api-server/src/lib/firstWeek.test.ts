import { describe, expect, it } from "vitest";
import { allDone, firstWeekSteps, firstWeekVisible, type FirstWeekFacts } from "./firstWeek";

const now = new Date("2026-10-14T12:00:00Z");
const base: FirstWeekFacts = {
  role: "buyer", accountCreatedAt: new Date("2026-10-12T12:00:00Z"),
  brandsFollowed: 0, publishedPosts: 0, savedItems: 0, hasProfilePhoto: false, products: 0,
  storeSharedAt: null, dismissedAt: null, rewardGrantedAt: null,
};

describe("firstWeekSteps", () => {
  it("gives buyers four steps from real counts", () => {
    const steps = firstWeekSteps({ ...base, brandsFollowed: 3, savedItems: 1 });
    expect(steps.map((s) => [s.id, s.done])).toEqual([
      ["follow_brands", true], ["post_fit", false], ["save_item", true], ["profile_photo", false],
    ]);
  });
  it("needs 3 brands, not 2", () => {
    expect(firstWeekSteps({ ...base, brandsFollowed: 2 })[0]!.done).toBe(false);
  });
  it("gives sellers products, store share, a fit and a logo", () => {
    const steps = firstWeekSteps({ ...base, role: "seller", products: 3, storeSharedAt: now, publishedPosts: 1, hasProfilePhoto: true });
    expect(steps.map((s) => s.id)).toEqual(["add_products", "share_store", "post_fit", "profile_photo"]);
    expect(allDone(steps)).toBe(true);
  });
});

describe("firstWeekVisible", () => {
  it("shows in the first week only", () => {
    expect(firstWeekVisible(base, now)).toBe(true);
    expect(firstWeekVisible({ ...base, accountCreatedAt: new Date("2026-10-01T00:00:00Z") }, now)).toBe(false);
  });
  it("never comes back once dismissed", () => {
    expect(firstWeekVisible({ ...base, dismissedAt: now }, now)).toBe(false);
    expect(firstWeekVisible({ ...base, dismissedAt: now, rewardGrantedAt: now }, now)).toBe(false);
  });
  it("keeps the done state up (past day 7) until it's dismissed", () => {
    expect(firstWeekVisible({ ...base, accountCreatedAt: new Date("2026-10-01T00:00:00Z"), rewardGrantedAt: now }, now)).toBe(true);
  });
});
