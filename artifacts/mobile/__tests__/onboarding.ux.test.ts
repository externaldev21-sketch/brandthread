import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { BUYER_STEPS, DRAFT_VERSION, SELLER_STEPS } from "../lib/onboardingFlow";

const read = (rel: string) => readFileSync(path.resolve(__dirname, "../app", rel), "utf8");
const source = read("./onboarding.tsx");
const accountType = read("./account-type.tsx");
const accountSteps = read("../components/onboarding/steps/AccountSteps.tsx");
const profileSteps = read("../components/onboarding/steps/ProfileSteps.tsx");
const sellerSteps = read("../components/onboarding/steps/SellerSteps.tsx");
const allOnboardingCopy = [source, accountType, accountSteps, profileSteps, sellerSteps].join("\n");

describe("Dev's onboarding items", () => {
  it("1: buyer and seller accounts are described as separate, never one combined account", () => {
    expect(allOnboardingCopy).not.toContain("One account for everything");
    expect(accountType).toContain("Buyer and seller accounts are separate. You can have both.");
  });
});
describe("onboarding questionnaire defaults", () => {
  it("preselects editable preference choices without pre-filling identity fields", () => {
    expect(source).toContain("useState<string[]>(DEFAULT_BUYER_INTERESTS)");
    expect(source).toContain("const [brandStage, setBrandStage] = useState('')");
    expect(source).toContain("const [goals, setGoals] = useState<string[]>([])");
    expect(source).toContain("planId ?? recommendedPlanId");
    expect(source).toContain("setStyleArr((prev) => prev.includes(item)");
    expect(source).toContain("setGoals((prev) => prev.includes(g)");
    expect(source).toContain('useState(\'\')');
    expect(source).toContain("selectedAccent,");
    expect(source).toContain("isStoreAccent(draft.selectedAccent)");
  });
});

describe("seller pre-plan experience", () => {
  it("uses the store accent palette and a server-backed one-sample request", () => {
    expect(sellerSteps).toContain("STORE_ACCENT_COLORS.map");
    expect(source).toContain("api.logo.onboardingSample");
    expect(sellerSteps).toContain("onboarding-generate-sample");
    expect(source).toContain("showLogoSample={false}");
    expect(sellerSteps).toContain('accessibilityRole="radio"');
    expect(sellerSteps).toContain("accessibilityState={{ selected: selectedAccent === color }}");
    // The storefront accent saves to the store, never the seller's app theme.
    expect(source).toContain("await api.seller.setStoreAccent(selectedAccent)");
    expect(source).not.toContain("selectTheme(");
  });

  it("saves the accepted AI sample as the seller logo and surfaces failures", () => {
    expect(source).toContain("await api.seller.uploadLogo({ uri, mimeType: 'image/png' })");
    expect(source).toContain("await dataUrlToLocalFile(sampleUri, 'onboarding-logo')");
    expect(source).toMatch(/await api\.seller\.uploadLogo[\s\S]*await api\.auth\.completeOnboarding/);
  });
});

describe("v7 step order: Welcome opener, then AccountType, then path-specific auth", () => {
  it("Welcome and account type precede the buyer account fields and seller questions", () => {
    expect(BUYER_STEPS.indexOf('WELCOME')).toBe(0);
    expect(BUYER_STEPS.indexOf('ACCOUNT_TYPE')).toBe(1);
    expect(BUYER_STEPS.indexOf('EMAIL')).toBe(2);
    expect(SELLER_STEPS.indexOf('WELCOME')).toBe(0);
    expect(SELLER_STEPS.indexOf('ACCOUNT_TYPE')).toBe(1);
    expect(SELLER_STEPS.slice(2, 5)).toEqual(['STAGE', 'GOALS', 'LOCATION']);
    expect(SELLER_STEPS.indexOf('EMAIL')).toBe(5);
  });

  it("2: one question per screen, buyer/seller first, Create new account starts at that question", () => {
    expect(BUYER_STEPS[1]).toBe("ACCOUNT_TYPE");
    expect(SELLER_STEPS[1]).toBe("ACCOUNT_TYPE");
    expect(source).toContain("isAddAccount || start === 'account-type' ? 'ACCOUNT_TYPE' : 'WELCOME'");
    // No screen crams username, email and password together any more.
    expect(source).not.toContain("SharedAuthStep");
    expect(source).not.toContain("Confirm password");
  });

  it("3: the referral field is hidden behind a small 'Have a code?' link and auto-fills from the invite link", () => {
    expect(source).toContain("Have a code?");
    expect(source).toContain("useState(false);\n  const [styleInterests"); // showReferral defaults to hidden
    expect(source).toContain("cleanReferral(referralCodeParam)");
  });

  it("4: no AI-sounding copy, arrows on buttons or 'Already signed in' wording", () => {
    for (const phrase of ["journey", "Already signed in", "Never miss", "Build my workspace"]) {
      expect(allOnboardingCopy).not.toContain(phrase);
    }
    // No arrows inside any string literal (button labels, copy).
    expect(allOnboardingCopy).not.toMatch(/['"`][^'"`\n]*[→›»][^'"`\n]*['"`]/);
  });

  it("5 & 6: no payouts during sign-up; plan + trial only after the store preview, with Dev's exact copy", () => {
    for (const phrase of ["payout-setup", "SellerPlanRecommendationStep", "Continue to plans"]) {
      expect(source).not.toContain(phrase);
    }
    expect(SELLER_STEPS.slice(-2)).toEqual(["BUILDING", "PLAN"]);
    const plan = read("../components/onboarding/steps/PlanStep.tsx");
    expect(plan).toContain("trialCopy(days, reminderDaysBefore)");
    expect(plan).not.toMatch(/label="Skip|'Skip'/);
    expect(source).toContain("void trial.start(planId ?? recommendedPlanId)");
  });

  it("7: the free logo sample sends the install id so the server limits it per device", () => {
    expect(source).toContain("api.logo.onboardingSample(brandName.trim(), sampleStyle, await getInstallId())");
    expect(source).toContain("onboarding_sample_used");
  });

  it("8: buyer onboarding ends with styles and brands to follow", () => {
    expect(BUYER_STEPS.slice(-5)).toEqual(["STYLE", "TASTE", "SIZES", "BRANDS", "FEED_PREVIEW"]);
    expect(source).toContain("<BrandsToFollowStep");
  });

  it("9: no notification permission step in onboarding", () => {
    expect(source).not.toContain("NotificationsStep");
    expect(source).not.toContain("requestPermissionsAsync");
  });

  it("10: answers are saved as a draft (v9) and restored on reopen, password excluded", () => {
    expect(DRAFT_VERSION).toBe(9);
    expect(source).toContain("sanitizeDraftForStorage(draft)");
    expect(source).toContain("resolveResumeStep(");
    expect(source).toContain("password, setPassword] = useState(''); // memory only, never in a draft");
  });
});

describe("account creation order and safety", () => {
  it("creates the Clerk account only after birthday and terms (age gate before any account exists)", () => {
    const terms = source.indexOf("async function agreeToTerms()");
    const finalize = source.indexOf("await finalizeEmailAccount()", terms);
    expect(source.indexOf("signUp.create({ emailAddress")).toBeGreaterThan(0);
    expect(finalize).toBeGreaterThan(terms);
    expect(source).toContain("signUp.password({ password, legalAccepted: true })");
    expect(source).toContain("checkDobInput(wheelDateToDobInput(birthday), { seller: flow === 'seller' })");
  });

  it("Apple and Google go through birthday and terms before the OAuth sheet", () => {
    expect(source).toContain("goTo('BIRTHDAY', 1);");
    expect(source).toContain("if (authMethod !== 'email') { await runOAuth(authMethod); return; }");
  });

  it("buyer lands directly on the feed, seller on the dashboard", () => {
    expect(source).toContain("router.replace('/(buyer)/'");
    expect(source).toContain("thread_explainer_seen:${userId}");
    expect(source).toContain("router.replace('/(tabs)/'");
  });
  it("buyer auth opens the email question directly", () => {
    expect(BUYER_STEPS[2]).toBe('EMAIL');
    expect(source).toContain("case 'EMAIL':");
    expect(accountSteps).toContain('keyboardType="email-address"');
  });

  it("buyer success retains the explainer flag and seller billing stays an explicit action", () => {
    expect(source).toContain("router.replace('/(buyer)/'");
    // Keep the approved dashboard billing flow, not an automatic paywall.
    expect(source).toContain("router.replace('/(tabs)/'");
    const plans = read("./plans.tsx");
    expect(plans).toContain("const isOnboarding = fromOnboarding === 'true';");
    expect(plans).toContain("'onboarding_selected_plan'");
    expect(plans).toContain("router.replace('/(tabs)/'");
  });

  it("style interests remain editable in the active interests step", () => {
    expect(source).toContain("setStyleArr((prev) => prev.includes(item)");
    expect(source).toContain("styleInterests");
    expect(source).toContain("case 'BUYER_INTERESTS':");
    expect(source).toContain("styleArr.includes(item)");
  });

  it("uses one editable name question and restores its draft", () => {
    expect(source).toContain("name={fullName} onChange={setFullName}");
    expect(source).toContain("setFullName([draft.firstName, draft.lastName].filter(Boolean).join(' '))");
  });

  it("combined name is written to profile with first and last name", () => {
    // Name is composed as 'firstName lastName'
    expect(source).toMatch(/name:\s*fullName/);
  });
});
