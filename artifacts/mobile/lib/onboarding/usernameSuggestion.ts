/**
 * Instagram pre-fills "Create a username" with a suggestion. Ours comes from
 * the name (or the email's local part), cleaned to the username rules
 * (letters, numbers, underscores, 3–30 chars). Availability is still checked
 * live; when the suggestion is taken, `withSuffix` offers the next variant.
 */
const MAX = 30;

function clean(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '')
    .slice(0, MAX);
}

export function suggestUsername(input: { name?: string; brandName?: string; email?: string }): string {
  const fromBrand = clean((input.brandName ?? '').replace(/\s+/g, ''));
  const fromName = clean((input.name ?? '').trim().replace(/\s+/g, '_'));
  const fromEmail = clean(((input.email ?? '').split('@')[0] ?? '').split('+')[0]);
  const base = [fromBrand, fromName, fromEmail].find((v) => v.replace(/_/g, '').length >= 3) ?? '';
  return base.replace(/^_+|_+$/g, '');
}

/** "mila" → "mila1", "mila1" → "mila2"; keeps within 30 chars. */
export function withSuffix(username: string, n: number): string {
  const suffix = String(n);
  return `${username.replace(/\d+$/, '').slice(0, MAX - suffix.length)}${suffix}`;
}
