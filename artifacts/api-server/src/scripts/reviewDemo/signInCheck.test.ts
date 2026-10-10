import { describe, expect, it } from "vitest";
import { frontendApiFromPublishableKey, interpretSignInResponse, isLiveKey } from "./signInCheck";

const key = (kind: "test" | "live", host: string) => `pk_${kind}_${Buffer.from(`${host}$`).toString("base64")}`;

describe("frontendApiFromPublishableKey", () => {
  it("decodes the Frontend API host from a publishable key", () => {
    expect(frontendApiFromPublishableKey(key("live", "clerk.brandthread.app"))).toBe("https://clerk.brandthread.app");
    expect(frontendApiFromPublishableKey(key("test", "able-cat-12.clerk.accounts.dev"))).toBe("https://able-cat-12.clerk.accounts.dev");
    expect(isLiveKey(key("live", "clerk.brandthread.app"))).toBe(true);
    expect(isLiveKey(key("test", "x.clerk.accounts.dev"))).toBe(false);
  });

  it("rejects anything that is not a publishable key", () => {
    expect(frontendApiFromPublishableKey("sk_live_abc")).toBeNull();
    expect(frontendApiFromPublishableKey("pk_live_")).toBeNull();
    expect(frontendApiFromPublishableKey(`pk_live_${Buffer.from("not a host$").toString("base64")}`)).toBeNull();
  });
});

describe("interpretSignInResponse", () => {
  it("passes only a completed sign-in", () => {
    expect(interpretSignInResponse(200, { response: { status: "complete", created_session_id: "sess_1" } }))
      .toEqual({ ok: true, status: "complete", sessionId: "sess_1" });
  });

  it("explains Device Trust when Clerk asks a new device for a code", () => {
    const trust = interpretSignInResponse(200, { response: { status: "needs_client_trust" } });
    expect(trust.ok).toBe(false);
    if (!trust.ok) expect(trust.message).toMatch(/Device Trust/);
    const emailCode = interpretSignInResponse(200, {
      response: { status: "needs_second_factor", supported_second_factors: [{ strategy: "email_code" }] },
    });
    expect(emailCode.ok).toBe(false);
    if (!emailCode.ok) expect(emailCode.message).toMatch(/email_code code.*Device Trust/);
  });

  it("tells you to remove MFA when the demo account has an authenticator", () => {
    const totp = interpretSignInResponse(200, {
      response: { status: "needs_second_factor", supported_second_factors: [{ strategy: "totp" }] },
    });
    expect(totp.ok).toBe(false);
    if (!totp.ok) expect(totp.message).toMatch(/multi-factor/);
  });

  it("reports wrong credentials and other errors", () => {
    const wrong = interpretSignInResponse(422, { errors: [{ code: "form_password_incorrect", long_message: "Password is incorrect." }] });
    expect(wrong).toMatchObject({ ok: false, status: "form_password_incorrect" });
    if (!wrong.ok) expect(wrong.message).toMatch(/seed:review-accounts/);
    expect(interpretSignInResponse(500, {})).toMatchObject({ ok: false, status: "http_500" });
    expect(interpretSignInResponse(200, { response: { status: "needs_first_factor" } })).toMatchObject({ ok: false });
  });
});
