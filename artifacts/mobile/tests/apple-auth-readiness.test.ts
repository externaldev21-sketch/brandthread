import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const onboardingSource = readFileSync(
  path.resolve(__dirname, "../app/onboarding.tsx"),
  "utf8",
);
const signInSource = readFileSync(
  path.resolve(__dirname, "../app/sign-in.tsx"),
  "utf8",
);
const layoutSource = readFileSync(
  path.resolve(__dirname, "../app/_layout.tsx"),
  "utf8",
);
const authRouteSource = readFileSync(
  path.resolve(__dirname, "../../api-server/src/routes/auth.ts"),
  "utf8",
);

describe("Apple auth end-to-end code contract", () => {
  it("starts onboarding with Apple, activates only a completed session, then asks for role", () => {
    expect(onboardingSource).toContain("strategy: APPLE_OAUTH_STRATEGY");
    expect(onboardingSource).toContain("if (result?.createdSessionId && result?.setActive)");
    expect(onboardingSource).toContain("if (isOAuthFlowComplete(result))");
    // After v6 restructure: AccountType is step 0, so after OAuth the user
    // goes to NAME step (no longer ACCOUNT_TYPE). AccountType still exists.
    expect(onboardingSource).toContain("BUYER_STEP_INDEX.ACCOUNT_TYPE");
  });

  it("syncs buyer and seller profiles before binding completion to the Clerk user", () => {
    expect(onboardingSource).toContain(
      "const profile = await api.auth.sync({ name });",
    );
    expect(onboardingSource.match(/const profile = await api\.auth\.sync\(\{ name \}\);/g))
      .toHaveLength(2);
    const buyerCompletion = onboardingSource.indexOf(
      "await api.auth.completeOnboarding('buyer');",
    );
    const buyerProfile = onboardingSource.indexOf("const updated = await api.auth.updateProfile({");
    expect(buyerCompletion).toBeGreaterThan(buyerProfile);
    const sellerCompletion = onboardingSource.indexOf(
      "await api.auth.completeOnboarding('seller');",
    );
    const sellerBrandWrite = onboardingSource.indexOf("await api.auth.onboarding({");
    expect(sellerCompletion).toBeGreaterThan(sellerBrandWrite);
    expect(onboardingSource).toContain("[ONBOARDING_OWNER_KEY, profile.clerkId]");
    // v6: buyers go to thread-explainer first, sellers still go to /(tabs)/
    expect(onboardingSource).toContain("router.replace('/thread-explainer'");
    expect(onboardingSource).toContain("router.replace('/(tabs)/'");
  });

  it("returns an existing Apple identity to its stored role without creating another local user", () => {
    expect(signInSource).toContain("strategy: 'oauth_google' | 'oauth_apple'");
    expect(signInSource).toContain("await setActive({ session: createdSessionId })");
    expect(layoutSource).toContain(
      "const dest = storedRole === 'buyer' ? '/(buyer)/' : '/(tabs)/';",
    );
    expect(layoutSource).toContain("profile.onboardingComplete && serverRole");
    expect(layoutSource).toContain("[ONBOARDING_OWNER_KEY, profile.clerkId]");
    expect(authRouteSource).toContain(
      ".onConflictDoNothing({ target: users.clerkId })",
    );
    expect(authRouteSource).toContain('"/onboarding/complete"');
    expect(authRouteSource).toContain("onboardingComplete: true");
  });

  it("keeps every Apple redirect on the shared Brandthread callback helper", () => {
    expect(onboardingSource).toContain(
      "redirectUrl: makeBrandthreadRedirectUri(AuthSession.makeRedirectUri)",
    );
    expect(signInSource).toContain(
      "redirectUrl: makeBrandthreadRedirectUri(AuthSession.makeRedirectUri)",
    );
    expect(onboardingSource).not.toContain(
      "AuthSession.makeRedirectUri({ scheme: 'brandthread' })",
    );
    expect(signInSource).not.toContain(
      "AuthSession.makeRedirectUri({ scheme: 'brandthread' })",
    );
  });
});
