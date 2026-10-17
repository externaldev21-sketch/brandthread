// Pure Login-alerts decisions (unit-tested); the DB + email side is loginAlerts.ts.

/** Short, human device label from a User-Agent ("iPhone", "Android", "Mac", …). Pure. */
export function describeDevice(userAgent: string | null | undefined): string {
  const ua = (userAgent ?? "").toLowerCase();
  if (!ua) return "Unknown device";
  if (ua.includes("iphone")) return "iPhone";
  if (ua.includes("ipad")) return "iPad";
  if (ua.includes("android")) return "Android device";
  if (ua.includes("expo") || ua.includes("okhttp") || ua.includes("cfnetwork")) return "Brandthread app";
  if (ua.includes("macintosh") || ua.includes("mac os")) return "Mac";
  if (ua.includes("windows")) return "Windows PC";
  if (ua.includes("linux")) return "Linux computer";
  return "Web browser";
}

/**
 * Decides whether a sign-in should alert: only a session id this account has
 * never been seen with, and only when the account already had another
 * recorded session (its very first recorded session is the baseline, never a
 * "new" sign-in). Pure.
 */
export function shouldSendLoginAlert(opts: { isNewSession: boolean; priorSessionCount: number; loginAlertsEnabled: boolean }): boolean {
  return opts.isNewSession && opts.priorSessionCount > 0 && opts.loginAlertsEnabled;
}
