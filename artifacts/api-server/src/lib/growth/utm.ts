/** UTM presets, sanitising, building and parsing for tracked links. */

export type UtmFields = {
  source: string | null;
  medium: string | null;
  campaign: string | null;
  term: string | null;
  content: string | null;
};

export const UTM_PRESETS = [
  { id: "instagram", label: "Instagram", source: "instagram", medium: "social" },
  { id: "tiktok", label: "TikTok", source: "tiktok", medium: "social" },
  { id: "facebook", label: "Facebook", source: "facebook", medium: "social" },
  { id: "youtube", label: "YouTube", source: "youtube", medium: "video" },
  { id: "x", label: "X", source: "x", medium: "social" },
  { id: "pinterest", label: "Pinterest", source: "pinterest", medium: "social" },
  { id: "email", label: "Email", source: "newsletter", medium: "email" },
  { id: "sms", label: "SMS", source: "sms", medium: "sms" },
  { id: "whatsapp", label: "WhatsApp", source: "whatsapp", medium: "messaging" },
  { id: "influencer", label: "Influencer", source: "influencer", medium: "referral" },
  { id: "qr", label: "QR code", source: "qr", medium: "offline" },
] as const;

export const LINK_CODE_PARAM = "bt_lc";
const MAX_UTM_LEN = 80;

/** lowercase, [a-z0-9_.-] only, single dashes, <= 80 chars; null when empty. */
export function sanitizeUtmValue(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, MAX_UTM_LEN);
  return v || null;
}

export function sanitizeUtm(input: Partial<Record<keyof UtmFields, unknown>> | null | undefined): UtmFields {
  return {
    source: sanitizeUtmValue(input?.source),
    medium: sanitizeUtmValue(input?.medium),
    campaign: sanitizeUtmValue(input?.campaign),
    term: sanitizeUtmValue(input?.term),
    content: sanitizeUtmValue(input?.content),
  };
}

const PARAM_OF: Record<keyof UtmFields, string> = {
  source: "utm_source",
  medium: "utm_medium",
  campaign: "utm_campaign",
  term: "utm_term",
  content: "utm_content",
};

/**
 * Append UTM params (and the internal link code) to a destination URL.
 * Params already present on the destination are kept; a UTM value we hold
 * overrides a same-named param so the tracked link is authoritative.
 */
export function buildDestinationUrl(base: string, utm: UtmFields, code?: string | null): string {
  const url = new URL(base);
  (Object.keys(PARAM_OF) as (keyof UtmFields)[]).forEach((k) => {
    const v = utm[k];
    if (v) url.searchParams.set(PARAM_OF[k], v);
  });
  if (code) url.searchParams.set(LINK_CODE_PARAM, code);
  return url.toString();
}

export type ParsedAttribution = { utm: UtmFields; linkCode: string | null };

/** Read UTM params and the link code from a full URL or a bare query string. */
export function parseUtmFromUrl(input: string): ParsedAttribution {
  let params: URLSearchParams;
  try {
    params = input.includes("://") ? new URL(input).searchParams : new URLSearchParams(input.replace(/^\?/, ""));
  } catch {
    params = new URLSearchParams();
  }
  const code = params.get(LINK_CODE_PARAM);
  return {
    utm: sanitizeUtm({
      source: params.get("utm_source"),
      medium: params.get("utm_medium"),
      campaign: params.get("utm_campaign"),
      term: params.get("utm_term"),
      content: params.get("utm_content"),
    }),
    linkCode: code && /^[a-z0-9]{6,12}$/.test(code) ? code : null,
  };
}

export const DESTINATION_TYPES = ["store", "product", "bio"] as const;
export type DestinationType = (typeof DESTINATION_TYPES)[number];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type LinkInput = {
  label: string;
  destinationType: DestinationType;
  destinationRef: string | null;
  utm: UtmFields;
};

export function validateLinkInput(body: unknown): { ok: true; value: LinkInput } | { ok: false; error: string } {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const type = b.destinationType;
  if (typeof type !== "string" || !(DESTINATION_TYPES as readonly string[]).includes(type)) {
    return { ok: false, error: "destinationType must be store, product or bio" };
  }
  let ref: string | null = null;
  if (type === "product") {
    if (typeof b.destinationRef !== "string" || !UUID_RE.test(b.destinationRef)) {
      return { ok: false, error: "destinationRef must be a product id" };
    }
    ref = b.destinationRef.toLowerCase();
  }
  const utm = sanitizeUtm({
    source: b.utmSource, medium: b.utmMedium, campaign: b.utmCampaign, term: b.utmTerm, content: b.utmContent,
  });
  if (!utm.source) return { ok: false, error: "utmSource is required" };
  if (!utm.medium) return { ok: false, error: "utmMedium is required" };
  const label = typeof b.label === "string" ? b.label.trim().slice(0, 80) : "";
  return { ok: true, value: { label, destinationType: type as DestinationType, destinationRef: ref, utm } };
}
