import { describe, expect, it } from "vitest";
import {
  MILESTONES,
  highestMilestone,
  isMilestoneKey,
  milestoneLabel,
  planSurface,
  reachedMilestones,
} from "./sellerMilestones";

describe("reachedMilestones", () => {
  it.each([
    [{ orders: 0, salesCents: 0 }, []],
    [{ orders: 1, salesCents: 0 }, ["first_sale"]],
    [{ orders: 1, salesCents: 99_999 }, ["first_sale"]],
    [{ orders: 1, salesCents: 100_000 }, ["first_sale", "sales_1k"]],
    [{ orders: 99, salesCents: 999_999 }, ["first_sale", "sales_1k"]],
    [{ orders: 100, salesCents: 0 }, ["first_sale", "orders_100"]],
    [{ orders: 100, salesCents: 1_000_000 }, ["first_sale", "sales_1k", "orders_100", "sales_10k"]],
    [{ orders: 999, salesCents: 9_999_999 }, ["first_sale", "sales_1k", "orders_100", "sales_10k"]],
    [{ orders: 1_000, salesCents: 0 }, ["first_sale", "orders_100", "orders_1000"]],
    [{ orders: 1_000, salesCents: 10_000_000 }, ["first_sale", "sales_1k", "orders_100", "sales_10k", "orders_1000", "sales_100k"]],
  ])("%j reaches %j", (totals, keys) => {
    expect(reachedMilestones(totals)).toEqual(keys);
  });

  it("has exactly the six milestones, with their card labels", () => {
    expect(MILESTONES.map((m) => [m.key, m.label])).toEqual([
      ["first_sale", "First sale"],
      ["sales_1k", "$1,000 in sales"],
      ["orders_100", "100 orders"],
      ["sales_10k", "$10,000 in sales"],
      ["orders_1000", "1,000 orders"],
      ["sales_100k", "$100,000 in sales"],
    ]);
    expect(milestoneLabel("sales_10k")).toBe("$10,000 in sales");
  });
});

describe("highest / planSurface", () => {
  it("picks the highest and supersedes the rest", () => {
    expect(highestMilestone(["first_sale", "sales_10k", "orders_100"])).toBe("sales_10k");
    expect(planSurface(["first_sale", "sales_1k", "orders_100", "sales_10k"])).toEqual({
      surface: "sales_10k",
      supersede: ["first_sale", "sales_1k", "orders_100"],
    });
    expect(planSurface([])).toEqual({ surface: null, supersede: [] });
  });
});

describe("isMilestoneKey", () => {
  it("accepts only known keys", () => {
    expect(isMilestoneKey("orders_100")).toBe(true);
    expect(isMilestoneKey("orders_10")).toBe(false);
    expect(isMilestoneKey(undefined)).toBe(false);
  });
});
