import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const source = readFileSync(path.resolve(__dirname, "./onboarding.tsx"), "utf8");

describe("onboarding questionnaire defaults", () => {
  it("preselects editable preference choices without pre-filling identity fields", () => {
    expect(source).toContain("useState<string[]>(DEFAULT_BUYER_INTERESTS)");
    expect(source).toContain("useState('idea')");
    expect(source).toContain("useState<string[]>(DEFAULT_SELLER_GOALS)");
    expect(source).toContain("selectedPlanId",);
    expect(source).toContain("setStyleArr((prev) => prev.includes(item)");
    expect(source).toContain("setGoals((prev) => prev.includes(g)");
    expect(source).toContain('useState(\'\')');
    expect(source).toContain("selectedThemeId,");
    expect(source).toContain("isAppThemeId(draft.selectedThemeId)");
  });
});

describe("seller pre-plan experience", () => {
  it("uses all theme presets and a server-backed one-sample request", () => {
    expect(source).toContain("APP_THEME_PRESETS.map");
    expect(source).toContain("Saved when your seller workspace is created.");
    expect(source).toContain("api.logo.onboardingSample");
    expect(source).toContain("onboarding-generate-sample");
    expect(source).toContain("Your real AI sample is ready.");
    expect(source).toContain("Retry");
    expect(source).toContain("Skip sample · Continue to plans");
    expect(source).toContain('accessibilityRole="radio"');
    expect(source).toContain("accessibilityState={{ selected }}");
    expect(source).toContain("await selectTheme(selectedThemeId)");
  });
});