/**
 * Transactional auth mail — password reset codes, and the welcome email
 * complement — sent through the `resend` npm package specifically (owner
 * requirement), configured by RESEND_API_KEY + MAIL_FROM.
 *
 * This is deliberately separate from brandthreadEmail.ts (order/return/team
 * invite email, sent via a raw fetch against Resend's REST API or the
 * Replit connector): that module is untouched. This one reuses its branded
 * HTML template (`renderBrandthreadEmail`) so the visual language stays
 * identical, but owns its own Resend client and its own "is this configured"
 * check for the auth flows that must never silently no-op.
 */
import { Resend } from "resend";
import { logger } from "./logger";
import { renderBrandthreadEmail } from "./brandthreadEmail";

const DEFAULT_FROM = "Brandthread <no-reply@brandthread.app>";

let cachedClient: Resend | null = null;
let cachedApiKey: string | undefined;

/** Resolved fresh on every send so a key set after boot takes effect without a restart. */
function resendClient(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  if (!cachedClient || cachedApiKey !== apiKey) {
    cachedClient = new Resend(apiKey);
    cachedApiKey = apiKey;
  }
  return cachedClient;
}

function fromAddress(): string {
  return process.env.MAIL_FROM?.trim() || process.env.RESEND_FROM_EMAIL?.trim() || DEFAULT_FROM;
}

/** True when RESEND_API_KEY is set and the mailer can actually send. */
export function isMailerConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim());
}

async function send(options: { to: string; subject: string; html: string }): Promise<boolean> {
  const client = resendClient();
  if (!client) {
    logger.warn(
      { subject: options.subject },
      "Auth email skipped: RESEND_API_KEY is not set. Set RESEND_API_KEY and MAIL_FROM in Replit Secrets to enable transactional auth email.",
    );
    return false;
  }
  try {
    const { error } = await client.emails.send({
      from: fromAddress(),
      to: [options.to],
      subject: options.subject,
      html: options.html,
    });
    if (error) {
      logger.error({ err: error, subject: options.subject }, "Resend auth email send failed");
      return false;
    }
    return true;
  } catch (err) {
    logger.error({ err, subject: options.subject }, "Resend auth email request failed");
    return false;
  }
}

/** 6-digit password reset code. 15-minute expiry, single use — enforced by the caller/DB row. */
export async function sendPasswordResetEmail(options: { to: string; code: string }): Promise<boolean> {
  const html = renderBrandthreadEmail({
    preheader: "Your Brandthread password reset code",
    eyebrow: "Password reset",
    title: "Reset your password",
    subtitle: "Use this code to finish resetting your password. It expires in 15 minutes.",
    bodyHtml: `
      <p style="margin:0 0 18px;">Enter this code in the app:</p>
      <p style="margin:0 0 18px;font-family:'Courier New',monospace;font-size:34px;font-weight:700;letter-spacing:8px;color:#111111;text-align:center;">${options.code}</p>
      <p style="margin:0;color:#666666;">If you didn't request this, you can safely ignore this email — your password won't change.</p>
    `,
  });
  return send({ to: options.to, subject: "Your Brandthread password reset code", html });
}

/** 6-digit email verification code, for a future server-side verify-email flow. */
export async function sendVerifyEmailEmail(options: { to: string; code: string }): Promise<boolean> {
  const html = renderBrandthreadEmail({
    preheader: "Verify your email for Brandthread",
    eyebrow: "Verify your email",
    title: "Confirm it's you",
    subtitle: "Use this code to verify your email address. It expires in 15 minutes.",
    bodyHtml: `
      <p style="margin:0 0 18px;">Enter this code in the app:</p>
      <p style="margin:0 0 18px;font-family:'Courier New',monospace;font-size:34px;font-weight:700;letter-spacing:8px;color:#111111;text-align:center;">${options.code}</p>
      <p style="margin:0;color:#666666;">If you didn't request this, you can safely ignore this email.</p>
    `,
  });
  return send({ to: options.to, subject: "Verify your email for Brandthread", html });
}

/** Single-use link that lets the account owner confirm a web deletion request. */
export async function sendAccountDeletionEmail(options: { to: string; link: string }): Promise<boolean> {
  const html = renderBrandthreadEmail({
    preheader: "Confirm your Brandthread account deletion request",
    eyebrow: "Account deletion",
    title: "Confirm account deletion",
    subtitle: "Use this link to confirm the request. It expires in 60 minutes and works once.",
    bodyHtml: `
      <p style="margin:0 0 18px;">We received a request to permanently delete the Brandthread account for this email address. Nothing is deleted until you open the link and confirm.</p>
      <p style="margin:0;color:#666666;">If you didn't request this, ignore this email. Your account stays as it is.</p>
    `,
    cta: { label: "Confirm deletion", url: options.link },
  });
  return send({ to: options.to, subject: "Confirm your Brandthread account deletion", html });
}

/** 6-digit code confirming an account deletion request (accounts without a password). */
export async function sendAccountDeletionCodeEmail(options: { to: string; code: string }): Promise<boolean> {
  const html = renderBrandthreadEmail({
    preheader: "Your Brandthread account deletion code",
    eyebrow: "Delete account",
    title: "Confirm account deletion",
    subtitle: "Use this code to confirm you want to delete your account. It expires in 15 minutes.",
    bodyHtml: `
      <p style="margin:0 0 18px;">Enter this code in the app:</p>
      <p style="margin:0 0 18px;font-family:'Courier New',monospace;font-size:34px;font-weight:700;letter-spacing:8px;color:#111111;text-align:center;">${options.code}</p>
      <p style="margin:0;color:#666666;">If you didn't request this, ignore this email and consider changing your sign-in method. Nothing will be deleted without this code.</p>
    `,
  });
  return send({ to: options.to, subject: "Your Brandthread account deletion code", html });
}

/** "Your data export is ready" — link is a 7-day, single-purpose download token. */
export async function sendDataExportReadyEmail(options: {
  to: string;
  downloadUrl: string;
  expiresAt: Date;
}): Promise<boolean> {
  const expires = options.expiresAt.toUTCString();
  const html = renderBrandthreadEmail({
    preheader: "Your Brandthread data export is ready",
    eyebrow: "Your data",
    title: "Your data export is ready",
    subtitle: "Download a copy of the information you asked for.",
    bodyHtml: `
      <p style="margin:0 0 18px;"><a href="${options.downloadUrl}" style="display:inline-block;background:#111111;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:10px;">Download my data</a></p>
      <p style="margin:0 0 12px;color:#666666;">This link expires on ${expires}. Anyone with the link can download the file, so don't share it.</p>
      <p style="margin:0;color:#666666;">If you didn't request this, secure your account by changing your password.</p>
    `,
  });
  return send({ to: options.to, subject: "Your Brandthread data export is ready", html });
}

export type RawEmailResult =
  | { ok: true; id: string | null }
  | { ok: false; error: string; retryable: boolean };

/** The bare address inside MAIL_FROM ("Name <a@b.com>" -> "a@b.com"). */
export function mailFromAddress(): string {
  const from = fromAddress();
  const match = from.match(/<([^>]+)>/);
  return (match ? match[1] : from).trim();
}

/**
 * Generic send used by seller email marketing: same Resend client and
 * MAIL_FROM as the auth mail above, but with caller-supplied sender name,
 * reply-to, text part and headers (List-Unsubscribe). Returns the provider's
 * message id so delivery events can be matched back to a recipient.
 */
export async function sendRawEmail(options: {
  to: string;
  subject: string;
  html: string;
  text?: string;
  fromName?: string | null;
  replyTo?: string | null;
  headers?: Record<string, string>;
}): Promise<RawEmailResult> {
  const client = resendClient();
  if (!client) return { ok: false, error: "RESEND_API_KEY is not set", retryable: false };
  const from = options.fromName ? `${options.fromName} <${mailFromAddress()}>` : fromAddress();
  try {
    const { data, error } = await client.emails.send({
      from,
      to: [options.to],
      subject: options.subject,
      html: options.html,
      ...(options.text ? { text: options.text } : {}),
      ...(options.replyTo ? { replyTo: options.replyTo } : {}),
      ...(options.headers ? { headers: options.headers } : {}),
    });
    if (error) {
      const status = (error as { statusCode?: number | null }).statusCode ?? 0;
      const name = String((error as { name?: string }).name ?? "");
      logger.error({ err: error }, "Resend marketing email send failed");
      return {
        ok: false,
        error: String((error as { message?: string }).message ?? name ?? "send failed").slice(0, 300),
        retryable: status === 429 || status >= 500 || name === "rate_limit_exceeded",
      };
    }
    return { ok: true, id: data?.id ?? null };
  } catch (err) {
    logger.error({ err }, "Resend marketing email request failed");
    return { ok: false, error: "Email provider request failed", retryable: true };
  }
}
