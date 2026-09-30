/**
 * Pulls an invite code out of whatever a person pastes: a full
 * brandthread.app/community-join?code=XXXX link, a mobile:// deep link, or a
 * bare code. Codes are 6-16 lowercase letters/digits (server: /^[a-z0-9]{6,16}$/).
 */
const CODE_RE = /^[a-z0-9]{6,16}$/;

export function parseInviteCode(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  const fromQuery = raw.match(/[?&]code=([^&#\s]+)/i);
  let candidate = fromQuery ? fromQuery[1] : raw;
  if (!fromQuery && /[/:]/.test(raw)) {
    // A link without ?code= — accept a trailing path segment (…/join/abc123) as a fallback.
    const tail = raw.replace(/[?#].*$/, '').split('/').filter(Boolean).pop() ?? '';
    candidate = tail;
  }
  try { candidate = decodeURIComponent(candidate); } catch { /* keep raw */ }
  candidate = candidate.trim().toLowerCase();
  return CODE_RE.test(candidate) ? candidate : null;
}

/** Share URL for a code when the server didn't hand back a full one. */
export function inviteUrlForCode(code: string): string {
  return `https://brandthread.app/community-join?code=${encodeURIComponent(code)}`;
}
