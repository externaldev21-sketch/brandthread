import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const source = readFileSync(path.resolve(__dirname, "./onboarding.tsx"), "utf8");

describe("seller onboarding identity handoff", () => {
  it("syncs the local seller user before writing the brand name", () => {
    const finishSeller = source.indexOf("async function finishSeller()");
    expect(finishSeller).toBeGreaterThan(-1);

    const sync = source.indexOf(
      "const profile = await api.auth.sync({ name });",
      finishSeller,
    );
    const brandWrite = source.indexOf("await api.auth.onboarding({", finishSeller);

    expect(sync).toBeGreaterThan(finishSeller);
    expect(brandWrite).toBeGreaterThan(sync);
    expect(source.slice(brandWrite, brandWrite + 260)).toContain(
      "brandName: brandName.trim()",
    );
    const complete = source.indexOf(
      "await api.auth.completeOnboarding('seller');",
      brandWrite,
    );
    expect(complete).toBeGreaterThan(brandWrite);
  });
});

describe("signup identity inputs", () => {
  it("keeps username and referral fields editable, controlled, and above the animated layer", () => {
    const usernameInput = source.indexOf('testID="onboarding-username-input"');
    const referralInput = source.indexOf('testID="onboarding-referral-input"');

    expect(usernameInput).toBeGreaterThan(-1);
    expect(referralInput).toBeGreaterThan(usernameInput);
    expect(source.slice(usernameInput, referralInput)).toContain("value={username}");
    expect(source.slice(usernameInput, referralInput)).toContain("onUsernameChange(cleaned)");
    expect(source.slice(usernameInput, referralInput)).toContain("editable");

    const referralSection = source.slice(referralInput, referralInput + 600);
    expect(referralSection).toContain("value={referralCode}");
    expect(referralSection).toContain("onReferralCodeChange(");
    expect(referralSection).toContain("editable");

    expect(source).toContain("isAuthStep && sm.interactiveStepWrap");
    expect(source).toContain("translateX: transitionProgress.interpolate");
    expect(source).toContain(
      "interactiveStepWrap: { position: 'relative', zIndex: 2 }",
    );
  });
});

describe("buyer onboarding completion recovery", () => {
  it("uses the buyer preferences route and retries the request before falling through", () => {
    const finishBuyer = source.indexOf("async function finishBuyer(retryAttempt = false)");
    expect(finishBuyer).toBeGreaterThan(-1);

    const buyerSlice = source.slice(finishBuyer, source.indexOf("async function finishSeller()", finishBuyer));
    expect(buyerSlice).toContain("await queueBuyerOnboardingSync(profile.clerkId, styleInterests)");
    expect(buyerSlice).toContain("await syncBuyerOnboarding(profile.clerkId, styleInterests, api)");
    expect(buyerSlice).toContain("expectedClerkId: profile.clerkId");
    expect(buyerSlice).toContain("api.referrals.apply(referralCode.trim(), profile.clerkId)");
    expect(buyerSlice).toContain("onPress: () => { void finishBuyer(true); }");
    expect(buyerSlice).toContain("retryAttempt");
    expect(buyerSlice).toContain("failureStage === 'preferences-or-completion'");
    expect(buyerSlice).toContain("&& profileId");
    expect(buyerSlice).toContain("pendingSyncQueued");
    expect(buyerSlice).toContain("isRecoverableBuyerOnboardingSyncError(error)");
    expect(buyerSlice).toContain("router.replace('/thread-explainer'");
    expect(source).toContain("console.error('[buyer-onboarding] save failed'");
    expect(buyerSlice).not.toContain("api.seller.saveOnboardingData({ styleInterests })");
  });
});