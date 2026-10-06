/**
 * Decides whether app/share-profile.tsx can load the profile yet, and for
 * which account. Before this existed the screen returned early whenever there
 * was no Clerk user id and never cleared `loading`, so a session without a
 * Clerk user (the web design preview, or a signed-out deep link) sat on an
 * empty body forever.
 *
 * - 'wait'       Clerk is still resolving (and this isn't a preview).
 * - 'ready'      load the profile; `key` guards against account switches.
 * - 'signedOut'  nothing to load — the screen shows its error/retry state.
 */
export type ShareProfileAccount =
  | { status: 'wait' }
  | { status: 'ready'; key: string }
  | { status: 'signedOut' };

export const PREVIEW_ACCOUNT_KEY = '__preview__';

export function resolveShareProfileAccount(input: {
  authLoaded: boolean;
  userId: string | null | undefined;
  preview: boolean;
}): ShareProfileAccount {
  if (input.userId) return { status: 'ready', key: input.userId };
  if (input.preview) return { status: 'ready', key: PREVIEW_ACCOUNT_KEY };
  if (!input.authLoaded) return { status: 'wait' };
  return { status: 'signedOut' };
}
