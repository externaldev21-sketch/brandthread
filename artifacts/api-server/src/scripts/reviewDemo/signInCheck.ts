/**
 * Pure helpers for scripts/verifyReviewerSignIn.ts: proves the App Review
 * demo accounts can sign in with email + password from a brand-new device
 * (no email/SMS code), the way an App Store reviewer will.
 */

/** Clerk Frontend API origin encoded in a publishable key (pk_live_… / pk_test_…). */
export function frontendApiFromPublishableKey(publishableKey: string): string | null {
  const match = publishableKey.trim().match(/^pk_(test|live)_([A-Za-z0-9+/=_-]+)$/);
  if (!match) return null;
  let decoded: string;
  try {
    decoded = Buffer.from(match[2].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  } catch {
    return null;
  }
  const host = decoded.replace(/\$$/, "");
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(host)) return null;
  return `https://${host}`;
}

export function isLiveKey(publishableKey: string): boolean {
  return publishableKey.trim().startsWith("pk_live_");
}

export type SignInVerdict =
  | { ok: true; status: "complete"; sessionId: string | null }
  | { ok: false; status: string; message: string };

const DEVICE_TRUST_FIX =
  "Turn off Device Trust (formerly Client Trust) for the production instance: " +
  "Clerk Dashboard → (production instance) → Protect → Rules → Device Trust. " +
  "See docs/launch/reviewer-sign-in.md.";

/**
 * Reads the Frontend API response of `POST /v1/client/sign_ins` with
 * strategy=password. Only `complete` means a reviewer gets in with no code.
 */
export function interpretSignInResponse(httpStatus: number, body: unknown): SignInVerdict {
  const json = (body ?? {}) as {
    response?: { status?: string; created_session_id?: string | null; supported_second_factors?: Array<{ strategy?: string }> };
    errors?: Array<{ code?: string; message?: string; long_message?: string }>;
  };
  if (httpStatus >= 400 || json.errors?.length) {
    const error = json.errors?.[0];
    const code = error?.code ?? `http_${httpStatus}`;
    const detail = error?.long_message ?? error?.message ?? "request failed";
    if (code === "form_password_incorrect" || code === "form_identifier_not_found") {
      return { ok: false, status: code, message: `${detail} Run the review-account seed again (seed:review-accounts) or fix the REVIEW_DEMO_* values.` };
    }
    return { ok: false, status: code, message: detail };
  }
  const status = json.response?.status ?? "unknown";
  if (status === "complete") {
    return { ok: true, status: "complete", sessionId: json.response?.created_session_id ?? null };
  }
  if (status === "needs_client_trust") {
    return { ok: false, status, message: `Clerk asked for a code because the device is new. ${DEVICE_TRUST_FIX}` };
  }
  if (status === "needs_second_factor") {
    const strategies = (json.response?.supported_second_factors ?? []).map((f) => f.strategy).filter(Boolean);
    const viaEmailOrSms = strategies.length === 0 || strategies.every((s) => s === "email_code" || s === "phone_code");
    return {
      ok: false,
      status,
      message: viaEmailOrSms
        ? `Clerk asked for a ${strategies.join(" or ") || "verification"} code. ${DEVICE_TRUST_FIX}`
        : `The account has multi-factor authentication (${strategies.join(", ")}). Remove MFA from the demo account in Clerk Dashboard → Users.`,
    };
  }
  return { ok: false, status, message: `Sign-in did not complete (status "${status}").` };
}
