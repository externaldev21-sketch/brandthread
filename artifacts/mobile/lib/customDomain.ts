/**
 * Normalizes what a seller types into the "Connect custom domain" field into
 * a bare hostname ("Shop.MyBrand.com/", "https://shop.mybrand.com/path" ->
 * "shop.mybrand.com") and rejects anything that isn't a valid domain name.
 */
export type CustomDomainResult = { ok: true; domain: string } | { ok: false; error: string };

const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

export function normalizeCustomDomain(input: string): CustomDomainResult {
  let v = input.trim().toLowerCase();
  if (!v) return { ok: false, error: 'Enter a domain, like shop.yourbrand.com.' };
  v = v.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  v = v.split(/[/?#]/)[0];
  v = v.replace(/\.$/, '');
  if (/[^a-z0-9.-]/.test(v)) return { ok: false, error: 'A domain can only use letters, numbers, dots and hyphens.' };
  const labels = v.split('.');
  if (labels.length < 2 || v.length > 253 || !labels.every((l) => LABEL.test(l)) || !/^[a-z]{2,63}$/.test(labels[labels.length - 1])) {
    return { ok: false, error: 'Enter a full domain, like shop.yourbrand.com.' };
  }
  if (v === 'brandthread.app' || v.endsWith('.brandthread.app')) {
    return { ok: false, error: 'Brandthread addresses are set under Brandthread subdomain above.' };
  }
  return { ok: true, domain: v };
}
