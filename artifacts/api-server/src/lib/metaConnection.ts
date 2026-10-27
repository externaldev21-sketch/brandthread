/**
 * Meta connection lifecycle shared by routes/meta-ads.ts and metaAdsLaunch.ts:
 *
 * - connectionState(): the one place that decides what the app is told
 *   (not connected / pick accounts / connected / needs reconnect).
 * - getFreshAccessToken(): decrypts the stored long-lived user token, marks
 *   the row `needs_reauth` once it has expired, and tries to extend it via
 *   fb_exchange_token when it is within TOKEN_REFRESH_WINDOW_MS of expiry.
 *   Meta does not promise a later expiry from that exchange; when it doesn't
 *   give one, the token is used until it expires and the seller is then asked
 *   to reconnect.
 * - metaSandbox() / marketingTarget(): META_ADS_SANDBOX=1 points every
 *   Marketing API call at a sandbox ad account (no real spend).
 */
import { db, metaAdAccounts } from "@workspace/db";
import { eq } from "drizzle-orm";
import { decryptToken, encryptToken } from "./metaCrypto";
import { MetaGraphError, debugToken, getLongLivedToken } from "./metaGraph";

export type MetaAdAccountRow = typeof metaAdAccounts.$inferSelect;

/** What GET /meta-ads/connection reports as `state` (plus 'not_configured'). */
export type MetaConnectionState = "not_connected" | "pending_selection" | "connected" | "needs_reconnect";

/** Long-lived user tokens last ~60 days; try to extend them in their last week. */
export const TOKEN_REFRESH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** Don't re-ask Meta on every request when an exchange didn't extend the token. */
const REFRESH_RETRY_MS = 12 * 60 * 60 * 1000;

export const RECONNECT_MESSAGE = "Your Meta connection expired — reconnect Meta to keep managing your ads.";

export class MetaReconnectRequiredError extends Error {
  userMessage: string;
  constructor(userMessage: string = RECONNECT_MESSAGE) {
    super(userMessage);
    this.name = "MetaReconnectRequiredError";
    this.userMessage = userMessage;
  }
}

export function connectionState(
  row: Pick<MetaAdAccountRow, "status" | "accessTokenEncrypted" | "tokenExpiresAt"> | null | undefined,
  now: Date = new Date(),
): MetaConnectionState {
  if (!row || !row.accessTokenEncrypted || row.status === "disconnected") return "not_connected";
  if (row.status === "needs_reauth") return "needs_reconnect";
  if (row.tokenExpiresAt && row.tokenExpiresAt.getTime() <= now.getTime()) return "needs_reconnect";
  return row.status === "connected" ? "connected" : "pending_selection";
}

export async function markNeedsReconnect(accountId: string, reason: string = RECONNECT_MESSAGE): Promise<void> {
  await db
    .update(metaAdAccounts)
    .set({ status: "needs_reauth", lastError: reason, updatedAt: new Date() })
    .where(eq(metaAdAccounts.id, accountId));
}

const lastRefreshAttempt = new Map<string, number>();

/** Test hook: forget refresh throttling between cases. */
export function resetTokenRefreshThrottle(): void {
  lastRefreshAttempt.clear();
}

/**
 * The decrypted token for Graph calls. Throws MetaReconnectRequiredError
 * (after marking the row) when the token is expired or Meta says it is no
 * longer valid; lets decryptToken's error through when the encryption key is
 * missing so callers can answer "not configured".
 */
export async function getFreshAccessToken(row: MetaAdAccountRow, now: Date = new Date()): Promise<string> {
  if (connectionState(row, now) === "needs_reconnect") {
    if (row.status !== "needs_reauth") await markNeedsReconnect(row.id);
    throw new MetaReconnectRequiredError();
  }
  const token = decryptToken(row.accessTokenEncrypted);
  const expiresAt = row.tokenExpiresAt;
  if (!expiresAt || expiresAt.getTime() - now.getTime() > TOKEN_REFRESH_WINDOW_MS) return token;

  const last = lastRefreshAttempt.get(row.id);
  if (last !== undefined && now.getTime() - last < REFRESH_RETRY_MS) return token;
  lastRefreshAttempt.set(row.id, now.getTime());

  try {
    const exchanged = await getLongLivedToken(token);
    const newExpiresAt = exchanged.expiresIn !== null
      ? new Date(now.getTime() + exchanged.expiresIn * 1000)
      : (await debugToken(exchanged.accessToken)).expiresAt;
    if (exchanged.accessToken && newExpiresAt && newExpiresAt.getTime() > expiresAt.getTime()) {
      await db
        .update(metaAdAccounts)
        .set({ accessTokenEncrypted: encryptToken(exchanged.accessToken), tokenExpiresAt: newExpiresAt, updatedAt: new Date() })
        .where(eq(metaAdAccounts.id, row.id));
      return exchanged.accessToken;
    }
  } catch (err) {
    if (err instanceof MetaGraphError && err.requiresReconnect) {
      await markNeedsReconnect(row.id);
      throw new MetaReconnectRequiredError();
    }
    // Meta unreachable or refused the exchange for another reason: the
    // current token hasn't expired yet, so keep using it.
  }
  return token;
}

// ─── Sandbox mode ───────────────────────────────────────────────────────────

/**
 * META_ADS_SANDBOX=1 + META_SANDBOX_AD_ACCOUNT_ID (a Marketing API sandbox ad
 * account, created under the app's Marketing API → Tools) routes campaign,
 * targeting, preview and estimate calls to that account. Sandbox accounts
 * accept the same calls but never deliver or spend. META_SANDBOX_ACCESS_TOKEN
 * (the token Meta generates for the sandbox account) is optional; without it
 * the seller's own token is used, which only works for people with a role on
 * the app.
 */
export function metaSandbox(): { adAccountId: string | null; accessToken: string | null } | null {
  const flag = process.env.META_ADS_SANDBOX?.trim().toLowerCase();
  if (flag !== "1" && flag !== "true") return null;
  const raw = process.env.META_SANDBOX_AD_ACCOUNT_ID?.trim();
  return {
    adAccountId: raw ? (raw.startsWith("act_") ? raw : `act_${raw}`) : null,
    accessToken: process.env.META_SANDBOX_ACCESS_TOKEN?.trim() || null,
  };
}

/** Ad account + token Marketing API calls should use for this connection. */
export function marketingTarget(
  account: Pick<MetaAdAccountRow, "adAccountId">,
  accessToken: string,
): { adAccountId: string | null; accessToken: string; sandbox: boolean } {
  const sandbox = metaSandbox();
  if (!sandbox) return { adAccountId: account.adAccountId, accessToken, sandbox: false };
  return { adAccountId: sandbox.adAccountId, accessToken: sandbox.accessToken ?? accessToken, sandbox: true };
}
