import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { BUYER_STEPS, DRAFT_VERSION, SELLER_STEPS } from "../lib/onboardingFlow";

const read = (rel: string) => readFileSync(path.resolve(__dirname, rel), "utf8");
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
    expect(source).toContain("useState('idea')");
    expect(source).toContain("useState<string[]>(DEFAULT_SELLER_GOALS)");
    expect(source).toContain("selectedPlanId",);
    expect(source).toContain("setStyleArr((prev) => prev.includes(item)");
    expect(source).toContain("setGoals((prev) => prev.includes(g)");
    expect(source).toContain('useState(\'\')');
    expect(source).toContain("selectedAccent,");
    expect(source).toContain("isStoreAccent(draft.selectedAccent)");
  });
});

describe("seller pre-plan experience", () => {
  it("uses the store accent palette and a server-backed one-sample request", () => {
    expect(source).toContain("STORE_ACCENT_COLORS.map");
    expect(source).toContain("Saved when your seller workspace is created.");
    expect(source).toContain("api.logo.onboardingSample");
    expect(source).toContain("onboarding-generate-sample");
    expect(source).toContain("Your real AI sample is ready.");
    expect(source).toContain("Retry");
    expect(source).toContain("Skip sample · Continue to plans");
    expect(source).toContain('accessibilityRole="radio"');
    expect(source).toContain("accessibilityState={{ selected }}");
    // The storefront accent saves to the store, never the seller's app theme.
    expect(source).toContain("await api.seller.setStoreAccent(selectedAccent)");
    expect(source).not.toContain("selectTheme(");
  });

  it("saves the accepted AI sample as the seller logo and surfaces failures", () => {
    expect(source).toContain("await api.seller.uploadLogo({ uri, mimeType: 'image/png' })");
    expect(source).toContain("await saveSampleAsLogo(sampleUri)");
    expect(source).toContain("We couldn\\u2019t save this sample as your logo.");
  });
});

describe("v7 step order: Welcome opener, then AccountType, then path-specific auth", () => {
  it("Welcome is step 0, AccountType step 1, Auth step 2 for both flows", () => {
    expect(BUYER_STEP_INDEX.WELCOME).toBe(0);
    expect(BUYER_STEP_INDEX.ACCOUNT_TYPE).toBe(1);
    expect(BUYER_STEP_INDEX.AUTH).toBe(2);
    expect(SELLER_STEP_INDEX.WELCOME).toBe(0);
    expect(SELLER_STEP_INDEX.ACCOUNT_TYPE).toBe(1);
    expect(SELLER_STEP_INDEX.AUTH).toBe(2);
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
    expect(source).toContain("router.replace({ pathname: '/plans', params: { fromOnboarding: 'true' } }");
  });
  it("buyer auth 'Use email' reveals the email form", () => {
    expect(source).toContain("'email-form'");
    expect(source).toContain("Use email");
    expect(source).toContain("chooseHeadline");
  });

  it("buyer success routes to thread-explainer, seller to the real subscribe screen", () => {
    expect(source).toContain("router.replace('/(buyer)/'");
    // The plan step only records a choice; finishing hands off to /plans
    // (Stripe Checkout / store purchase), whose "Not now" goes to the tabs.
    expect(source).toContain("router.replace({ pathname: '/plans', params: { fromOnboarding: 'true' } }");
    const plans = readFileSync(path.resolve(__dirname, "./plans.tsx"), "utf8");
    expect(plans).toContain("const isOnboarding = fromOnboarding === 'true';");
    expect(plans).toContain("'onboarding_selected_plan'");
    expect(plans).toContain("router.replace('/(tabs)/'");
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
