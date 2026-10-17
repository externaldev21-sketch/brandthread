/**
 * Seller DMCA counter-notice (17 U.S.C. § 512(g)(3)). A valid counter-notice
 * must contain:
 *   (A) a physical or electronic signature of the subscriber;
 *   (B) identification of the material removed and where it appeared before removal;
 *   (C) a statement under penalty of perjury of a good-faith belief that the
 *       material was removed as a result of mistake or misidentification;
 *   (D) name, address and telephone number, and a statement of consent to the
 *       jurisdiction of the Federal District Court for the judicial district of
 *       that address (or, outside the US, any district where the service
 *       provider may be found), and that the subscriber will accept service of
 *       process from the person who filed the original notice.
 *
 * validateCounterNotice() enforces every element; composeCounterNoticeText()
 * renders them as the plain-text counter-notice the moderation queue already
 * shows (ip_cases.counter_notice_statement). The structured copy is kept in
 * ip_cases.counter_notice_details (migration 280).
 */

export const PERJURY_STATEMENT =
  "I swear, under penalty of perjury, that I have a good faith belief that the material identified above was removed or disabled as a result of a mistake or misidentification of the material to be removed or disabled.";

export const JURISDICTION_STATEMENT =
  "I consent to the jurisdiction of the Federal District Court for the judicial district in which my address is located, or, if my address is outside the United States, for any judicial district in which Brandthread may be found, and I will accept service of process from the person who provided the original notification or an agent of such person.";

export interface CounterNoticeDetails {
  fullName: string;
  address: string;
  phone: string;
  email: string | null;
  removedMaterial: string;
  explanation: string;
  perjuryStatement: string;
  jurisdictionStatement: string;
  signature: string;
  signedAt: string;
}

export type CounterNoticeValidation =
  | { ok: true; value: CounterNoticeDetails }
  | { ok: false; error: string; field: string };

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max + 1) : "");
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateCounterNotice(body: unknown, now: Date = new Date()): CounterNoticeValidation {
  const b = (body ?? {}) as Record<string, unknown>;
  const fullName = str(b.fullName, 200);
  const address = str(b.address, 500);
  const phone = str(b.phone, 40);
  const email = str(b.email, 254);
  const removedMaterial = str(b.removedMaterial, 2000);
  // `statement` is the field name older clients used for the explanation.
  const explanation = str(b.explanation ?? b.statement, 5000);
  const signature = str(b.signature, 200);

  if (fullName.length < 2 || fullName.length > 200) return { ok: false, field: "fullName", error: "Enter your full legal name." };
  if (address.length < 10 || address.length > 500) return { ok: false, field: "address", error: "Enter your full postal address." };
  if (phone.replace(/\D/g, "").length < 7 || phone.length > 40) return { ok: false, field: "phone", error: "Enter a phone number where you can be reached." };
  if (email && (!EMAIL_RE.test(email) || email.length > 254)) return { ok: false, field: "email", error: "Enter a valid email address." };
  if (removedMaterial.length < 5 || removedMaterial.length > 2000) {
    return { ok: false, field: "removedMaterial", error: "Identify the removed listing and where it appeared." };
  }
  if (explanation.length < 20 || explanation.length > 5000) {
    return { ok: false, field: "explanation", error: "Explain why the listing was removed by mistake (at least 20 characters)." };
  }
  if (b.perjuryStatement !== true) {
    return { ok: false, field: "perjuryStatement", error: "Confirm the statement made under penalty of perjury." };
  }
  if (b.consentToJurisdiction !== true) {
    return { ok: false, field: "consentToJurisdiction", error: "Confirm your consent to jurisdiction and service of process." };
  }
  if (signature.length < 2 || signature.length > 200) return { ok: false, field: "signature", error: "Type your full name as your electronic signature." };
  if (signature.toLowerCase().replace(/\s+/g, " ") !== fullName.toLowerCase().replace(/\s+/g, " ")) {
    return { ok: false, field: "signature", error: "Your signature must match your full legal name." };
  }

  return {
    ok: true,
    value: {
      fullName, address, phone, email: email || null, removedMaterial, explanation,
      perjuryStatement: PERJURY_STATEMENT, jurisdictionStatement: JURISDICTION_STATEMENT,
      signature, signedAt: now.toISOString(),
    },
  };
}

export function composeCounterNoticeText(caseReference: string, d: CounterNoticeDetails): string {
  return [
    `DMCA counter-notice (17 U.S.C. § 512(g)(3)) for case ${caseReference}`,
    "",
    `Removed material and where it appeared: ${d.removedMaterial}`,
    "",
    `Why it was removed by mistake or misidentification: ${d.explanation}`,
    "",
    d.perjuryStatement,
    "",
    d.jurisdictionStatement,
    "",
    `Name: ${d.fullName}`,
    `Address: ${d.address}`,
    `Phone: ${d.phone}`,
    ...(d.email ? [`Email: ${d.email}`] : []),
    "",
    `Electronic signature: /s/ ${d.signature} (${d.signedAt})`,
  ].join("\n");
}
