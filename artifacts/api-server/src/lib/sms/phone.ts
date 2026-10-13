/**
 * Phone numbers for text-message delivery. US first: a 10-digit number (any
 * punctuation) or 11 digits starting with 1 becomes +1XXXXXXXXXX; anything
 * else must already be "+" plus a country code. Returns null when the result
 * isn't a dialable E.164 number.
 */
const E164 = /^\+[1-9]\d{7,14}$/;
// NANP: area code and exchange both start 2-9.
const NANP = /^\+1[2-9]\d{2}[2-9]\d{6}$/;

export function toE164(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim();
  if (!value || /[a-z]/i.test(value)) return null;
  const digits = value.replace(/\D/g, "");
  let e164: string;
  if (value.startsWith("+")) e164 = `+${digits}`;
  else if (digits.length === 10) e164 = `+1${digits}`;
  else if (digits.length === 11 && digits.startsWith("1")) e164 = `+${digits}`;
  else return null;
  if (!E164.test(e164)) return null;
  if (e164.startsWith("+1") && !NANP.test(e164)) return null;
  return e164;
}

/** Last four digits, for "Sent to •••1234". */
export function phoneLast4(e164: string | null | undefined): string | null {
  const digits = (e164 ?? "").replace(/\D/g, "");
  return digits.length >= 4 ? digits.slice(-4) : null;
}
