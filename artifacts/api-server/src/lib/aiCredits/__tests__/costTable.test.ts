import { describe, expect, it } from "vitest";
import { PLAN_CATALOGUE, PLAN_IDS } from "../../planCatalogue";
import { AI_IMAGE_MODEL_PRICES } from "../../admin/aiPricing";
import {
  AI_COST_TABLE, CREDIT_USD, MAX_AI_COST_SHARE, creditsForTool, maxAllowanceForPrice, worstCaseUsd,
} from "../costTable";
import { AI_TOOL_RULES, PLAN_CREDIT_POLICY, trialAllowance } from "../catalogue";

const creditTools = [...new Set(AI_TOOL_RULES.filter((r) => r.kind === "credits").map((r) => r.tool))];

describe("AI cost table", () => {
  it("has a cost recipe for every credit and metered tool", () => {
    for (const rule of AI_TOOL_RULES) {
      if (rule.kind === "text") continue;
      expect(AI_COST_TABLE[rule.tool], rule.tool).toBeDefined();
    }
  });

  it("charges every tool at least its worst-case provider cost", () => {
    for (const rule of AI_TOOL_RULES) {
      if (rule.kind !== "credits") continue;
      const usd = worstCaseUsd(AI_COST_TABLE[rule.tool]!);
      expect(rule.cost, rule.tool).toBe(creditsForTool(rule.tool));
      expect(rule.cost * CREDIT_USD, rule.tool).toBeGreaterThanOrEqual(usd);
    }
  });

  it("prices image tools against the dearest model in the fallback chain", () => {
    const g2 = worstCaseUsd(AI_COST_TABLE.logo!, ["gpt-image-2"]);
    const g1 = worstCaseUsd(AI_COST_TABLE.logo!, ["gpt-image-1"]);
    expect(worstCaseUsd(AI_COST_TABLE.logo!, ["gpt-image-1", "gpt-image-2"])).toBe(Math.max(g1, g2));
    // An unpriced model is never cheaper than the dearest priced one.
    expect(worstCaseUsd(AI_COST_TABLE.logo!, ["some-future-model"])).toBeGreaterThanOrEqual(Math.max(g1, g2));
    expect(Object.keys(AI_IMAGE_MODEL_PRICES)).toEqual(expect.arrayContaining(["gpt-image-2", "gpt-image-1.5", "gpt-image-1"]));
  });

  it("counts the visual-QA correction pass in the worst case", () => {
    const recipe = AI_COST_TABLE.bg_remove!;
    if (recipe.kind !== "image") throw new Error("bg_remove must be an image recipe");
    const once = worstCaseUsd({ ...recipe, attempts: 1 });
    expect(worstCaseUsd(recipe)).toBeCloseTo(2 * once, 10);
  });

  // The invariant: for every paid tier, spending the whole monthly allowance
  // on the most expensive (per credit) tool costs under 20% of the tier price.
  it.each(PLAN_IDS)("keeps %s provider cost under 20%% of its price for every tool", (plan) => {
    const allowance = PLAN_CREDIT_POLICY[plan].monthlyAllowance;
    expect(allowance).toBeGreaterThan(0);
    const priceUsd = PLAN_CATALOGUE[plan].amountCents / 100;
    for (const tool of creditTools) {
      const rule = AI_TOOL_RULES.find((r) => r.tool === tool)!;
      const usdPerCredit = worstCaseUsd(AI_COST_TABLE[tool]!) / rule.cost;
      expect(allowance * usdPerCredit, `${plan} / ${tool}`).toBeLessThan(MAX_AI_COST_SHARE * priceUsd);
    }
    // The trial allowance is a slice of the same allowance, so it is bounded too.
    expect(trialAllowance(plan)).toBeLessThanOrEqual(allowance);
  });

  it("derives allowances from planCatalogue prices, never above the 20% line", () => {
    for (const plan of PLAN_IDS) {
      expect(PLAN_CREDIT_POLICY[plan].monthlyAllowance).toBeLessThanOrEqual(maxAllowanceForPrice(PLAN_CATALOGUE[plan].amountCents));
    }
    // A price change moves the allowance with it.
    expect(maxAllowanceForPrice(10_000)).toBe(1900);
  });

  it("has no unlimited plan", () => {
    for (const policy of Object.values(PLAN_CREDIT_POLICY)) expect(policy.monthlyAllowance).not.toBeNull();
  });
});
