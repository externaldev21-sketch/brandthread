/**
 * Brandthread storefront subdomains (<name>.brandthread.app).
 *
 * The subdomain IS the storefront's `slug` (the public site resolves
 * /api/store/site/:slug). Every storefront gets an auto-assigned
 * `store-xxxxxxxx` slug; a seller claims a real name through
 * PUT /api/store/subdomain, which stamps `subdomain_claimed_at`.
 *
 * Pure helpers only — no DB access — so the rules are unit-testable.
 */

export const SUBDOMAIN_MIN_LENGTH = 3;
export const SUBDOMAIN_MAX_LENGTH = 63;

/** Names that must never be claimable by a seller (platform / infra hosts). */
export const RESERVED_SUBDOMAINS: ReadonlySet<string> = new Set([
  "www", "api", "admin", "app", "mail", "help", "support", "brandthread",
  "cname", "cdn", "static", "assets", "status", "docs", "blog", "auth",
  "login", "account", "accounts", "dashboard", "shop", "store", "stores",
  "billing", "pay", "payments", "checkout", "smtp", "imap", "pop", "ftp",
  "ns", "ns1", "ns2", "mx", "dev", "staging", "test", "preview", "root",
]);

export type SubdomainValidationError =
  | "required"
  | "too_short"
  | "too_long"
  | "invalid_characters"
  | "hyphen_edge"
  | "reserved";

export type SubdomainValidation =
  | { ok: true; subdomain: string }
  | { ok: false; error: SubdomainValidationError; message: string };

const MESSAGES: Record<SubdomainValidationError, string> = {
  required: "Enter a subdomain.",
  too_short: `Use at least ${SUBDOMAIN_MIN_LENGTH} characters.`,
  too_long: `Use at most ${SUBDOMAIN_MAX_LENGTH} characters.`,
  invalid_characters: "Use only lowercase letters, numbers and hyphens.",
  hyphen_edge: "A subdomain can't start or end with a hyphen.",
  reserved: "That subdomain is reserved.",
};

function fail(error: SubdomainValidationError): SubdomainValidation {
  return { ok: false, error, message: MESSAGES[error] };
}

/**
 * Validate a requested subdomain. Input is trimmed and lowercased first
 * (subdomains are case-insensitive); everything else must already match
 * a-z, 0-9 and "-".
 */
export function validateSubdomain(input: unknown): SubdomainValidation {
  if (typeof input !== "string") return fail("required");
  const value = input.trim().toLowerCase();
  if (!value) return fail("required");
  if (!/^[a-z0-9-]+$/.test(value)) return fail("invalid_characters");
  if (value.length < SUBDOMAIN_MIN_LENGTH) return fail("too_short");
  if (value.length > SUBDOMAIN_MAX_LENGTH) return fail("too_long");
  if (value.startsWith("-") || value.endsWith("-")) return fail("hyphen_edge");
  if (RESERVED_SUBDOMAINS.has(value)) return fail("reserved");
  return { ok: true, subdomain: value };
}

/**
 * Turn a free-form handle / brand name into a subdomain candidate
 * ("@Atelier Noire" -> "atelier-noire"). Returns null when nothing valid
 * can be derived.
 */
export function subdomainFromHandle(handle: unknown): string | null {
  if (typeof handle !== "string") return null;
  const slug = handle
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SUBDOMAIN_MAX_LENGTH)
    .replace(/-+$/g, "");
  const result = validateSubdomain(slug);
  return result.ok ? result.subdomain : null;
}

export type SubdomainStatus = "active" | "unclaimed";

export interface SubdomainState {
  /** The claimed subdomain, or null when the seller hasn't claimed one. */
  subdomain: string | null;
  /** 'active' once claimed server-side (platform-owned host, nothing to verify). */
  status: SubdomainStatus;
  /** The storefront's current public slug (auto-assigned until claimed). */
  assignedSlug: string;
  /** Suggested name derived from the seller's handle, when unclaimed. */
  suggestion: string | null;
  url: string | null;
  claimedAt: string | null;
}

export function subdomainUrl(subdomain: string): string {
  return `https://${subdomain}.brandthread.app`;
}

export function buildSubdomainState(
  sf: { slug: string; subdomainClaimedAt?: Date | string | null },
  suggestion: string | null,
): SubdomainState {
  const claimedAt = sf.subdomainClaimedAt
    ? new Date(sf.subdomainClaimedAt).toISOString()
    : null;
  if (claimedAt) {
    return {
      subdomain: sf.slug,
      status: "active",
      assignedSlug: sf.slug,
      suggestion: null,
      url: subdomainUrl(sf.slug),
      claimedAt,
    };
  }
  return {
    subdomain: null,
    status: "unclaimed",
    assignedSlug: sf.slug,
    suggestion,
    url: null,
    claimedAt: null,
  };
}
