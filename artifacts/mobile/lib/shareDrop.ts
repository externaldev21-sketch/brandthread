/**
 * Canonical drop URL helper — mirrors lib/shareProfile.ts's convention.
 *
 * Public production origin: https://brandthread.app
 * Canonical drop URL:       https://brandthread.app/drops/{dropId}
 */
import { BRANDTHREAD_ORIGIN } from '@/lib/shareProfile';

/**
 * Build the canonical share URL for a drop. Returns null when dropId is
 * missing — callers must gate on this, same convention as buildCanonicalProfileUrl.
 */
export function buildCanonicalDropUrl(dropId: string | null | undefined): string | null {
  if (!dropId || typeof dropId !== 'string' || !dropId.trim()) return null;
  return `${BRANDTHREAD_ORIGIN}/drops/${encodeURIComponent(dropId.trim())}`;
}
