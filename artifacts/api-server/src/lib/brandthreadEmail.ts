import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { ReplitConnectors } from "@replit/connectors-sdk";
import { logger } from "./logger";

const DEFAULT_FROM = "Brandthread <no-reply@brandthread.app>";
const RESEND_ENDPOINT = "https://api.resend.com/emails";
const RESEND_CONNECTOR_NAME = "resend";

const connectors = new ReplitConnectors();

export type EmailLineItem = {
  productName: string;
  variantLabel?: string | null;
  quantity: number;
  priceCents: number;
};

export type BrandthreadEmailOptions = {
  to: string;
  subject: string;
  html: string;
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
}): string {
  const logo = LOGO_CONTENT
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
                <div style="margin-top:18px;color:#d8d8d8;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;">BRANDTHREAD</div>
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
  | { mode: "connector"; fromEmail?: string }
  | { mode: "env"; apiKey: string }
  | { mode: "none" };

/**
 * Best-effort extraction of a default sender configured on the Replit
 * connector. The connector's metadata shape isn't part of the SDK's typed
 * surface, so this probes the field names Replit connectors commonly use
 * instead of assuming one.
 */
function connectionFromEmail(connection: Record<string, unknown>): string | undefined {
  const metadata = (connection.metadata ?? {}) as Record<string, unknown>;
  const integration = (connection.integration ?? {}) as Record<string, unknown>;
  const settings = (integration.settings ?? {}) as Record<string, unknown>;
  const candidates = [
    metadata.from_email,
    metadata.fromEmail,
    integration.from_email,
    integration.fromEmail,
    settings.from_email,
    settings.fromEmail,
  ];
  const found = candidates.find(
    (value): value is string => typeof value === "string" && value.trim().length > 0,
  );
  return found?.trim();
}

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
      return { mode: "connector", fromEmail: connectionFromEmail(connection) };
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
  idempotencyKey,
}: BrandthreadEmailOptions): Promise<boolean> {
  const recipient = to.trim();
  if (!recipient) {
    logger.warn({ subject }, "Brandthread email skipped because recipient is missing");
    return false;
  }

  const credentials = await resolveResendCredentials();
  if (credentials.mode === "none") {
    logger.warn({ subject }, "Brandthread email skipped because Resend is not configured");
    return false;
  }

  const from = process.env.RESEND_FROM_EMAIL
    ?? (credentials.mode === "connector" ? credentials.fromEmail : undefined)
    ?? DEFAULT_FROM;

  const payload = {
    from,
    to: [recipient],
    subject,
    html,
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

export async function sendOrderConfirmationEmail(options: {
  to: string;
  orderNumber: string;
  items: EmailLineItem[];
  subtotalCents: number;
  shippingCents: number;
  totalCents: number;
  idempotencyKey: string;
}): Promise<boolean> {
  const itemsHtml = options.items.map((item) => `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid #eeeeee;"><strong>${escapeHtml(item.productName)}</strong>${item.variantLabel ? `<br /><span style="color:#777777;font-size:13px;">${escapeHtml(item.variantLabel)}</span>` : ""}<br /><span style="color:#777777;font-size:13px;">Qty ${escapeHtml(item.quantity)}</span></td>
      <td align="right" style="padding:10px 0;border-bottom:1px solid #eeeeee;vertical-align:top;">${formatCents(item.priceCents * item.quantity)}</td>
    </tr>`).join("");
  const html = renderBrandthreadEmail({
    preheader: `Order ${options.orderNumber} is confirmed.`,
    eyebrow: "Order confirmed",
    title: "Thanks for your order",
    subtitle: `Order ${options.orderNumber} is confirmed and being prepared.`,
    bodyHtml: `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">${itemsHtml}<tr><td style="padding:16px 0 4px;color:#666666;">Subtotal</td><td align="right" style="padding:16px 0 4px;">${formatCents(options.subtotalCents)}</td></tr><tr><td style="padding:4px 0;color:#666666;">Shipping</td><td align="right" style="padding:4px 0;">${options.shippingCents ? formatCents(options.shippingCents) : "Free"}</td></tr><tr><td style="padding:12px 0 0;font-size:17px;font-weight:700;">Total</td><td align="right" style="padding:12px 0 0;font-size:17px;font-weight:700;">${formatCents(options.totalCents)}</td></tr></table><p style="margin-bottom:0;color:#666666;">We’ll send another note when your order is on the way.</p>`,
    cta: { label: "View your order", url: "https://brandthread.app/orders" },
  });
  return sendBrandthreadEmail({
    to: options.to,
    subject: `Brandthread order ${options.orderNumber} confirmed`,
    html,
    idempotencyKey: options.idempotencyKey,
  });
}

export async function sendOrderShippingEmail(options: {
  to: string;
  orderNumber: string;
  carrier?: string | null;
  trackingNumber?: string | null;
  trackingUpdate?: boolean;
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
  });
  return sendBrandthreadEmail({
    to: options.to,
    subject: `Brandthread return update for order ${options.orderNumber}`,
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

export { escapeHtml, formatCents, formatDate };