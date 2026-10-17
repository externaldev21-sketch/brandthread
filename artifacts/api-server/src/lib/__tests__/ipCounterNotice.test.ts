import { describe, expect, it } from "vitest";
import { composeCounterNoticeText, validateCounterNotice } from "../ipCounterNotice";

const valid = {
  fullName: "Sam Seller", address: "12 Market Street, Portland, OR 97201", phone: "(503) 555-0100",
  removedMaterial: "Listing 'Nord jacket' on my Brandthread store",
  explanation: "I designed and manufactured this jacket myself.",
  perjuryStatement: true, consentToJurisdiction: true, signature: "sam  seller",
};

describe("validateCounterNotice", () => {
  it("accepts a complete counter-notice and stamps the legal statements + signing time", () => {
    const now = new Date("2026-10-17T10:00:00Z");
    const result = validateCounterNotice(valid, now);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({ fullName: "Sam Seller", email: null, signedAt: now.toISOString() });
    expect(result.value.perjuryStatement).toMatch(/penalty of perjury/);
    expect(result.value.jurisdictionStatement).toMatch(/accept service of process/);
    const text = composeCounterNoticeText("IP-123", result.value);
    expect(text).toContain("case IP-123");
    expect(text).toContain("/s/ sam  seller");
  });

  it.each([
    ["fullName", { fullName: "" }],
    ["address", { address: "short" }],
    ["phone", { phone: "123" }],
    ["email", { email: "not-an-email" }],
    ["removedMaterial", { removedMaterial: "" }],
    ["explanation", { explanation: "too short" }],
    ["perjuryStatement", { perjuryStatement: "yes" }],
    ["consentToJurisdiction", { consentToJurisdiction: undefined }],
    ["signature", { signature: "" }],
    ["signature", { signature: "Someone Else" }],
  ])("rejects a missing or invalid %s", (field, patch) => {
    const result = validateCounterNotice({ ...valid, ...patch });
    expect(result).toMatchObject({ ok: false, field });
  });
});
