/**
 * "Email address or @username" for team invites. A leading "@" always means a
 * username (so "@jane.doe" is not mistaken for an email); otherwise the value
 * must be a real email address or a plain username.
 */
export type TeamInviteTarget =
  | { ok: true; payload: { email: string } | { username: string } }
  | { ok: false; error: string };

const EMAIL = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
const USERNAME = /^[a-z0-9._]{1,30}$/i;

export function parseTeamInviteTarget(input: string): TeamInviteTarget {
  const value = input.trim();
  if (value.startsWith('@')) {
    const username = value.slice(1);
    return USERNAME.test(username)
      ? { ok: true, payload: { username } }
      : { ok: false, error: 'Usernames use letters, numbers, dots and underscores.' };
  }
  if (value.includes('@')) {
    return EMAIL.test(value)
      ? { ok: true, payload: { email: value } }
      : { ok: false, error: 'Enter a valid email address, or @username.' };
  }
  return USERNAME.test(value)
    ? { ok: true, payload: { username: value } }
    : { ok: false, error: 'Enter an email address or @username.' };
}
