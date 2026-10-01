/** Input validation for email marketing: subscribe payloads, campaign content, settings. */

export const EMAIL_MAX_LENGTH = 254;
const EMAIL_RE = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;

export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (email.length < 6 || email.length > EMAIL_MAX_LENGTH) return null;
  if (!EMAIL_RE.test(email)) return null;
  const [local] = email.split("@");
  if (local.length > 64 || local.startsWith(".") || local.endsWith(".") || local.includes("..")) return null;
  return email;
}

export type SubscribeInput = { email: string; honeypot: boolean };

/** `website` is the honeypot field: real visitors never see or fill it. */
export function parseSubscribeBody(body: unknown):
  | { ok: true; value: SubscribeInput }
  | { ok: false; error: string } {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const honeypot = typeof b.website === "string" && b.website.trim().length > 0;
  const email = normalizeEmail(b.email);
  if (!email) return { ok: false, error: "Enter a valid email address." };
  return { ok: true, value: { email, honeypot } };
}

export const SUBJECT_MAX = 150;
export const PREHEADER_MAX = 200;
export const HEADLINE_MAX = 120;
export const TEXT_MAX = 5000;
export const CTA_LABEL_MAX = 40;
export const MAX_PRODUCT_CARDS = 3;
export const AUDIENCES = ["subscribers", "customers", "followers"] as const;
export type Audience = (typeof AUDIENCES)[number];

export type CampaignBody = {
  headline: string;
  text: string;
  imageUrl: string | null;
  productIds: string[];
  cta: { label: string; url: string } | null;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isHttpsUrl(value: unknown, max = 2048): value is string {
  if (typeof value !== "string" || value.length > max) return false;
  try {
    const u = new URL(value);
    return u.protocol === "https:" && !u.username && !u.password;
  } catch {
    return false;
  }
}

/** Header-safe single line: strips CR/LF so a subject can never inject headers. */
export function singleLine(value: unknown, max: number): string {
  return String(value ?? "").replace(/[\r\n\u2028\u2029]+/g, " ").trim().slice(0, max);
}

export function parseCampaignBody(input: unknown):
  | { ok: true; value: CampaignBody }
  | { ok: false; error: string } {
  const b = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const headline = singleLine(b.headline, HEADLINE_MAX + 1);
  if (headline.length > HEADLINE_MAX) return { ok: false, error: `Headline must be ${HEADLINE_MAX} characters or fewer.` };
  const text = typeof b.text === "string" ? b.text.replace(/\r\n/g, "\n").trim() : "";
  if (text.length > TEXT_MAX) return { ok: false, error: `Body text must be ${TEXT_MAX} characters or fewer.` };

  let imageUrl: string | null = null;
  if (b.imageUrl !== undefined && b.imageUrl !== null && b.imageUrl !== "") {
    if (!isHttpsUrl(b.imageUrl)) return { ok: false, error: "Image must be a secure (https) link." };
    imageUrl = b.imageUrl;
  }

  const rawIds = Array.isArray(b.productIds) ? b.productIds : [];
  if (rawIds.length > MAX_PRODUCT_CARDS) return { ok: false, error: `Add up to ${MAX_PRODUCT_CARDS} products.` };
  const productIds: string[] = [];
  for (const id of rawIds) {
    if (typeof id !== "string" || !UUID_RE.test(id)) return { ok: false, error: "One of the selected products is invalid." };
    if (!productIds.includes(id)) productIds.push(id);
  }

  let cta: CampaignBody["cta"] = null;
  const rawCta = b.cta as Record<string, unknown> | null | undefined;
  if (rawCta && (rawCta.label || rawCta.url)) {
    const label = singleLine(rawCta.label, CTA_LABEL_MAX + 1);
    if (!label || label.length > CTA_LABEL_MAX) return { ok: false, error: `Button label must be 1 to ${CTA_LABEL_MAX} characters.` };
    if (!isHttpsUrl(rawCta.url)) return { ok: false, error: "Button link must be a secure (https) link." };
    cta = { label, url: rawCta.url as string };
  }
  return { ok: true, value: { headline, text, imageUrl, productIds, cta } };
}

export type CampaignInput = {
  subject: string;
  preheader: string;
  audience: Audience;
  body: CampaignBody;
};

/** Drafts may be incomplete; `requireComplete` is used before sending or testing. */
export function parseCampaignInput(input: unknown, opts: { requireComplete: boolean }):
  | { ok: true; value: CampaignInput }
  | { ok: false; error: string } {
  const b = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const subject = singleLine(b.subject, SUBJECT_MAX + 1);
  if (subject.length > SUBJECT_MAX) return { ok: false, error: `Subject must be ${SUBJECT_MAX} characters or fewer.` };
  const preheader = singleLine(b.preheader, PREHEADER_MAX + 1);
  if (preheader.length > PREHEADER_MAX) return { ok: false, error: `Preview text must be ${PREHEADER_MAX} characters or fewer.` };
  const audience = (b.audience ?? "subscribers") as Audience;
  if (!AUDIENCES.includes(audience)) return { ok: false, error: "Choose a valid audience." };
  const body = parseCampaignBody(b.body);
  if (!body.ok) return body;
  if (opts.requireComplete) {
    if (!subject) return { ok: false, error: "Add a subject line." };
    const v = body.value;
    if (!v.headline && !v.text && !v.imageUrl && v.productIds.length === 0 && !v.cta) {
      return { ok: false, error: "Add some content to the email." };
    }
  }
  return { ok: true, value: { subject, preheader, audience, body: body.value } };
}

export function parseSettingsInput(input: unknown):
  | { ok: true; value: { fromName: string | null; replyTo: string | null; postalAddress: string | null; doubleOptIn: boolean } }
  | { ok: false; error: string } {
  const b = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const fromName = singleLine(b.fromName, 71).replace(/[<>"]/g, "");
  if (fromName.length > 70) return { ok: false, error: "Sender name must be 70 characters or fewer." };
  let replyTo: string | null = null;
  if (typeof b.replyTo === "string" && b.replyTo.trim()) {
    replyTo = normalizeEmail(b.replyTo);
    if (!replyTo) return { ok: false, error: "Enter a valid reply-to email." };
  }
  const postal = typeof b.postalAddress === "string" ? b.postalAddress.replace(/\r\n/g, "\n").trim() : "";
  if (postal.length > 300) return { ok: false, error: "Mailing address must be 300 characters or fewer." };
  return {
    ok: true,
    value: { fromName: fromName || null, replyTo, postalAddress: postal || null, doubleOptIn: b.doubleOptIn === true },
  };
}
