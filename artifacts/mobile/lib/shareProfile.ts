/**
 * Canonical profile URL helpers for Brandthread profile sharing.
 *
 * Public production origin: https://brandthread.app
 * Canonical profile URL:    https://brandthread.app/u/{normalizedUsername}
 *
 * Rules:
 * - Normalize username to lowercase alphanumeric + underscores only.
 * - Minimum 3 chars, maximum 30 chars.
 * - Never fabricate URLs from display names, Clerk IDs, or fallback slugs.
 * - A missing / invalid username returns null — callers must gate on this.
 */

export const BRANDTHREAD_ORIGIN = 'https://brandthread.app';

/**
 * Normalise a raw username string coming from the server:
 * lowercase, strip any characters that are not [a-z0-9_].
 * Returns the normalised form, or null if the result fails validation.
 */
export function normalizeUsername(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const normalized = raw.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
  if (normalized.length < 3 || normalized.length > 30) return null;
  return normalized;
}

/**
 * Build the exact canonical profile URL.
 * Returns null when username is missing or invalid — never returns a guessed URL.
 */
export function buildCanonicalProfileUrl(rawUsername: string | null | undefined): string | null {
  const username = normalizeUsername(rawUsername);
  if (!username) return null;
  return `${BRANDTHREAD_ORIGIN}/u/${username}`;
}

/**
 * Validate that a normalized username string meets the format requirements.
 * 3–30 chars, letters, digits, underscores only.
 */
export function isValidNormalizedUsername(username: string): boolean {
  return /^[a-z0-9_]{3,30}$/.test(username);
}

export type ShareLinkResult = 'shared' | 'copied' | 'unavailable';

/**
 * Share a profile link through whatever the platform actually supports:
 *  - native (iOS/Android): the system share sheet (`Share.share`), link included;
 *  - web with the Web Share API (mobile Safari/Chrome): `navigator.share`;
 *  - web without it (most desktop browsers): copy the link to the clipboard.
 * react-native-web's `Share.share` rejects when `navigator.share` is missing,
 * so web never calls it directly. A user cancelling the sheet is not an error.
 * Dependencies are injected so this stays free of react-native imports.
 */
export async function shareLinkWithFallback({
  url,
  message,
  platformOS,
  nativeShare,
  webNavigator,
}: {
  url: string;
  message: string;
  platformOS: string;
  nativeShare: (content: { message: string; url?: string; title?: string }) => Promise<unknown>;
  webNavigator?: {
    share?: (data: { title?: string; text?: string; url?: string }) => Promise<void>;
    clipboard?: { writeText?: (text: string) => Promise<void> };
  } | null;
}): Promise<ShareLinkResult> {
  if (platformOS !== 'web') {
    // iOS renders `url` as a rich link; Android only reads `message`.
    await nativeShare(platformOS === 'ios' ? { message, url } : { message: `${message} ${url}` });
    return 'shared';
  }
  if (webNavigator?.share) {
    try {
      await webNavigator.share({ title: message, text: message, url });
      return 'shared';
    } catch (error) {
      if ((error as { name?: string } | null)?.name === 'AbortError') return 'shared';
      // Fall through to copying when the browser refuses (e.g. not a user gesture).
    }
  }
  if (webNavigator?.clipboard?.writeText) {
    await webNavigator.clipboard.writeText(url);
    return 'copied';
  }
  return 'unavailable';
}
