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

    expect(source).toContain(
      "isAuthStep ? sm.interactiveStepWrap : { transform: [{ translateX: slideAnim }] }",
    );
    expect(source).toContain(
      "interactiveStepWrap: { position: 'relative', zIndex: 2 }",
    );
  });
});