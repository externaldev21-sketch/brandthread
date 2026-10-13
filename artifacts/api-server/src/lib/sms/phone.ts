/**
 * Small E.164 normalizer for the drop SMS waitlist. US/Canada (+1) is the
 * default; any other country is accepted when the input carries its own
 * country code ("+44 7700 900123", or a separate country code field).
 * Deliberately conservative: anything it can't place returns null.
 */

const E164 = /^\+[1-9]\d{7,14}$/;
// NANP: area code and exchange both start 2-9.
const NANP_NATIONAL = /^[2-9]\d{2}[2-9]\d{6}$/;

function digitsOf(value: string): string {
  return value.replace(/\D/g, "");
}

/**
 * @param input        what the person typed in the number field
 * @param countryCode  the separate country code field ("+1", "44", …); defaults to +1
 */
export function normalizePhone(input: unknown, countryCode: unknown = "1"): string | null {
  if (typeof input !== "string") return null;
  const raw = input.trim();
  if (!raw || raw.length > 32) return null;
  // Only digits, spaces and common phone punctuation are allowed.
  if (!/^[+\d\s().\-]+$/.test(raw)) return null;

  let e164: string;
  if (raw.startsWith("+")) {
    e164 = `+${digitsOf(raw)}`;
  } else if (raw.startsWith("00")) {
    e164 = `+${digitsOf(raw).slice(2)}`;
  } else {
    const cc = typeof countryCode === "string" || typeof countryCode === "number"
      ? digitsOf(String(countryCode))
      : "";
    if (!/^[1-9]\d{0,2}$/.test(cc)) return null;
    let national = digitsOf(raw);
    if (cc === "1" && national.length === 11 && national.startsWith("1")) national = national.slice(1);
    // Drop a single trunk "0" (e.g. UK 07700 900123 → 7700 900123).
    if (cc !== "1" && national.startsWith("0")) national = national.slice(1);
    e164 = `+${cc}${national}`;
  }

  if (!E164.test(e164)) return null;
  if (e164.startsWith("+1") && !NANP_NATIONAL.test(e164.slice(2))) return null;
  return e164;
}

/** "+15551234567" → "+1 ••• ••• 4567" for confirmations; never the full number. */
export function maskPhone(e164: string): string {
  const last4 = e164.slice(-4);
  if (e164.startsWith("+1") && e164.length === 12) return `+1 ••• ••• ${last4}`;
  return `${e164.slice(0, 3)} ••• ${last4}`;
}
