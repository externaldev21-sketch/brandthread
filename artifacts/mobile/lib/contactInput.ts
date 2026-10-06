/**
 * "Reply contact" fields accept an email or a phone/WhatsApp number.
 * Returns the trimmed value when it is one of those, or null.
 */
const EMAIL = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

export function validEmailOrPhone(input: string): string | null {
  const v = input.trim();
  if (!v) return null;
  if (EMAIL.test(v)) return v;
  if (/^\+?[\d\s().-]+$/.test(v)) {
    const digits = v.replace(/\D/g, '');
    if (digits.length >= 7 && digits.length <= 15) return v;
  }
  return null;
}
