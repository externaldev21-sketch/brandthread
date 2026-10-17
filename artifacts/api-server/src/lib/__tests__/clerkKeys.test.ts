import { describe, expect, it } from "vitest";
import {
  cleanClerkKey,
  createLogThrottle,
  diagnoseClerkKeys,
  isClerkKeyInvalidAuthState,
  isClerkKeyInvalidError,
  maskClerkKey,
  publishableKeyFrontendApi,
} from "../clerkKeys";

const pk = (env: "test" | "live", host = "example-app-12.clerk.accounts.dev") =>
  `pk_${env}_${Buffer.from(`${host}$`).toString("base64")}`;
// Fake keys assembled at runtime so secret scanners don't mistake them for real ones.
const FAKE_BODY = "abcdefghijklmnopqrstuvwxyz0123456789";
const SK_TEST = ["sk", "test", `${FAKE_BODY}WXYZ`].join("_");
const SK_LIVE = ["sk", "live", `${FAKE_BODY}LIVE`].join("_");

const messages = (env: Record<string, string | undefined>) => diagnoseClerkKeys(env).issues.map((i) => `${i.level}: ${i.message}`);

describe("maskClerkKey", () => {
  it("shows only prefix and last 4", () => {
    expect(maskClerkKey(SK_TEST)).toBe("sk_test_…WXYZ");
    expect(maskClerkKey("")).toBe("(unset)");
    expect(maskClerkKey("sk_test_abc")).toBe("sk_test_…");
    expect(maskClerkKey("garbage-value-1234")).toBe("unknown-prefix…1234");
  });
});

describe("cleanClerkKey", () => {
  it("strips whitespace and one layer of matching quotes", () => {
    expect(cleanClerkKey(` "${SK_TEST}"\n`)).toMatchObject({ value: SK_TEST, hadQuotes: true, hadWhitespace: true });
    expect(cleanClerkKey(SK_TEST)).toMatchObject({ value: SK_TEST, hadQuotes: false, hadWhitespace: false, hadInnerWhitespace: false });
    expect(cleanClerkKey("sk_test_ab cd").hadInnerWhitespace).toBe(true);
  });
});

describe("diagnoseClerkKeys", () => {
  it("passes a matching dev pair and summarises safely", () => {
    const d = diagnoseClerkKeys({ CLERK_SECRET_KEY: SK_TEST, CLERK_PUBLISHABLE_KEY: pk("test") });
    expect(d.issues).toEqual([]);
    expect(d.summary).toBe("secret=sk_test_…WXYZ publishable=pk_test_…" + pk("test").slice(-4) + " (example-app-12.clerk.accounts.dev)");
    expect(d.summary).not.toContain(SK_TEST);
  });

  it("flags missing keys", () => {
    expect(messages({})).toEqual([
      expect.stringContaining("error: CLERK_SECRET_KEY is not set"),
      expect.stringContaining("error: CLERK_PUBLISHABLE_KEY is not set"),
    ]);
  });

  it("flags quotes/whitespace and returns the cleaned values", () => {
    const d = diagnoseClerkKeys({ CLERK_SECRET_KEY: `"${SK_TEST}"`, CLERK_PUBLISHABLE_KEY: `${pk("test")}\n` });
    expect(d.sanitized).toEqual({ CLERK_SECRET_KEY: SK_TEST, CLERK_PUBLISHABLE_KEY: pk("test") });
    expect(d.issues.map((i) => i.message)).toEqual([
      expect.stringContaining("CLERK_SECRET_KEY is wrapped in quotes"),
      expect.stringContaining("CLERK_PUBLISHABLE_KEY has leading/trailing whitespace"),
    ]);
  });

  it("flags wrong prefixes and swapped keys", () => {
    expect(messages({ CLERK_SECRET_KEY: pk("test"), CLERK_PUBLISHABLE_KEY: SK_TEST })).toEqual([
      expect.stringContaining("CLERK_SECRET_KEY holds a publishable key"),
      expect.stringContaining("CLERK_PUBLISHABLE_KEY holds a secret key"),
    ]);
    expect(messages({ CLERK_SECRET_KEY: "whsec_123456789012345", CLERK_PUBLISHABLE_KEY: pk("test") })).toEqual([
      expect.stringContaining("CLERK_SECRET_KEY must start with sk_test_ or sk_live_"),
    ]);
  });

  it("flags a dev/prod mismatch in either direction", () => {
    expect(messages({ CLERK_SECRET_KEY: SK_LIVE, CLERK_PUBLISHABLE_KEY: pk("test") })).toEqual([
      expect.stringMatching(/mismatch: CLERK_SECRET_KEY is a production \(sk_live_\).*development \(pk_test_\)/),
    ]);
    expect(messages({ CLERK_SECRET_KEY: SK_TEST, CLERK_PUBLISHABLE_KEY: pk("live") })).toEqual([
      expect.stringMatching(/development \(sk_test_\).*production \(pk_live_\)/),
    ]);
  });

  it("flags a truncated publishable key and a differing Expo publishable key", () => {
    expect(messages({ CLERK_SECRET_KEY: SK_TEST, CLERK_PUBLISHABLE_KEY: "pk_test_Zm9v" })).toEqual([
      expect.stringContaining("malformed or truncated"),
    ]);
    expect(messages({ CLERK_SECRET_KEY: SK_TEST, CLERK_PUBLISHABLE_KEY: pk("test"), EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: pk("test", "other.clerk.accounts.dev") })).toEqual([
      expect.stringContaining("EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY"),
    ]);
  });

  it("never includes a full key in any message", () => {
    const all = messages({ CLERK_SECRET_KEY: SK_LIVE, CLERK_PUBLISHABLE_KEY: SK_TEST }).join("\n");
    expect(all).not.toContain(SK_LIVE);
    expect(all).not.toContain(SK_TEST);
  });
});

describe("publishableKeyFrontendApi", () => {
  it("decodes the Frontend API host", () => {
    expect(publishableKeyFrontendApi(pk("live", "clerk.brandthread.app"))).toBe("clerk.brandthread.app");
    expect(publishableKeyFrontendApi("pk_test_!!!")).toBeNull();
  });
});

describe("clerk_key_invalid detection", () => {
  it("recognises Clerk API errors, token errors and auth-state headers", () => {
    expect(isClerkKeyInvalidError({ status: 401, errors: [{ code: "clerk_key_invalid" }] })).toBe(true);
    expect(isClerkKeyInvalidError({ reason: "secret-key-invalid" })).toBe(true);
    expect(isClerkKeyInvalidError(new Error("Unauthorized clerk_key_invalid"))).toBe(true);
    expect(isClerkKeyInvalidError({ errors: [{ code: "resource_not_found" }] })).toBe(false);
    expect(isClerkKeyInvalidError(null)).toBe(false);
    expect(isClerkKeyInvalidAuthState("secret-key-invalid", undefined)).toBe(true);
    expect(isClerkKeyInvalidAuthState("session-token-and-uat-missing", "")).toBe(false);
  });

  it("throttles repeated log lines", () => {
    let t = 0;
    const allow = createLogThrottle(1000, () => t);
    expect(allow()).toBe(true);
    t = 500;
    expect(allow()).toBe(false);
    t = 1500;
    expect(allow()).toBe(true);
  });
});
