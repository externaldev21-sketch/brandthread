/**
 * Unit tests for mapStripeError in lib/stripe.ts
 *
 * Verifies:
 * A. Every explicitly mapped decline_code / code produces the correct
 *    buyer-friendly message.
 * B. The fallback message is returned for unknown codes and for empty/null
 *    inputs.
 * C. Raw Stripe strings (e.g. "card_declined", "do_not_honor") never appear
 *    verbatim in any returned message.
 * D. decline_code takes priority over code when both are present.
 */

import { describe, it, expect } from "vitest";
import { mapStripeError } from "../stripe";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Raw Stripe strings that must NEVER appear verbatim in any output. */
const RAW_STRIPE_STRINGS = [
  "approve_with_id",
  "call_issuer",
  "card_declined",
  "generic_decline",
  "do_not_honor",
  "do_not_try_again",
  "insufficient_funds",
  "expired_card",
  "incorrect_cvc",
  "invalid_cvc",
  "incorrect_number",
  "invalid_number",
  "incorrect_pin",
  "invalid_expiry_month",
  "invalid_expiry_year",
  "incorrect_zip",
  "invalid_zip",
  "processing_error",
  "fraudulent",
  "lost_card",
  "stolen_card",
  "pickup_card",
  "card_velocity_exceeded",
  "currency_not_supported",
  "duplicate_transaction",
  "card_not_supported",
  "cash_withdrawal",
  "authentication_required",
  "refer_to_customer",
  "stop_payment_order",
  "invalid_account",
  "invalid_amount",
  "issuer_not_available",
  "merchant_blacklist",
  "new_account_information",
  "no_action_taken",
  "not_permitted",
  "service_not_allowed",
  "transaction_not_allowed",
  "offline_pin_required",
  "online_or_offline_pin_required",
  "pin_blocked",
  "reenter_transaction",
  "restricted_card",
  "revoked_card",
  "security_violation",
  "try_again_later",
  "withdrawal_count_limit_exceeded",
  "testmode_decline",
];

function noRawStripes(msg: string): void {
  for (const raw of RAW_STRIPE_STRINGS) {
    expect(msg.toLowerCase()).not.toContain(raw);
  }
}

// ─── Mapped decline_code cases ────────────────────────────────────────────────

describe("mapStripeError — mapped decline codes", () => {
  const cases: Array<[string, RegExp]> = [
    ["approve_with_id",        /bank.*approve|contact/i],
    ["call_issuer",            /issuer.*approve|contact/i],
    ["insufficient_funds",     /insufficient funds/i],
    ["card_declined",          /declined/i],
    ["generic_decline",        /declined/i],
    ["expired_card",           /expired/i],
    ["incorrect_cvc",          /security code|cvc/i],
    ["invalid_cvc",            /security code/i],
    ["incorrect_number",       /card number/i],
    ["invalid_number",         /card number/i],
    ["incorrect_pin",          /PIN/i],
    ["invalid_expiry_month",   /expiration date/i],
    ["invalid_expiry_year",    /expiration date/i],
    ["incorrect_zip",          /postal code/i],
    ["invalid_zip",            /postal code/i],
    ["processing_error",       /processing error/i],
    ["do_not_honor",           /issuer declined|contact.*issuer/i],
    ["do_not_try_again",       /issuer declined|contact.*issuer/i],
    ["fraudulent",             /declined/i],
    ["lost_card",              /declined/i],
    ["stolen_card",            /declined/i],
    ["pickup_card",            /declined/i],
    ["card_velocity_exceeded", /too many attempt/i],
    ["currency_not_supported", /USD|currency/i],
    ["duplicate_transaction",  /duplicate/i],
    ["card_not_supported",     /not supported/i],
    ["cash_withdrawal",        /different card/i],
    ["authentication_required", /verification|banking app/i],
    ["refer_to_customer",      /declined/i],
    ["stop_payment_order",     /stop/i],
    ["invalid_account",        /account is invalid/i],
    ["invalid_amount",         /amount/i],
    ["issuer_not_available",   /temporarily unavailable/i],
    ["merchant_blacklist",     /bank declined|contact/i],
    ["new_account_information", /updated account information/i],
    ["no_action_taken",        /could not complete/i],
    ["not_permitted",          /doesn't allow/i],
    ["service_not_allowed",    /doesn't allow/i],
    ["transaction_not_allowed", /doesn't allow/i],
    ["offline_pin_required",   /requires a PIN/i],
    ["online_or_offline_pin_required", /requires a PIN/i],
    ["pin_blocked",            /PIN is blocked/i],
    ["reenter_transaction",    /try again/i],
    ["restricted_card",        /restricted/i],
    ["revoked_card",           /no longer valid/i],
    ["security_violation",     /security reasons/i],
    ["try_again_later",        /try again later/i],
    ["withdrawal_count_limit_exceeded", /transaction limit/i],
    ["testmode_decline",       /test card/i],
  ];

  for (const [code, pattern] of cases) {
    it(`decline_code '${code}' → buyer-friendly message matching ${pattern}`, () => {
      const msg = mapStripeError({ decline_code: code });
      expect(msg).toMatch(pattern);
      noRawStripes(msg);
    });
  }
});

// ─── code fallback (no decline_code) ─────────────────────────────────────────

describe("mapStripeError — code fallback (no decline_code)", () => {
  it("code 'card_declined' without decline_code → friendly message", () => {
    const msg = mapStripeError({ code: "card_declined" });
    expect(msg).toMatch(/declined/i);
    noRawStripes(msg);
  });

  it("code 'processing_error' without decline_code → friendly message", () => {
    const msg = mapStripeError({ code: "processing_error" });
    expect(msg).toMatch(/processing error/i);
    noRawStripes(msg);
  });
});

// ─── decline_code takes priority over code ────────────────────────────────────

describe("mapStripeError — decline_code beats code", () => {
  it("decline_code 'insufficient_funds' overrides code 'card_declined'", () => {
    const msg = mapStripeError({ decline_code: "insufficient_funds", code: "card_declined" });
    expect(msg).toMatch(/insufficient funds/i);
    noRawStripes(msg);
  });

  it("decline_code 'expired_card' overrides code 'do_not_honor'", () => {
    const msg = mapStripeError({ decline_code: "expired_card", code: "do_not_honor" });
    expect(msg).toMatch(/expired/i);
    noRawStripes(msg);
  });
});

// ─── Unknown / empty inputs → safe fallback ──────────────────────────────────

describe("mapStripeError — fallback for unknown/empty input", () => {
  it("empty object → generic fallback", () => {
    const msg = mapStripeError({});
    expect(typeof msg).toBe("string");
    expect(msg.length).toBeGreaterThan(10);
    noRawStripes(msg);
  });

  it("null decline_code and null code → generic fallback", () => {
    const msg = mapStripeError({ decline_code: null, code: null });
    expect(typeof msg).toBe("string");
    expect(msg.length).toBeGreaterThan(10);
    noRawStripes(msg);
  });

  it("unknown decline_code 'some_future_code' → generic fallback", () => {
    const msg = mapStripeError({ decline_code: "some_future_code" });
    expect(typeof msg).toBe("string");
    expect(msg.length).toBeGreaterThan(10);
    noRawStripes(msg);
  });

  it("unknown code 'unexpected_stripe_error' → generic fallback", () => {
    const msg = mapStripeError({ code: "unexpected_stripe_error" });
    expect(typeof msg).toBe("string");
    expect(msg.length).toBeGreaterThan(10);
    noRawStripes(msg);
  });

  it("fallback message does not contain raw Stripe strings", () => {
    const msg = mapStripeError({ decline_code: "unknown_future_code" });
    noRawStripes(msg);
  });
});

// ─── Case-insensitivity guard ─────────────────────────────────────────────────

describe("mapStripeError — case normalization", () => {
  it("uppercase decline_code 'INSUFFICIENT_FUNDS' is handled", () => {
    // mapStripeError lowercases internally
    const msg = mapStripeError({ decline_code: "INSUFFICIENT_FUNDS" });
    expect(msg).toMatch(/insufficient funds/i);
    noRawStripes(msg);
  });

  it("mixed-case 'Expired_Card' is handled", () => {
    const msg = mapStripeError({ decline_code: "Expired_Card" });
    expect(msg).toMatch(/expired/i);
    noRawStripes(msg);
  });
});
