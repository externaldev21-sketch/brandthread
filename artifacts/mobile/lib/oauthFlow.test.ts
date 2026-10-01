import { describe, expect, it } from "vitest";
import {
  APPLE_OAUTH_STRATEGY,
  BRANDTHREAD_URL_SCHEME,
  isOAuthCancellationError,
  isOAuthFlowComplete,
  makeBrandthreadRedirectUri,
  mapOAuthError,
  oauthProviderVisibility,
} from "./oauthFlow";

describe("Apple OAuth flow contracts", () => {
  it("uses the Brandthread scheme and Clerk Apple strategy", () => {
    expect(BRANDTHREAD_URL_SCHEME).toBe("brandthread");
    expect(APPLE_OAUTH_STRATEGY).toBe("oauth_apple");
    expect(makeBrandthreadRedirectUri(({ scheme }) => `${scheme}://redirect`))
      .toBe("brandthread://redirect");
  });

  it("only advances after Clerk reports a completed OAuth result", () => {
    expect(isOAuthFlowComplete({ signUp: { status: "missing_requirements" } })).toBe(false);
    expect(isOAuthFlowComplete({ signUp: { status: "complete" } })).toBe(false);
    expect(isOAuthFlowComplete({ signIn: { status: "complete" } })).toBe(false);
    expect(isOAuthFlowComplete({ createdSessionId: "sess_123" })).toBe(true);
  });

  it("treats cancellation as a safe no-op but gives denied/revoked flows a retry message", () => {
    expect(isOAuthCancellationError({ code: "user_cancelled" })).toBe(true);
    expect(isOAuthCancellationError(new Error("dismissed by user"))).toBe(true);
    expect(mapOAuthError("Apple", { code: "access_denied" })).toContain("try again");
    expect(mapOAuthError("Apple", { code: "token_revoked" })).toContain("Start sign-in again");
  });

  it("keeps collisions and redirect interruptions recoverable", () => {
    expect(mapOAuthError("Apple", { code: "account_exists" }))
      .toContain("existing account");
    expect(mapOAuthError("Apple", { code: "redirect_uri_mismatch" }))
      .toContain("Try again");
  });
});
describe("oauthProviderVisibility (App Store 4.8)", () => {
  it("offers Apple next to Google on iOS", () => {
    expect(oauthProviderVisibility("ios", { apple: true, google: true })).toEqual({ apple: true, google: true });
  });

  it("never leaves Google as the only social login on iOS", () => {
    expect(oauthProviderVisibility("ios", { apple: false, google: true })).toEqual({ apple: false, google: false });
  });

  it("keeps Android and web unchanged (Apple is iOS-only in the app)", () => {
    expect(oauthProviderVisibility("android", { apple: true, google: true })).toEqual({ apple: false, google: true });
    expect(oauthProviderVisibility("web", { apple: false, google: true })).toEqual({ apple: false, google: true });
  });
});
