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

  it("5 & 6: no payouts, plans or trial during sign-up; the store preview comes first", () => {
    for (const phrase of ["payout-setup", "SellerPlanRecommendationStep", "Continue to plans"]) {
      expect(source).not.toContain(phrase);
    }
    expect(SELLER_STEPS[SELLER_STEPS.length - 1]).toBe("BUILDING");
  });

  it("7: the free logo sample sends the install id so the server limits it per device", () => {
    expect(source).toContain("api.logo.onboardingSample(brandName.trim(), sampleStyle, await getInstallId())");
    expect(source).toContain("onboarding_sample_used");
  });

  it("8: buyer onboarding ends with styles and brands to follow", () => {
    expect(BUYER_STEPS.slice(-3)).toEqual(["STYLE", "SIZES", "BRANDS"]);
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

  it("buyer lands on the thread explainer, seller on the dashboard", () => {
    expect(source).toContain("router.replace('/thread-explainer'");
    expect(source).toContain("router.replace('/(tabs)/'");
  });
});
