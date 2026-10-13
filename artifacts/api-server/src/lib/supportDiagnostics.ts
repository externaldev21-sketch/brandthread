/**
 * Device/app details the mobile app attaches to a support ticket ("Report a
 * problem"). Only these keys are kept, each trimmed to a short string, so a
 * client can never stuff arbitrary or oversized data into the ticket.
 */
export const SUPPORT_DIAGNOSTIC_KEYS = [
  "appVersion",
  "buildNumber",
  "platform",
  "osVersion",
  "deviceModel",
  "updateId",
  "updateChannel",
  "locale",
  "orderId",
] as const;

export type SupportDiagnostics = Partial<Record<(typeof SUPPORT_DIAGNOSTIC_KEYS)[number], string>>;

const MAX_VALUE_LENGTH = 120;

export function sanitizeSupportDiagnostics(input: unknown): SupportDiagnostics | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const source = input as Record<string, unknown>;
  const out: SupportDiagnostics = {};
  for (const key of SUPPORT_DIAGNOSTIC_KEYS) {
    const value = source[key];
    if (typeof value !== "string" && typeof value !== "number") continue;
    const text = String(value).trim().slice(0, MAX_VALUE_LENGTH);
    if (text) out[key] = text;
  }
  return Object.keys(out).length > 0 ? out : null;
}
