import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const source = readFileSync(path.resolve(__dirname, "./onboarding.tsx"), "utf8");
const signUp = readFileSync(path.resolve(__dirname, "../components/onboarding/SignUpStep.tsx"), "utf8");
const profile = readFileSync(path.resolve(__dirname, "../components/onboarding/ProfileStep.tsx"), "utf8");

describe("onboarding defaults", () => {
  it("never sends preferences the person didn't pick", () => {
    expect(source).toContain("const styleInterests: string[] = [];");
    expect(source).not.toContain("DEFAULT_BUYER_INTERESTS");
    expect(source).not.toContain("DEFAULT_SELLER_GOALS");
  });

  it("preselects Shop, the common case, without pre-filling identity fields", () => {
    expect(source).toContain("useState<Flow | null>(deviceProbeFlow ?? 'buyer')");
    expect(source).toContain("const [firstName, setFirstName] = useState('');");
    expect(source).toContain("const [username, setUsername] = useState('');");
  });
});

describe("sign up", () => {
  it("offers Apple, Google and email on one screen, Apple first", () => {
    expect(signUp).toContain("'Continue with Apple'");
    expect(signUp).toContain("'Continue with Google'");
    expect(signUp).toContain("'Continue with email'");
  });

  it("checks the birthday (seller rules for sellers) before any account is created", () => {
    expect(signUp).toContain("checkDobInput(dobText, { seller: flow === 'seller' })");
    expect(signUp).toContain("setPendingDob(check.dob)");
    expect(source).toContain("await submitPendingAge(api);");
  });

  it("email is Grailed's sheet: Email, Password, NEXT, then the 6-digit code", () => {
    expect(signUp).toContain('label="Email"');
    expect(signUp).toContain('label="Password"');
    expect(signUp).toContain('label="Next"');
    expect(signUp).toContain('label="Verification code"');
    expect(signUp).toContain("signUp.verifications.sendEmailCode()");
    expect(signUp).toContain("signUp.verifications.verifyEmailCode({ code })");
  });

  it("keeps the signup analytics events", () => {
    expect(signUp).toContain("track('signup_started', { method: 'email' })");
    expect(signUp).toContain("track('signup_completed', { method: 'email' })");
    expect(signUp).toContain("track('signup_started', { method: provider.toLowerCase() })");
    expect(signUp).toContain("track('signup_completed', { method: provider.toLowerCase() })");
  });

  it("routes an existing email to sign in", () => {
    expect(signUp).toContain("'form_identifier_exists'");
    expect(signUp).toContain("router.replace('/sign-in' as never)");
  });
});

describe("profile", () => {
  it("asks for name and @username with live availability", () => {
    expect(profile).toContain("useUsernameLiveCheck(username)");
    expect(profile).toContain('prefix="@"');
    expect(profile).toContain("is available");
  });
});

describe("finish", () => {
  it("buyers land straight on the Threads feed (explainer marked seen), sellers on tabs", () => {
    expect(source).toContain("await AsyncStorage.setItem(`thread_explainer_seen:${userId}`, 'true')");
    expect(source).toContain("router.replace('/(buyer)/' as never)");
    expect(source).not.toContain("router.replace('/thread-explainer'");
    expect(source).toContain("router.replace('/(tabs)/'");
  });

  it("combined name is written to the profile", () => {
    expect(source).toContain("[firstName.trim(), lastName.trim()].filter(Boolean).join(' ')");
  });
});
