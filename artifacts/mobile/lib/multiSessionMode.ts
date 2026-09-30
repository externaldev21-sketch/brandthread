/**
 * Detecting whether Clerk's "multi-session" mode is actually on, at runtime.
 *
 * Clerk is external — this app has no API to read the Dashboard's session
 * setting directly. What we CAN observe: if multi-session is off, activating
 * a newly-created session (the "Add account" flow) silently signs out every
 * other session, including the one that was active right before. So: snapshot
 * the active session id before starting "Add account", and after the new
 * session activates, check whether the previous session is still present.
 * If it vanished, multi-session is off.
 */

export interface SessionLike {
  id: string;
}

export function wasPreviousSessionDropped(
  previousSessionId: string | null | undefined,
  sessionsAfterSwitch: readonly SessionLike[] | null | undefined,
): boolean {
  if (!previousSessionId) return false;
  const stillPresent = (sessionsAfterSwitch ?? []).some((session) => session.id === previousSessionId);
  return !stillPresent;
}

export const MULTI_SESSION_OFF_MESSAGE =
  "This account was added, but your other account got signed out — multi-account isn't fully turned on yet for this app. Ask your admin to enable multi-session mode in Clerk.";

/**
 * The exact Clerk Dashboard settings this feature needs turned on, for Dev.
 * Every entry is a real Clerk Dashboard section/toggle name as of this
 * writing — verify against the live dashboard, since Clerk occasionally
 * renames sections.
 */
export const REQUIRED_CLERK_SETTINGS = [
  {
    setting: 'Multi-session handling',
    path: 'Configure → Sessions → Multi-session handling',
    why: 'Without this, signing into account #2 silently signs account #1 out — the exact bug Dev flagged. Must be set to allow multiple sessions per device.',
  },
  {
    setting: 'Email address — Email verification code',
    path: 'Configure → User & Authentication → Email, Phone, Username → Email address → Verification methods',
    why: 'Powers "log in with a one-time code" for email — the email_code sign-in strategy.',
  },
  {
    setting: 'Phone number (sign-in option)',
    path: 'Configure → User & Authentication → Email, Phone, Username → Phone number',
    why: 'Needed at all for phone-number login; currently off/unused by this app. Requires an SMS provider configured under Configure → SMS if Clerk\'s shared pool is insufficient for your volume/region.',
  },
  {
    setting: 'Phone number — SMS verification code',
    path: 'Configure → User & Authentication → Email, Phone, Username → Phone number → Verification methods',
    why: 'Powers phone + one-time-code sign-in specifically (the phone_code strategy).',
  },
  {
    setting: 'Password (sign-in option)',
    path: 'Configure → User & Authentication → Email, Phone, Username → Password',
    why: 'Confirm this stays ON — existing password sign-in and this app\'s own custom password-reset-by-email-code flow (forgot-password.tsx) both depend on it.',
  },
] as const;
