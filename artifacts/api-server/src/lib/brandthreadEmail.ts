import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { ReplitConnectors } from "@replit/connectors-sdk";
import { logger } from "./logger";
import { deliveryAddressFor } from "./profileDelivery";

const DEFAULT_FROM = "Brandthread <no-reply@brandthread.app>";
const RESEND_ENDPOINT = "https://api.resend.com/emails";
const RESEND_CONNECTOR_NAME = "resend";

const connectors = new ReplitConnectors();

export type EmailLineItem = {
  productName: string;
  variantLabel?: string | null;
  quantity: number;
  priceCents: number;
  /** Product photo; only an absolute https URL is ever rendered. */
  imageUrl?: string | null;
};

/** The seller whose order this is (users row of orders.ownerId). */
export type EmailStoreBranding = {
  name: string;
  /** Storefront logo; only an absolute https URL is ever rendered. */
  logoUrl?: string | null;
  /** Seller's public store contact email (users.contact_email). */
  contactEmail?: string | null;
};

/** Same shape as orders.shipping_address. */
export type EmailShippingAddress = {
  name?: string | null;
  street: string;
  line2?: string | null;
  city: string;
  state: string;
  zip: string;
  country: string;
};

export type BrandthreadEmailOptions = {
  to: string;
  subject: string;
  html: string;
  /** Plain-text alternative part. */
  text?: string;
  /** Reply-To address, e.g. the seller's store contact email on a receipt. */
  replyTo?: string;
  idempotencyKey?: string;
};

export function isOrderConfirmationEligibleStatus(status: string): boolean {
  return ["pending", "processing", "fulfilled", "shipped", "delivered"].includes(status);
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatCents(cents: number): string {
  return `$${(Math.max(0, cents) / 100).toFixed(2)}`;
}

function formatSignedCents(cents: number): string {
  return `-${formatCents(cents)}`;
}

/** Email images must be absolute https URLs; storage paths and signed URLs are dropped. */
function safeImageUrl(value: string | null | undefined): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return /^https:\/\/[^\s"'<>]+$/i.test(trimmed) ? trimmed : null;
}

/** A plausible single address, or null; an invalid reply_to would make Resend reject the whole send. */
function safeEmailAddress(value: string | null | undefined): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/.test(trimmed) && trimmed.length <= 254 ? trimmed : null;
}

function formatDate(value: Date = new Date()): string {
  return value.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function loadLogoContent(): string | null {
  const configuredPath = process.env.BRANDTHREAD_LOGO_PATH;
  const candidates = [
    configuredPath,
    path.resolve(process.cwd(), "artifacts/mobile/assets/images/brandthread-logo.png"),
    path.resolve(process.cwd(), "../mobile/assets/images/brandthread-logo.png"),
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    try {
      if (existsSync(candidate)) {
        return readFileSync(candidate).toString("base64");
      }
    } catch (err) {
      logger.warn({ err, candidate }, "Unable to load Brandthread email logo candidate");
    }
  }

  logger.error(
    { candidates },
    "Brandthread email logo asset is unavailable; emails will render without the logo",
  );
  return null;
}

const LOGO_CONTENT = loadLogoContent();

export function renderBrandthreadEmail(options: {
  preheader: string;
  eyebrow?: string;
  title: string;
  subtitle?: string;
  bodyHtml: string;
  cta?: { label: string; url: string };
  /** Seller branding for order emails: store logo + name replace the Brandthread mark in the header. */
  store?: EmailStoreBranding | null;
}): string {
  const storeLogoUrl = safeImageUrl(options.store?.logoUrl);
  const storeName = options.store?.name?.trim() || null;
  const logo = storeLogoUrl
    ? `<img src="${escapeHtml(storeLogoUrl)}" width="58" height="58" alt="${escapeHtml(storeName ?? "Store logo")}" style="display:block;width:58px;height:58px;object-fit:contain;border:0;border-radius:12px;background:#ffffff;" />`
    : LOGO_CONTENT
    ? `<img src="cid:brandthread-logo" width="58" height="58" alt="Brandthread" style="display:block;width:58px;height:58px;object-fit:contain;border:0;" />`
    : `<span style="display:block;width:58px;height:58px;color:#ffffff;font-size:38px;line-height:58px;font-weight:700;text-align:center;">B</span>`;
  const cta = options.cta
    ? `<table role="presentation" border="0" cellspacing="0" cellpadding="0" style="margin:28px 0 4px;">
        <tr>
          <td style="border-radius:999px;background:#111111;">
            <a href="${escapeHtml(options.cta.url)}" style="display:inline-block;padding:13px 22px;border:1px solid #111111;border-radius:999px;color:#ffffff;font-size:14px;font-weight:700;line-height:20px;text-decoration:none;">${escapeHtml(options.cta.label)}</a>
          </td>
        </tr>
      </table>`
    : "";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(options.title)}</title>
  </head>
  <body style="margin:0;padding:0;background:#f1f1f1;color:#111111;font-family:Arial,Helvetica,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(options.preheader)}</div>
    <table role="presentation" border="0" cellspacing="0" cellpadding="0" width="100%" style="width:100%;background:#f1f1f1;">
      <tr>
        <td align="center" style="padding:28px 12px;">
          <table role="presentation" border="0" cellspacing="0" cellpadding="0" width="620" style="width:100%;max-width:620px;">
            <tr>
              <td style="padding:28px 30px;background:linear-gradient(135deg,#050505 0%,#1d1d1d 45%,#dedede 100%);border-radius:20px 20px 0 0;">
                ${logo}
                <div style="margin-top:18px;color:#d8d8d8;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;">${storeName ? escapeHtml(storeName) : "BRANDTHREAD"}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:36px 34px 38px;background:#ffffff;border-left:1px solid #dddddd;border-right:1px solid #dddddd;">
                ${options.eyebrow ? `<div style="margin-bottom:10px;color:#747474;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;">${escapeHtml(options.eyebrow)}</div>` : ""}
                <h1 style="margin:0;color:#111111;font-size:30px;line-height:36px;letter-spacing:-0.5px;">${escapeHtml(options.title)}</h1>
                ${options.subtitle ? `<p style="margin:12px 0 0;color:#666666;font-size:16px;line-height:25px;">${escapeHtml(options.subtitle)}</p>` : ""}
                <div style="margin-top:26px;color:#252525;font-size:15px;line-height:24px;">${options.bodyHtml}</div>
                ${cta}
              </td>
            </tr>
            <tr>
              <td style="padding:22px 30px;background:#111111;border-radius:0 0 20px 20px;">
                <p style="margin:0;color:#d9d9d9;font-size:12px;line-height:18px;">Made for the people who make what’s next.</p>
                <p style="margin:8px 0 0;color:#858585;font-size:11px;line-height:17px;">© ${new Date().getFullYear()} Brandthread · This is a transactional message related to your Brandthread account or order.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

type ResendCredentials =
  | { mode: "connector" }
  | { mode: "env"; apiKey: string }
  | { mode: "none" };

/**
 * Resolved fresh on every send (not cached at module load) so a connector
 * added, removed, or reconfigured in Replit's Integrations takes effect
 * immediately, without an app restart.
 */
async function resolveResendCredentials(): Promise<ResendCredentials> {
  try {
    const connections = await connectors.listConnections({ connector_names: RESEND_CONNECTOR_NAME });
    const connection = connections.find((c) => c.connector_name === RESEND_CONNECTOR_NAME) ?? connections[0];
    if (connection) {
      return { mode: "connector" };
    }
  } catch (err) {
    logger.warn({ err }, "Unable to check the Resend connector; falling back to RESEND_API_KEY");
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (apiKey) return { mode: "env", apiKey };
  return { mode: "none" };
}

/** True when Resend can be reached, either via the connector or RESEND_API_KEY. */
export async function isBrandthreadEmailConfigured(): Promise<boolean> {
  return (await resolveResendCredentials()).mode !== "none";
}

export async function sendBrandthreadEmail({
  to,
  subject,
  html,
  text,
  replyTo,
  idempotencyKey,
}: BrandthreadEmailOptions): Promise<boolean> {
  const recipient = await deliveryAddressFor(to.trim());
  if (!recipient) {
    logger.warn({ subject }, "Brandthread email skipped because recipient is missing");
    return false;
  }

  const credentials = await resolveResendCredentials();
  if (credentials.mode === "none") {
    logger.warn({ subject }, "Brandthread email skipped because Resend is not configured");
    return false;
  }

  const mailFrom = process.env.MAIL_FROM?.trim();
  const resendFrom = process.env.RESEND_FROM_EMAIL?.trim();
  const senderSource = mailFrom ? "MAIL_FROM" : resendFrom ? "RESEND_FROM_EMAIL" : "default";
  const from = mailFrom || resendFrom || DEFAULT_FROM;
  logger.info({ senderSource }, "Brandthread email sender selected");

  const payload = {
    from,
    to: [recipient],
    subject,
    html,
    ...(text ? { text } : {}),
    ...(replyTo?.trim() ? { reply_to: replyTo.trim() } : {}),
    ...(LOGO_CONTENT && html.includes("cid:brandthread-logo")
      ? {
          attachments: [{
            filename: "brandthread-logo.png",
            content: LOGO_CONTENT,
            content_id: "brandthread-logo",
          }],
        }
      : {}),
  };

  try {
    const response = credentials.mode === "connector"
      ? await connectors.proxy(RESEND_CONNECTOR_NAME, "/emails", {
          method: "POST",
          body: payload,
          ...(idempotencyKey ? { headers: { "Idempotency-Key": idempotencyKey } } : {}),
        })
      : await fetch(RESEND_ENDPOINT, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${credentials.apiKey}`,
            "Content-Type": "application/json",
            ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
          },
          body: JSON.stringify(payload),
        });

    if (!response.ok) {
      logger.error({ statusCode: response.status, subject }, "Brandthread email provider request failed");
    }
    return response.ok;
  } catch (err) {
    logger.error({ err, subject }, "Brandthread email request failed");
    return false;
  }
}

export async function sendWelcomeEmail(options: {
  to: string;
  name: string;
  accountType?: "buyer" | "seller" | null;
  idempotencyKey: string;
}): Promise<boolean> {
  const roleLabel = options.accountType === "seller" ? "seller" : "buyer";
  const html = renderBrandthreadEmail({
    preheader: "Welcome to Brandthread.",
    eyebrow: "Your account is ready",
    title: `Welcome to Brandthread, ${options.name}`,
    subtitle: `Your ${roleLabel} account is ready to go.`,
    bodyHtml: options.accountType === "seller"
      ? "<p>Your creative workspace is ready. Start shaping your brand, publish products, and connect with the people who want what you make.</p>"
      : "<p>Your style space is ready. Discover independent brands, follow the makers you love, and find pieces made for your point of view.</p>",
    cta: { label: "Open Brandthread", url: "https://brandthread.app" },
  });
  return sendBrandthreadEmail({
    to: options.to,
    subject: `Welcome to Brandthread, ${options.name}`,
    html,
    idempotencyKey: options.idempotencyKey,
  });
}

/**
 * The day-5 trial reminder (Dev's trial decision): what is charged, when, and
 * a direct link to manage or cancel (Stripe on the web, the store page for an
 * in-app purchase).
 */
export async function sendTrialReminderEmail(options: {
  to: string;
  planLabel: string;
  amount: string;
  trialEndsAt: Date;
  manageUrl: string;
  idempotencyKey: string;
}): Promise<boolean> {
  const ends = options.trialEndsAt.toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });
  const plan = escapeHtml(options.planLabel);
  const html = renderBrandthreadEmail({
    preheader: `Your free trial ends ${ends}. Cancel anytime before then and you won't be charged.`,
    eyebrow: "Free trial reminder",
    title: `Your free trial ends ${ends}`,
    subtitle: `Your ${options.planLabel} plan starts then at ${options.amount}/month.`,
    bodyHtml: `<p>Your Brandthread <strong>${plan}</strong> plan will start on <strong>${escapeHtml(ends)}</strong> and your card will be charged <strong>${escapeHtml(options.amount)}</strong> per month.</p><p>Want to keep selling? You don't need to do anything. Changed your mind? Cancel before ${escapeHtml(ends)} and you won't be charged. Your store and products are kept.</p><p style="word-break:break-word;color:#666666;font-size:13px;">Manage or cancel here:<br />${escapeHtml(options.manageUrl)}</p>`,
    cta: { label: "Manage or cancel", url: options.manageUrl },
  });
  return sendBrandthreadEmail({
    to: options.to,
    subject: `Your Brandthread free trial ends ${ends}`,
    html,
    idempotencyKey: options.idempotencyKey,
  });
}

export async function sendTeamInviteEmail(options: {
  to: string;
  ownerName: string;
  role: string;
  inviteUrl: string;
  reminder?: boolean;
  idempotencyKey?: string;
}): Promise<boolean> {
  const role = escapeHtml(options.role);
  const ownerName = escapeHtml(options.ownerName);
  const inviteUrl = escapeHtml(options.inviteUrl);
  const html = renderBrandthreadEmail({
    preheader: options.reminder
      ? "Your Brandthread team invitation expires soon."
      : `${options.ownerName} invited you to Brandthread.`,
    eyebrow: options.reminder ? "Invitation reminder" : "Team invitation",
    title: options.reminder ? "Your invite expires soon" : "You’re invited to Brandthread",
    subtitle: `${options.ownerName} invited you to join their team as ${options.role}.`,
    bodyHtml: options.reminder
      ? `<p>This is a reminder that ${ownerName} invited you to join their Brandthread team as <strong>${role}</strong>.</p><p>Your invite link expires in approximately 24 hours.</p><p style="word-break:break-word;color:#666666;font-size:13px;">Or paste this link into your browser:<br />${inviteUrl}</p>`
      : `<p>${ownerName} invited you to join their Brandthread team as <strong>${role}</strong>.</p><p style="word-break:break-word;color:#666666;font-size:13px;">Or paste this link into your browser:<br />${inviteUrl}</p>`,
    cta: { label: "Accept the invite", url: options.inviteUrl },
  });
  const subject = options.reminder
    ? "Reminder: your Brandthread team invite expires soon"
    : `${options.ownerName} invited you to join their team on Brandthread`;
  return sendBrandthreadEmail({ to: options.to, subject, html, idempotencyKey: options.idempotencyKey });
}

/** Universal link to one order; brandthread.app/buyer-order-detail* is claimed in routes/wellKnown.ts. */
export function orderDeepLink(orderId: string): string {
  return `https://brandthread.app/buyer-order-detail?id=${encodeURIComponent(orderId)}`;
}

export type OrderDeliveryFacts = {
  isPreorder?: boolean | null;
  promisedShipDate?: Date | null;
  deliverBy?: Date | null;
  estimatedDelivery?: string | null;
};

function shortDate(value: Date): string {
  return value.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/**
 * The "Estimated delivery" line, worded like the app's order screen
 * (mobile lib/deliveryGuarantee.ts deliveryHeadline, before shipping):
 * "Seller ships by Oct 30" for a pre-order, else "Arrives by Oct 20" from the
 * delivery guarantee, else the carrier estimate. null when nothing is known,
 * so the email never invents a date.
 */
export function orderConfirmationDeliveryEstimate(facts: OrderDeliveryFacts | null | undefined): string | null {
  if (!facts) return null;
  const valid = (d: Date | null | undefined): d is Date => d instanceof Date && Number.isFinite(d.getTime());
  if (facts.isPreorder && valid(facts.promisedShipDate)) return `Seller ships by ${shortDate(facts.promisedShipDate)}`;
  if (valid(facts.deliverBy)) return `Arrives by ${shortDate(facts.deliverBy)}`;
  const eta = facts.estimatedDelivery?.trim();
  if (eta) {
    const parsed = new Date(eta);
    return valid(parsed) ? `Arriving ${shortDate(parsed)}` : null;
  }
  return null;
}

export const ORDERS_URL = "https://brandthread.app/orders";

/**
 * Everything the buyer receipt shows. Every field comes from the order rows
 * (orders, order_items, the seller's users row, gift-card ledger); optional
 * amounts render only when non-zero.
 */
export type OrderReceiptInput = {
  orderNumber: string;
  items: EmailLineItem[];
  subtotalCents: number;
  /** Discount code + loyalty, excluding Thread Cash (orders.discount_amount_cents - thread_cash_applied_cents). */
  discountCents?: number;
  threadCashCents?: number;
  giftCardCents?: number;
  shippingCents: number;
  taxCents?: number;
  totalCents: number;
  delivery?: OrderDeliveryFacts | null;
  orderId?: string | null;
  store?: EmailStoreBranding | null;
  shippingAddress?: EmailShippingAddress | null;
  orderUrl?: string;
};

type ReceiptRow = { label: string; value: string };

function receiptTotalsRows(input: OrderReceiptInput): ReceiptRow[] {
  const rows: ReceiptRow[] = [{ label: "Subtotal", value: formatCents(input.subtotalCents) }];
  const push = (label: string, cents: number | undefined, negative = false) => {
    if (cents && cents > 0) rows.push({ label, value: negative ? formatSignedCents(cents) : formatCents(cents) });
  };
  push("Discount", input.discountCents, true);
  push("Thread Cash", input.threadCashCents, true);
  push("Gift card", input.giftCardCents, true);
  push("Shipping", input.shippingCents);
  push("Taxes", input.taxCents);
  return rows;
}

function addressLines(address: EmailShippingAddress | null | undefined): string[] {
  if (!address) return [];
  const cityLine = [address.city, [address.state, address.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return [address.name, address.street, address.line2, cityLine, address.country]
    .map((line) => (typeof line === "string" ? line.trim() : ""))
    .filter(Boolean);
}

function receiptStoreName(input: OrderReceiptInput): string | null {
  return input.store?.name?.trim() || null;
}

export function renderOrderReceiptSubject(input: Pick<OrderReceiptInput, "orderNumber" | "store">): string {
  const storeName = input.store?.name?.trim();
  return storeName
    ? `Order ${input.orderNumber} confirmed - ${storeName}`
    : `Brandthread order ${input.orderNumber} confirmed`;
}

/**
 * Seller-branded buyer receipt, laid out 1:1 on Shopify's default
 * "Order confirmation" notification: store mark + order number, thank-you
 * title, "View your order" button, order summary with thumbnails, totals,
 * customer information, store-contact footer. Monochrome; table layout with
 * inline styles; max-width 600; dark-mode overrides for clients that honour
 * prefers-color-scheme.
 */
export function renderOrderReceiptHtml(input: OrderReceiptInput): string {
  const storeName = receiptStoreName(input);
  const storeLogoUrl = safeImageUrl(input.store?.logoUrl);
  const contactEmail = safeEmailAddress(input.store?.contactEmail);
  const orderUrl = input.orderUrl ?? (input.orderId ? orderDeepLink(input.orderId) : ORDERS_URL);
  const font = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

  const brandMark = storeLogoUrl
    ? `<img src="${escapeHtml(storeLogoUrl)}" height="40" alt="${escapeHtml(storeName ?? "Store logo")}" style="display:block;height:40px;width:auto;max-width:180px;border:0;outline:none;text-decoration:none;" />`
    : storeName
      ? `<span class="bt-text" style="font-size:24px;line-height:32px;font-weight:600;color:#111111;">${escapeHtml(storeName)}</span>`
      : LOGO_CONTENT
        ? `<img src="cid:brandthread-logo" width="40" height="40" alt="Brandthread" style="display:block;width:40px;height:40px;border:0;" />`
        : `<span class="bt-text" style="font-size:24px;line-height:32px;font-weight:600;color:#111111;">Brandthread</span>`;

  const itemsHtml = input.items.map((item) => {
    const imageUrl = safeImageUrl(item.imageUrl);
    const thumb = imageUrl
      ? `<img src="${escapeHtml(imageUrl)}" width="60" height="60" alt="" style="display:block;width:60px;height:60px;object-fit:cover;border:1px solid #e5e5e5;border-radius:8px;" />`
      : `<div class="bt-thumb" style="width:60px;height:60px;border:1px solid #e5e5e5;border-radius:8px;background:#f2f2f2;"></div>`;
    const each = item.quantity > 1
      ? `<br /><span class="bt-muted" style="color:#737373;font-size:14px;line-height:20px;">${formatCents(item.priceCents)} each</span>`
      : "";
    return `
                <tr>
                  <td width="60" valign="top" style="width:60px;padding:15px 0;">${thumb}</td>
                  <td valign="top" style="padding:15px 0 15px 15px;">
                    <span class="bt-text" style="color:#111111;font-size:16px;line-height:22px;font-weight:600;">${escapeHtml(item.productName)} &times;&nbsp;${escapeHtml(item.quantity)}</span>${item.variantLabel ? `<br /><span class="bt-muted" style="color:#737373;font-size:14px;line-height:20px;">${escapeHtml(item.variantLabel)}</span>` : ""}${each}
                  </td>
                  <td valign="top" align="right" style="padding:15px 0 15px 15px;white-space:nowrap;">
                    <span class="bt-text" style="color:#111111;font-size:16px;line-height:22px;font-weight:600;">${formatCents(item.priceCents * item.quantity)}</span>
                  </td>
                </tr>`;
  }).join("");

  const totalsHtml = receiptTotalsRows(input).map((row) => `
                <tr>
                  <td class="bt-muted" style="padding:2px 0;color:#737373;font-size:16px;line-height:24px;">${escapeHtml(row.label)}</td>
                  <td align="right" class="bt-text" style="padding:2px 0;color:#111111;font-size:16px;line-height:24px;font-weight:600;white-space:nowrap;">${row.value}</td>
                </tr>`).join("");

  const address = addressLines(input.shippingAddress);
  const customerInfo = address.length
    ? `
          <tr>
            <td class="bt-rule" style="padding:40px 0 0;border-top:1px solid #e5e5e5;">
              <h3 class="bt-text" style="margin:0 0 20px;color:#111111;font-size:20px;line-height:26px;font-weight:600;">Customer information</h3>
              <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">
                <tr>
                  <td valign="top" style="padding:0 0 24px;">
                    <h4 class="bt-text" style="margin:0 0 6px;color:#111111;font-size:16px;line-height:22px;font-weight:600;">Shipping address</h4>
                    <p class="bt-muted" style="margin:0;color:#737373;font-size:14px;line-height:21px;">${address.map(escapeHtml).join("<br />")}</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>`
    : "";

  const contactLine = contactEmail
    ? `<p class="bt-muted" style="margin:0 0 8px;color:#737373;font-size:14px;line-height:21px;">If you have any questions, reply to this email or contact us at <a href="mailto:${escapeHtml(contactEmail)}" class="bt-text" style="color:#111111;text-decoration:underline;">${escapeHtml(contactEmail)}</a></p>`
    : "";
  const soldBy = storeName
    ? `Sold by ${escapeHtml(storeName)} on Brandthread`
    : "Sold on Brandthread";
  const preheader = `Order ${input.orderNumber} is confirmed.`;
  const deliveryEstimate = orderConfirmationDeliveryEstimate(input.delivery);
  const deliveryHtml = deliveryEstimate ? `<p class="bt-text">Estimated delivery: ${escapeHtml(deliveryEstimate)}</p>` : "";

  return `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light dark" />
    <meta name="supported-color-schemes" content="light dark" />
    <title>Order ${escapeHtml(input.orderNumber)} confirmed</title>
    <style>
      body { margin:0; padding:0; -webkit-text-size-adjust:100%; }
      a { color:inherit; }
      @media (max-width:600px) {
        .bt-pad { padding-left:16px !important; padding-right:16px !important; }
        .bt-title { font-size:24px !important; line-height:30px !important; }
      }
      @media (prefers-color-scheme: dark) {
        .bt-bg { background:#000000 !important; }
        .bt-text { color:#f5f5f5 !important; }
        .bt-muted { color:#a3a3a3 !important; }
        .bt-rule { border-color:#2e2e2e !important; }
        .bt-thumb { background:#1c1c1c !important; border-color:#2e2e2e !important; }
        .bt-btn { background:#ffffff !important; }
        .bt-btn a { color:#000000 !important; }
      }
      [data-ogsc] .bt-text { color:#f5f5f5 !important; }
      [data-ogsc] .bt-muted { color:#a3a3a3 !important; }
      [data-ogsb] .bt-btn { background:#ffffff !important; }
      [data-ogsc] .bt-btn a { color:#000000 !important; }
    </style>
  </head>
  <body class="bt-bg" style="margin:0;padding:0;background:#ffffff;color:#111111;font-family:${font};">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all;">${escapeHtml(preheader)}</div>
    <table role="presentation" class="bt-bg" border="0" cellspacing="0" cellpadding="0" width="100%" bgcolor="#ffffff" style="width:100%;background:#ffffff;">
      <tr>
        <td align="center" class="bt-pad" style="padding:32px 24px;font-family:${font};">
          <table role="presentation" border="0" cellspacing="0" cellpadding="0" width="560" style="width:100%;max-width:560px;">
          <tr>
            <td style="padding:0 0 40px;">
              <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">
                <tr>
                  <td valign="middle">${brandMark}</td>
                  <td valign="middle" align="right" class="bt-muted" style="padding-left:16px;color:#737373;font-size:14px;line-height:20px;text-transform:uppercase;letter-spacing:0.5px;white-space:nowrap;">Order #${escapeHtml(input.orderNumber)}</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:0 0 40px;">
              <h2 class="bt-text bt-title" style="margin:0 0 8px;color:#111111;font-size:28px;line-height:34px;font-weight:600;">Thank you for your purchase!</h2>
              <p class="bt-muted" style="margin:0;color:#737373;font-size:16px;line-height:24px;">We&#39;re getting your order ready to be shipped. We will notify you when it has been sent.</p>
              <table role="presentation" border="0" cellspacing="0" cellpadding="0" style="margin-top:24px;">
                <tr>
                  <td class="bt-btn" align="center" bgcolor="#111111" style="border-radius:4px;background:#111111;">
                    <a href="${escapeHtml(orderUrl)}" style="display:inline-block;padding:16px 28px;color:#ffffff;font-size:16px;line-height:20px;font-weight:600;text-decoration:none;">${input.orderId ? "Track order" : "View your order"}</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td class="bt-rule" style="padding:40px 0;border-top:1px solid #e5e5e5;">
              ${deliveryHtml}<h3 class="bt-text" style="margin:0 0 8px;color:#111111;font-size:20px;line-height:26px;font-weight:600;">Order summary</h3>
              <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">${itemsHtml}
              </table>
              <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" class="bt-rule" style="margin-top:15px;border-top:1px solid #e5e5e5;">
                <tr><td colspan="2" style="height:15px;line-height:15px;font-size:0;">&nbsp;</td></tr>${totalsHtml}
              </table>
              <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" class="bt-rule" style="margin-top:15px;border-top:2px solid #e5e5e5;">
                <tr>
                  <td class="bt-muted" style="padding:20px 0 0;color:#737373;font-size:16px;line-height:24px;">Total</td>
                  <td align="right" class="bt-text" style="padding:20px 0 0;color:#111111;font-size:24px;line-height:30px;font-weight:600;white-space:nowrap;">${formatCents(input.totalCents)}</td>
                </tr>
              </table>
            </td>
          </tr>${customerInfo}
          <tr>
            <td class="bt-rule" style="padding:32px 0 0;border-top:1px solid #e5e5e5;">
              ${contactLine}
              <p class="bt-muted" style="margin:0;color:#737373;font-size:14px;line-height:21px;">${soldBy}</p>
            </td>
          </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/** Plain-text alternative of the receipt; same sections and amounts as the HTML. */
export function renderOrderReceiptText(input: OrderReceiptInput): string {
  const storeName = receiptStoreName(input);
  const contactEmail = safeEmailAddress(input.store?.contactEmail);
  const lines: string[] = [
    storeName ?? "Brandthread",
    `Order #${input.orderNumber}`,
    "",
    "Thank you for your purchase!",
    "We're getting your order ready to be shipped. We will notify you when it has been sent.",
    "",
    `${input.orderId ? "Track order" : "View your order"}: ${input.orderUrl ?? (input.orderId ? orderDeepLink(input.orderId) : ORDERS_URL)}`,
    ...(orderConfirmationDeliveryEstimate(input.delivery) ? [`Estimated delivery: ${orderConfirmationDeliveryEstimate(input.delivery)}`] : []),
    "",
    "Order summary",
  ];
  for (const item of input.items) {
    lines.push(`${item.productName} x ${item.quantity}  ${formatCents(item.priceCents * item.quantity)}`);
    if (item.variantLabel) lines.push(`  ${item.variantLabel}`);
    if (item.quantity > 1) lines.push(`  ${formatCents(item.priceCents)} each`);
  }
  lines.push("");
  for (const row of receiptTotalsRows(input)) lines.push(`${row.label}: ${row.value}`);
  lines.push(`Total: ${formatCents(input.totalCents)}`);
  const address = addressLines(input.shippingAddress);
  if (address.length) {
    lines.push("", "Customer information", "Shipping address", ...address);
  }
  lines.push("");
  if (contactEmail) lines.push(`If you have any questions, reply to this email or contact us at ${contactEmail}`);
  lines.push(storeName ? `Sold by ${storeName} on Brandthread` : "Sold on Brandthread");
  return lines.join("\n");
}

export function buildOrderConfirmationEmail(options: OrderReceiptInput): {subject: string; html: string} {
  return {subject: renderOrderReceiptSubject(options), html: renderOrderReceiptHtml(options)};
}

export async function sendOrderConfirmationEmail(options: OrderReceiptInput & {
  to: string;
  idempotencyKey: string;
}): Promise<boolean> {
  const { to, idempotencyKey, ...receipt } = options;
  return sendBrandthreadEmail({
    to,
    subject: renderOrderReceiptSubject(receipt),
    html: renderOrderReceiptHtml(receipt),
    text: renderOrderReceiptText(receipt),
    replyTo: safeEmailAddress(receipt.store?.contactEmail) ?? undefined,
    idempotencyKey,
  });
}

export async function sendOrderShippingEmail(options: {
  to: string;
  orderNumber: string;
  carrier?: string | null;
  trackingNumber?: string | null;
  trackingUpdate?: boolean;
  store?: EmailStoreBranding | null;
  idempotencyKey: string;
}): Promise<boolean> {
  const tracking = options.trackingNumber
    ? `<p style="margin-bottom:0;"><strong>Tracking number:</strong> ${escapeHtml(options.trackingNumber)}</p>`
    : "<p style=\"margin-bottom:0;\">Tracking details will appear as soon as they’re available.</p>";
  const carrier = options.carrier ? ` via ${escapeHtml(options.carrier)}` : "";
  const html = renderBrandthreadEmail({
    preheader: `Order ${options.orderNumber} is on its way.`,
    eyebrow: "Shipping update",
    title: options.trackingUpdate ? "Your tracking details are ready" : "Your order is on its way",
    subtitle: options.trackingUpdate
      ? `Tracking was updated for order ${options.orderNumber}${carrier}.`
      : `Order ${options.orderNumber} has shipped${carrier}.`,
    bodyHtml: `<p>${options.trackingUpdate ? "Use the details below to follow your package." : "Your package is moving toward you. Keep this email for your shipping details."}</p>${tracking}`,
    cta: { label: "Track your order", url: "https://brandthread.app/orders" },
    store: options.store,
  });
  return sendBrandthreadEmail({
    to: options.to,
    subject: options.trackingUpdate
      ? `Tracking updated for Brandthread order ${options.orderNumber}`
      : `Your Brandthread order ${options.orderNumber} has shipped`,
    html,
    idempotencyKey: options.idempotencyKey,
  });
}

export async function sendReturnStatusEmail(options: {
  to: string;
  orderNumber: string;
  status: "pending" | "approved" | "denied" | "refunded";
  refundAmountCents?: number | null;
  sellerResponse?: string | null;
  store?: EmailStoreBranding | null;
  idempotencyKey: string;
}): Promise<boolean> {
  const statusCopy: Record<typeof options.status, { title: string; subtitle: string; body: string }> = {
    pending: {
      title: "Return request received",
      subtitle: `We received your return request for order ${options.orderNumber}.`,
      body: "The seller will review your request and you’ll receive another update when a decision is made.",
    },
    approved: {
      title: "Your return was approved",
      subtitle: `Your return request for order ${options.orderNumber} was approved.`,
      body: "The seller approved your return request. Your refund will be processed once the payment provider confirms the transaction.",
    },
    denied: {
      title: "Return request update",
      subtitle: `Your return request for order ${options.orderNumber} was not approved.`,
      body: "The seller has declined this return request. Review the response below or reach out through Brandthread if you need help.",
    },
    refunded: {
      title: "Your refund is on the way",
      subtitle: `A refund was issued for order ${options.orderNumber}.`,
      body: options.refundAmountCents != null
        ? `We issued a refund of <strong>${formatCents(options.refundAmountCents)}</strong> to your original payment method.`
        : "We issued a refund to your original payment method.",
    },
  };
  const copy = statusCopy[options.status];
  const response = options.sellerResponse
    ? `<p style="padding:14px 16px;background:#f5f5f5;border-left:3px solid #bcbcbc;"><strong>Seller response</strong><br />${escapeHtml(options.sellerResponse)}</p>`
    : "";
  const html = renderBrandthreadEmail({
    preheader: copy.subtitle,
    eyebrow: "Returns & refunds",
    title: copy.title,
    subtitle: copy.subtitle,
    bodyHtml: `<p>${copy.body}</p>${response}<p style="margin-bottom:0;color:#666666;">You can review the full request and its status in your Brandthread account.</p>`,
    cta: { label: "View return status", url: "https://brandthread.app/returns" },
    store: options.store,
  });
  return sendBrandthreadEmail({
    to: options.to,
    subject: `Brandthread return update for order ${options.orderNumber}`,
    html,
    idempotencyKey: options.idempotencyKey,
  });
}

export async function sendPayoutEmail(options: {
  to: string;
  amountCents: number;
  currency?: string | null;
  payoutId: string;
  idempotencyKey?: string;
}): Promise<boolean> {
  const currency = (options.currency ?? "USD").toUpperCase();
  const amount = currency === "USD"
    ? formatCents(options.amountCents)
    : `${(Math.max(0, options.amountCents) / 100).toFixed(2)} ${escapeHtml(currency)}`;
  const html = renderBrandthreadEmail({
    preheader: `${amount} was sent to your bank account.`,
    eyebrow: "Payout sent",
    title: "Your payout is on its way",
    subtitle: `${amount} was sent to your bank account.`,
    bodyHtml: `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;"><tr><td style="padding:12px 0;border-bottom:1px solid #eeeeee;color:#666666;">Amount</td><td align="right" style="padding:12px 0;border-bottom:1px solid #eeeeee;font-weight:700;">${amount}</td></tr><tr><td style="padding:12px 0;color:#666666;">Sent</td><td align="right" style="padding:12px 0;">${formatDate()}</td></tr></table><p style="margin-bottom:0;color:#666666;">Banks can take a few business days to show the deposit.</p>`,
    cta: { label: "View payouts", url: "https://brandthread.app/payouts" },
  });
  return sendBrandthreadEmail({
    to: options.to,
    subject: `Brandthread payout of ${amount} sent`,
    html,
    idempotencyKey: options.idempotencyKey ?? `payout-sent/${options.payoutId}`,
  });
}

export async function sendReviewRequestEmail(options: {
  to: string;
  orderId: string;
  orderNumber: string;
  productName?: string | null;
  idempotencyKey: string;
}): Promise<boolean> {
  const what = options.productName?.trim() || `order ${options.orderNumber}`;
  const html = renderBrandthreadEmail({
    preheader: `Rate ${what}.`,
    eyebrow: "Your review",
    title: "How was your order?",
    subtitle: `Rate ${what} and help other shoppers decide.`,
    bodyHtml: "",
    cta: {
      label: "Leave a review",
      url: `https://brandthread.app/buyer-order-detail?id=${encodeURIComponent(options.orderId)}&review=1`,
    },
  });
  return sendBrandthreadEmail({
    to: options.to,
    subject: `How was your Brandthread order ${options.orderNumber}?`,
    html,
    idempotencyKey: options.idempotencyKey,
  });
}

export async function sendAbandonedCartEmail(options: {
  to: string;
  items: EmailLineItem[];
  idempotencyKey: string;
}): Promise<boolean> {
  const shown = options.items.slice(0, 4);
  const more = options.items.length - shown.length;
  const itemsHtml = shown.map((item) => `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid #eeeeee;"><strong>${escapeHtml(item.productName)}</strong>${item.variantLabel ? `<br /><span style="color:#777777;font-size:13px;">${escapeHtml(item.variantLabel)}</span>` : ""}<br /><span style="color:#777777;font-size:13px;">Qty ${escapeHtml(item.quantity)}</span></td>
      <td align="right" style="padding:10px 0;border-bottom:1px solid #eeeeee;vertical-align:top;">${formatCents(item.priceCents * item.quantity)}</td>
    </tr>`).join("");
  const html = renderBrandthreadEmail({
    preheader: "The items in your cart are still waiting.",
    eyebrow: "Your cart",
    title: "You left something behind",
    subtitle: "The items below are still in your cart.",
    bodyHtml: `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">${itemsHtml}</table>${more > 0 ? `<p style="margin-bottom:0;color:#666666;">and ${more} more</p>` : ""}`,
    cta: { label: "Return to your cart", url: "https://brandthread.app/cart" },
  });
  return sendBrandthreadEmail({
    to: options.to,
    subject: "You left something in your Brandthread cart",
    html,
    idempotencyKey: options.idempotencyKey,
  });
}

export async function sendManufacturerSignupEmail(options: {
  to: string;
  businessName: string;
  invited?: boolean;
  idempotencyKey: string;
}): Promise<boolean> {
  const html = renderBrandthreadEmail({
    preheader: "Your Brandthread manufacturer profile is ready.",
    eyebrow: "Manufacturer Hub",
    title: "Your manufacturer profile is ready",
    subtitle: `${options.businessName} is now part of Brandthread’s manufacturing network.`,
    bodyHtml: options.invited
      ? "<p>Your invited manufacturer registration is complete. Sellers can now discover your profile and start a conversation through Manufacturer Hub.</p>"
      : "<p>Thanks for registering with Brandthread. Your manufacturer profile is ready for review and for connecting with independent sellers.</p>",
    cta: { label: "Open Manufacturer Hub", url: "https://brandthread.app/manufacturer-hub" },
  });
  return sendBrandthreadEmail({
    to: options.to,
    subject: "Your Brandthread manufacturer signup is confirmed",
    html,
    idempotencyKey: options.idempotencyKey,
  });
}

export async function sendIpCaseInformationRequestEmail(options: {
  to: string;
  caseReference: string;
  requestedInformation: string;
  idempotencyKey: string;
}): Promise<boolean> {
  const html = renderBrandthreadEmail({
    preheader: `More information is needed for case ${options.caseReference}.`,
    eyebrow: "Rights-holder case",
    title: "More information is needed",
    subtitle: `Brandthread is reviewing case ${options.caseReference}.`,
    bodyHtml: `<p>Our safety team needs the following information to continue its review:</p>
      <p style="padding:14px 16px;background:#f5f5f5;border-left:3px solid #111111;">${escapeHtml(options.requestedInformation)}</p>
      <p style="margin-bottom:0;color:#666666;">Reply to the original case correspondence with the requested material. Keep your case reference in the subject line.</p>`,
  });
  return sendBrandthreadEmail({
    to: options.to,
    subject: `Information requested for Brandthread case ${options.caseReference}`,
    html,
    idempotencyKey: options.idempotencyKey,
  });
}

/**
 * Seller notice that a listing was taken down after an intellectual-property
 * report. Includes the case reference and how to file a counter-notice.
 */
export async function sendIpTakedownSellerEmail(options: {
  to: string;
  caseReference: string;
  listingName: string | null;
  rightsType: string;
  strikeCount: number;
  flaggedRepeatInfringer: boolean;
  idempotencyKey: string;
}): Promise<boolean> {
  const listing = options.listingName ? `“${escapeHtml(options.listingName)}”` : "One of your listings";
  const warning = options.flaggedRepeatInfringer
    ? "<p><strong>Your account has been flagged under our repeat-infringer policy.</strong> Further reports may lead to suspension.</p>"
    : `<p>This takedown counts as strike ${options.strikeCount} under our repeat-infringer policy. Repeated infringement leads to account suspension.</p>`;
  const html = renderBrandthreadEmail({
    preheader: `A listing was removed after an IP report (${options.caseReference}).`,
    eyebrow: "Intellectual property",
    title: "A listing was taken down",
    subtitle: `Case ${options.caseReference}`,
    bodyHtml: `<p>${listing} was removed from Brandthread after a ${escapeHtml(options.rightsType)} report from a rights holder.</p>
      ${warning}
      <p>If you believe this was a mistake, reply to this email within 10 business days with a counter-notice that includes your full name and contact details, a description of the removed listing, a statement under penalty of perjury that you have a good-faith belief it was removed by mistake or misidentification, and your consent to resolve any dispute in the courts of your location. Keep the case reference in the subject line.</p>
      <p style="margin-bottom:0;color:#666666;">Questions: legal@brandthread.app</p>`,
  });
  return sendBrandthreadEmail({
    to: options.to,
    subject: `Brandthread listing taken down - case ${options.caseReference}`,
    html,
    idempotencyKey: options.idempotencyKey,
  });
}

export async function sendIpCounterNoticeOutcomeEmail(options: {
  to: string;
  caseReference: string;
  outcome: "reinstated" | "upheld";
  idempotencyKey: string;
}): Promise<boolean> {
  const reinstated = options.outcome === "reinstated";
  const html = renderBrandthreadEmail({
    preheader: `Counter-notice decision for case ${options.caseReference}.`,
    eyebrow: "Intellectual property",
    title: reinstated ? "Your listing was reinstated" : "The takedown stands",
    subtitle: `Case ${options.caseReference}`,
    bodyHtml: reinstated
      ? "<p>We reviewed your counter-notice and restored the listing. The strike for this case was removed from your account.</p>"
      : "<p>We reviewed your counter-notice and the takedown stands. The rights holder may pursue the matter further; the listing will stay removed.</p>",
  });
  return sendBrandthreadEmail({
    to: options.to,
    subject: `Brandthread counter-notice decision - case ${options.caseReference}`,
    html,
    idempotencyKey: options.idempotencyKey,
  });
}

export { escapeHtml, formatCents, formatDate, safeEmailAddress, safeImageUrl };