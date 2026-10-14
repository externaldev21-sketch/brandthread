import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const source = readFileSync(path.resolve(__dirname, "./onboarding.tsx"), "utf8");

describe("seller onboarding identity handoff", () => {
  it("syncs the local seller user before writing the brand name", () => {
    const commitSeller = source.indexOf("async function commitSeller()");
    expect(commitSeller).toBeGreaterThan(-1);

    const sync = source.indexOf(
      "const profile = await api.auth.sync({ name });",
      commitSeller,
    );
    const brandWrite = source.indexOf("await api.auth.onboarding({", commitSeller);

    expect(sync).toBeGreaterThan(commitSeller);
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
  it("keeps the username field editable and controlled", () => {
    const profile = readFileSync(path.resolve(__dirname, "../components/onboarding/ProfileStep.tsx"), "utf8");
    const usernameInput = profile.indexOf('testID="onboarding-username-input"');
    expect(usernameInput).toBeGreaterThan(-1);
    const field = profile.slice(usernameInput, usernameInput + 600);
    expect(field).toContain("value={username}");
    expect(field).toContain("onUsernameChange(cleanUsername(v))");
    expect(field).toContain("editable");
    // Mirrored to device storage so the postAuth remount can't drop it.
    expect(source).toContain("void AsyncStorage.setItem(PENDING_USERNAME_KEY, value)");
  });
});

describe("buyer onboarding completion recovery", () => {
  it("uses the buyer preferences route and retries the request before falling through", () => {
    const finishBuyer = source.indexOf("async function finishBuyer(retryAttempt = false)");
    expect(finishBuyer).toBeGreaterThan(-1);

    const buyerSlice = source.slice(finishBuyer, source.indexOf("async function commitSeller()", finishBuyer));
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
    expect(buyerSlice.match(/await landOnFeed\(/g)).toHaveLength(2);
    expect(source).toContain("console.error('[buyer-onboarding] save failed'");
    expect(buyerSlice).not.toContain("api.seller.saveOnboardingData({ styleInterests })");
  });
});