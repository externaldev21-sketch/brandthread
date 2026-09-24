/**
 * Canonical share URL for a public saved collection (board).
 * Canonical URL: https://brandthread.app/c/{collectionId}
 * Mirrors lib/shareProfile.ts's pattern for /u/{username}.
 */
import { BRANDTHREAD_ORIGIN } from './shareProfile';

export function buildCanonicalCollectionUrl(collectionId: string): string {
  return `${BRANDTHREAD_ORIGIN}/c/${collectionId}`;
}
