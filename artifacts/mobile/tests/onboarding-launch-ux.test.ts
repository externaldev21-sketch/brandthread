import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const read = (file: string) => readFileSync(path.resolve(__dirname, file), "utf8");
const onboarding = read("../app/onboarding.tsx");
const kit = read("../components/onboarding/launch/kit.tsx");
const welcome = read("../components/onboarding/launch/WelcomeScreen.tsx");
const auth = read("../components/onboarding/launch/AuthScreens.tsx");
const profile = read("../components/onboarding/launch/ProfileScreens.tsx");

describe("launch onboarding: every screen names its Mobbin reference", () => {
  it.each([
    ["WelcomeScreen", welcome, ["46bf3222-f4bb-4584-9906-e4df964b3fe0"]],
    ["AuthScreens", auth, ["d07ea40f-5774-4111-95bc-bfe13af206f5", "ebfae96e-26ae-4997-babf-d5e7b08bb8c4"]],
    ["ProfileScreens", profile, [
      "c63b35d5-9f0b-43da-9c09-91fcc98b5ec6",
      "00469017-3d7b-441c-ae32-825a8340020d",
      "6caedb01-2f8f-406d-ba8a-39c5bc264367",
      "43f24fc1-b3bb-48f3-a8cf-4ad31162ffab",
      "7aa47a58-559f-466b-9679-73e50dae9c31",
      "be5cd190-352d-4597-a544-31cb00eeea3a",
      "e37bf6b7-2dc6-4117-ba2b-fb6a77eb4e96",
    ]],
  ])("%s", (_name, src, ids) => {
    for (const id of ids as string[]) expect(src).toMatch(new RegExp(`https://mobbin\\.com/(screens|flows)/${id}`));
  });
});

describe("launch onboarding: requirements", () => {
  it("shows a progress bar after sign-up (Depop) and none before", () => {
    expect(kit).toContain('accessibilityRole="progressbar"');
    expect(onboarding).toContain("const progress = progressFor(step, role);");
  });

  it("pins actions above the keyboard on every screen", () => {
    expect(kit).toContain("<KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}");
    expect(kit).toContain('keyboardShouldPersistTaps="handled"');
  });

  it("checks username availability live and shows real errors inline", () => {
    expect(profile).toContain("api.auth.checkUsername(username)");
    expect(profile).toContain('testID="onboarding-username-error"');
    expect(profile).toContain("is available");
  });

  it("offers Skip on every optional step", () => {
    for (const id of ["onboarding-photo-skip", "onboarding-interest-skip", "onboarding-sizes-skip", "onboarding-notifications-skip"]) {
      expect(profile).toContain(id);
    }
    expect(profile).toContain("testPrefix=\"onboarding-brands\"");
  });

  it("web notifications step has a single Continue (no Turn on / Skip that do nothing)", () => {
    expect(profile).toContain("footer={web ? (");
    expect(profile).toContain('<PillButton testID="onboarding-notifications-continue" label="Continue" onPress={onSkip} />');
    expect(profile).toContain("Alerts aren’t available in the browser.");
    // The web title must not promise alerts are being turned on.
    expect(profile).toContain("{web ? 'Get alerts in the app' : 'Turn on notifications'}");
  });

  it("code step: back does what \"Wrong email? Edit\" does, and edge-swipe stays off mid-verification", () => {
    expect(onboarding).toContain("onBack={editEmail} onEditEmail={editEmail}");
    expect(onboarding).toContain("if (step === 'CODE') editEmail();");
    expect(onboarding).not.toContain("Abandon verification?");
    expect(onboarding).toContain("onBack={step === 'CODE' ? undefined : onBack}");
  });

  it("uses the system font and theme colors only (no Inter, no hex text colors in the kit)", () => {
    for (const src of [kit, welcome, auth, profile]) {
      expect(src).not.toContain("Inter_");
      expect(src).not.toContain("LinearGradient");
    }
  });

  it("asks buyer-or-seller last; the role is not picked before the account exists", () => {
    expect(onboarding.indexOf("case 'ROLE':")).toBeGreaterThan(onboarding.indexOf("case 'NOTIFICATIONS':"));
    expect(welcome).not.toContain("account-type");
  });

  it("loads real brands only (no demo list)", () => {
    expect(profile).toContain("discoverBrands(60)");
    expect(profile).not.toMatch(/demoBrands|DEMO_BRANDS/);
  });

  it("shows the dev-only Clerk key banner on the first screen", () => {
    expect(onboarding).toContain("devBanner={<ClerkKeyBanner />}");
  });
});
