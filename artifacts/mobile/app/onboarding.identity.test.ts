import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const source = readFileSync(path.resolve(__dirname, "./onboarding.tsx"), "utf8");
const profileSteps = readFileSync(path.resolve(__dirname, "../components/onboarding/steps/ProfileSteps.tsx"), "utf8");

describe("seller onboarding identity handoff", () => {
  it("syncs the local seller user before writing the brand name, and completes only after the store is built", () => {
    const basics = source.indexOf("async function saveProfileBasics()");
    expect(basics).toBeGreaterThan(-1);
    const sync = source.indexOf("const profile = await api.auth.sync({ name });", basics);
    const brandWrite = source.indexOf("await api.auth.onboarding({", basics);
    expect(sync).toBeGreaterThan(basics);
    expect(brandWrite).toBeGreaterThan(sync);
    expect(source.slice(brandWrite, brandWrite + 200)).toContain("brandName: brandName.trim()");

    const finishSeller = source.indexOf("async function finishSeller()");
    const complete = source.indexOf("await api.auth.completeOnboarding('seller');", finishSeller);
    expect(complete).toBeGreaterThan(finishSeller);
  });
});

describe("signup identity inputs", () => {
  it("username is its own controlled step; the invite code is a controlled field behind 'Have a code?'", () => {
    expect(profileSteps).toContain('testID="onboarding-username-input"');
    expect(profileSteps).toContain("value={username}");
    expect(source).toContain('testID="onboarding-referral-input"');
    const referral = source.slice(source.indexOf('testID="onboarding-referral-input"'), source.indexOf('testID="onboarding-referral-input"') + 400);
    expect(referral).toContain("value={referralCode}");
    expect(referral).toContain("setReferralCode(cleanReferral(v))");
    expect(source).toContain("translateX: transitionProgress.interpolate");
  });

  it("a username taken between the check and the save stays on the username step with a clear message", () => {
    expect(source).toContain("That username was just taken. Try another.");
    expect(source).toContain("if (ok) goNext('USERNAME');");
  });
});

describe("buyer onboarding completion recovery", () => {
  it("uses the buyer preferences route and retries the request before falling through", () => {
    const finishBuyer = source.indexOf("async function finishBuyer(retryAttempt = false)");
    expect(finishBuyer).toBeGreaterThan(-1);

    const buyerSlice = source.slice(finishBuyer, source.indexOf("// ── Seller: build the store", finishBuyer));
    expect(buyerSlice).toContain("await queueBuyerOnboardingSync(profile.clerkId, styleInterests)");
    expect(buyerSlice).toContain("await syncBuyerOnboarding(profile.clerkId, styleInterests, api)");
    expect(buyerSlice).toContain("api.referrals.apply(referralCode.trim(), profile.clerkId)");
    expect(buyerSlice).toContain("onPress: () => { void finishBuyer(true); }");
    expect(buyerSlice).toContain("failureStage === 'preferences-or-completion'");
    expect(buyerSlice).toContain("&& profileId");
    expect(buyerSlice).toContain("pendingSyncQueued");
    expect(buyerSlice).toContain("isRecoverableBuyerOnboardingSyncError(error)");
    expect(buyerSlice).toContain("router.replace('/thread-explainer'");
    expect(source).toContain("console.error('[buyer-onboarding] save failed'");
    expect(source).toContain("expectedClerkId: profile.clerkId");
    expect(buyerSlice).not.toContain("api.seller.saveOnboardingData({ styleInterests })");
  });
});
