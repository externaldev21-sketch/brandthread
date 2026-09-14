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

describe("v6 step order: AccountType first, then path-specific auth", () => {
  it("ACCOUNT_TYPE is step 0 for both flows", () => {
    // Buyer
    expect(source).toContain("ACCOUNT_TYPE: 0,");
    // AUTH is step 1 (not 0)
    expect(source).toContain("AUTH: 1,");
  });

  it("buyer flows through AccountType → BuyerAuth → Name → Style", () => {
    // The AccountTypeStep is rendered at step 0
    expect(source).toContain("step === BUYER_STEP_INDEX.ACCOUNT_TYPE");
    // BuyerAuthStep is rendered at step 1
    expect(source).toContain("step === BUYER_STEP_INDEX.AUTH");
    expect(source).toContain("function BuyerAuthStep");
    expect(source).toContain("step === BUYER_STEP_INDEX.NAME");
    expect(source).toContain("step === BUYER_STEP_INDEX.STYLE");
  });

  it("seller flows through AccountType → SellerAuth → Name → BrandName", () => {
    expect(source).toContain("function SellerAuthStep");
    expect(source).toContain("step === SELLER_STEP_INDEX.AUTH");
    expect(source).toContain("step === SELLER_STEP_INDEX.NAME");
    expect(source).toContain("step === SELLER_STEP_INDEX.BRAND_NAME");
  });

  it("draft version is 6 and migrates v5 drafts correctly", () => {
    expect(source).toContain("DRAFT_VERSION = 6");
    expect(source).toContain("version === 5");
  });

  it("seller auth has confirm password validation", () => {
    expect(source).toContain("Confirm password");
    expect(source).toContain("passwordsMatch");
    expect(source).toContain("Passwords do not match");
  });

  it("buyer auth 'Use email' reveals the email form", () => {
    expect(source).toContain("'email-form'");
    expect(source).toContain("Use email");
    expect(source).toContain("chooseHeadline");
  });

  it("buyer success routes to thread-explainer, seller to tabs", () => {
    expect(source).toContain("router.replace('/thread-explainer'");
    expect(source).toContain("router.replace('/(tabs)/'");
  });

  it("style interests carry emoji and solid-fill selected chip with checkmark", () => {
    expect(source).toContain("STYLE_INTERESTS_WITH_EMOJI");
    expect(source).toContain("emoji: '🏙️'");
    expect(source).toContain("function StyleChip");
    // Solid fill: accentDim background on selected state
    expect(source).toContain("backgroundColor: theme.accentDim");
    // Checkmark icon when selected
    expect(source).toContain('name="check"');
  });

  it("seller name step is pre-filled from auth form first/last name", () => {
    expect(source).toContain("onFirstNamePrefill");
    expect(source).toContain("onLastNamePrefill");
    expect(source).toContain("onFirstNamePrefill(fn)");
    expect(source).toContain("onLastNamePrefill(ln)");
  });

  it("combined name is written to profile with first and last name", () => {
    // Name is composed as 'firstName lastName'
    expect(source).toContain("[firstName.trim(), lastName.trim()].filter(Boolean).join(' ')");
  });
});
