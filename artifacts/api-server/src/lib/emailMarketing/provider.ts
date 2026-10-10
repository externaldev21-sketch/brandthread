/**
 * Provider seam for seller email. The default (and only built-in) provider is
 * Resend on the separate marketing sender (marketingMailer.ts:
 * MARKETING_MAIL_FROM, never the auth MAIL_FROM). klaviyo.ts only
 * validates a seller's own Klaviyo key and reads counts; it cannot send, so it
 * is not a provider here. Tests inject a mock with setEmailProvider().
 */
import type { RawEmailResult } from "../mailer";
import { isMarketingMailerConfigured, sendMarketingEmail } from "./marketingMailer";

export type OutboundEmail = {
  to: string;
  subject: string;
  html: string;
  text: string;
  fromName?: string | null;
  replyTo?: string | null;
  headers?: Record<string, string>;
};

export interface EmailProvider {
  name: string;
  isConfigured(): boolean;
  send(email: OutboundEmail): Promise<RawEmailResult>;
}

export const resendProvider: EmailProvider = {
  name: "resend",
  isConfigured: () => isMarketingMailerConfigured(),
  send: (email) => sendMarketingEmail(email),
};

let override: EmailProvider | null = null;

export function getEmailProvider(): EmailProvider {
  return override ?? resendProvider;
}

/** Test seam: pass null to restore the real provider. */
export function setEmailProvider(provider: EmailProvider | null): void {
  override = provider;
}

/** Whether Resend webhooks (delivered / opened / clicked / bounced) can be verified. */
export function isTrackingConfigured(): boolean {
  return Boolean(process.env.RESEND_WEBHOOK_SECRET?.trim());
}
