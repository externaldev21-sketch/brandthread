import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const source = readFileSync(path.resolve(__dirname, "../app/onboarding.tsx"), "utf8");
const slice = (from: string, to: string) => source.slice(source.indexOf(from), source.indexOf(to, source.indexOf(from)));

describe("seller onboarding identity handoff", () => {
  it("syncs the local user, writes the store, then completes as a seller", () => {
    const seller = slice("async function finishSeller()", "async function markComplete");
    const sync = seller.indexOf("const profile = await api.auth.sync({ name });");
    const brandWrite = seller.indexOf("await api.auth.onboarding({");
    const complete = seller.indexOf("await api.auth.completeOnboarding('seller');");
    expect(sync).toBeGreaterThan(-1);
    expect(brandWrite).toBeGreaterThan(sync);
    expect(seller.slice(brandWrite, brandWrite + 160)).toContain("brandName: storeName.replace(/\\s+/g, ' ').trim(), brandStage: stage, username");
    expect(complete).toBeGreaterThan(brandWrite);
  });

  it("sends sellers to store setup with the dashboard underneath", () => {
    const seller = slice("async function finishSeller()", "async function markComplete");
    expect(seller).toContain("router.replace('/(tabs)/' as never);");
    expect(seller).toContain("router.push('/store-setup-brand' as never);");
  });
});

describe("buyer onboarding completion", () => {
  it("saves profile then preferences, and recovers a second sync failure", () => {
    const buyer = slice("async function finishBuyer(retryAttempt = false)", "async function finishSeller()");
    expect(buyer).toContain("const updated = await api.auth.updateProfile({");
    expect(buyer).toContain("accountType: 'buyer', expectedClerkId: profile.clerkId, username");
    expect(buyer.indexOf("await syncBuyerOnboarding(profile.clerkId, styleInterests, api);"))
      .toBeGreaterThan(buyer.indexOf("const updated = await api.auth.updateProfile({"));
    expect(buyer).toContain("await queueBuyerOnboardingSync(profile.clerkId, styleInterests);");
    expect(buyer).toContain("await saveBuyerSurvey(profile.clerkId, survey, styleInterests, api);");
    expect(buyer).toContain("isRecoverableBuyerOnboardingSyncError(e)");
    expect(buyer).toContain("router.replace('/thread-explainer' as never);");
  });

  it("stores the department (Depop Interest) as the buyer's style interest", () => {
    expect(source).toContain("const styleInterests = department ? [department] : [];");
  });

  it("sends a username taken in a race back to the Username step with the real reason", () => {
    expect(source).toContain("if (isUsernameTakenError(e)) { go('USERNAME'); setError('That username was just taken. Choose another.'); return; }");
  });

  it("binds completion to the signed-in Clerk user", () => {
    expect(source).toContain("[ONBOARDING_OWNER_KEY, clerkId]");
    expect(source).toContain("void registerGrantedPushToken(clerkId, api);");
  });
});

describe("real auth only", () => {
  it("creates accounts through Clerk email codes, Apple or Google — never a fake session", () => {
    expect(source).toContain("await signUp.create({ emailAddress: address })");
    expect(source).toContain("await signUp.verifications.sendEmailCode()");
    expect(source).toContain("await signUp.verifications.verifyEmailCode({ code: value })");
    expect(source).toContain("await signIn.emailCode.sendCode({ emailAddress: address })");
    expect(source).toContain("strategy: provider === 'apple' ? APPLE_OAUTH_STRATEGY : 'oauth_google'");
    expect(source).not.toMatch(/setActive\(\{\s*session:\s*['"]/);
  });

  it("asks only for what this Clerk instance still requires", () => {
    expect(source).toContain("const missing = (signUp.missingFields ?? []) as string[];");
    expect(source).toContain("await signUp.password({ password })");
  });

  it("collects the birthday before any account is created and records consent", () => {
    const birthday = slice("function continueFromBirthday()", "async function runSSO");
    expect(birthday).toContain("checkDobInput(dob)");
    expect(birthday).toContain("setPendingDob(check.dob);");
    expect(birthday).toContain("void rememberPendingConsent();");
  });
});
