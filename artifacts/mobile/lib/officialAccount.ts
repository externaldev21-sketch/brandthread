/**
 * The official @brandthread account on the client: its avatar (the bundled
 * silver B logo (assets/images/brandthread-logo.png) — the account has no uploaded photo) and the creator-credit
 * line shown under official reposts of other creators' content.
 */
import type { ImageSourcePropType } from 'react-native';
import { Asset } from 'expo-asset';

export const OFFICIAL_HANDLE = '@brandthread';
export const OFFICIAL_DISPLAY_NAME = 'Brandthread';
export const OFFICIAL_BIO = 'The official Brandthread account.';
/** Same well-known id the server seeds in migration 270. */
export const OFFICIAL_ACCOUNT_ID = 'brandthread-official';

export const OFFICIAL_AVATAR_SOURCE: ImageSourcePropType & number =
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../assets/images/brandthread-logo.png');

/** The silver B as a URI, for surfaces that take an avatar URL rather than a bundled source. */
export function officialAvatarUri(): string | null {
  try {
    return Asset.fromModule(OFFICIAL_AVATAR_SOURCE).uri || null;
  } catch {
    return null;
  }
}

export function isOfficialAccountId(userId: string | null | undefined): boolean {
  return userId === OFFICIAL_ACCOUNT_ID;
}

export { creditLabel } from '@/lib/officialCredit';
