/**
 * Per-screen hook for the reusable <FirstRunTip> system. A screen calls this
 * once with a unique, stable tip id and gets back whether to render the tip
 * right now, plus dismiss/skip handlers that mark it seen.
 *
 * Handles every must-have rule in one place so individual screens don't have
 * to reimplement them:
 *  - Only the first time this account sees this tip id (or forced via Dev's
 *    `&tips=1` preview override).
 *  - Never on an auth-flow route.
 *  - Never stacks with another tip (global claim/release lock).
 *  - Only once `contentReady` is true (screen has real content, not a
 *    loading skeleton) — the caller passes this in.
 */
import { useEffect, useMemo, useState } from 'react';
import { usePathname } from 'expo-router';
import { useFirstRunTipsController } from '@/contexts/FirstRunTipsContext';
import { isAuthFlowRoute, isFirstRunTipsPreviewForceShow, isPreviewWithoutTipsForce } from '@/lib/firstRunTips/rules';
import { isBuyerDevPreview, isSellerDevPreview } from '@/lib/devPreview';

export interface UseFirstRunTipOptions {
  /** True once the screen has real content (not a loading skeleton / spinner). */
  contentReady: boolean;
  /** Escape hatch to suppress a tip for a reason specific to this screen (e.g. a modal already open). */
  suppressed?: boolean;
}

export interface UseFirstRunTipResult {
  visible: boolean;
  /** Tap-anywhere / explicit Skip — both dismiss and mark the tip seen. */
  dismiss: () => void;
}

export function useFirstRunTip(tipId: string, options: UseFirstRunTipOptions): UseFirstRunTipResult {
  const { contentReady, suppressed = false } = options;
  const pathname = usePathname();
  const controller = useFirstRunTipsController();
  const [claimed, setClaimed] = useState(false);

  // Recomputed on every render, deliberately NOT memoized on `pathname`:
  // Expo Router's client-side pushState navigation never remounts the
  // app-root FirstRunTipsProvider, and this screen-level hook's own
  // `pathname` value from usePathname() is not guaranteed to change
  // identity in lockstep with `window.location.search` actually updating
  // (the two can observably lag one render apart) — so &tips=1 / the
  // plain-preview-suppression rule are read directly, every render, rather
  // than risk a stale memoized value. Both are cheap synchronous reads.
  // isFirstRunTipsPreviewForceShow() mirrors `&tips=1` into localStorage on
  // first detection (see rules.ts) so it survives a later navigation that
  // drops the query string entirely.
  const forceShow = isFirstRunTipsPreviewForceShow();
  const previewSuppressed = isPreviewWithoutTipsForce(isSellerDevPreview() || isBuyerDevPreview());

  const eligible = useMemo(() => {
    if (!contentReady || suppressed || isAuthFlowRoute(pathname)) return false;
    if (forceShow) return true; // Dev's &tips=1: always eligible, ignoring seen-state
    if (previewSuppressed) return false; // plain preview, no &tips=1: never show
    return !controller.hasSeen(tipId);
    // controller.hasSeen closes over state that changes identity each render when relevant —
    // depending on the primitives it reads keeps this from re-running needlessly.
  }, [contentReady, suppressed, pathname, forceShow, previewSuppressed, controller, tipId]);

  useEffect(() => {
    if (!eligible) {
      if (claimed) { controller.release(tipId); setClaimed(false); }
      return;
    }
    if (claimed) return;
    if (controller.claim(tipId)) setClaimed(true);
    // Intentionally does not retry on every render if the claim fails (another
    // tip is showing) — this screen simply doesn't show its tip this visit,
    // per the "never stacks" rule. It will show next time the screen mounts
    // fresh with nothing else active.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eligible, tipId]);

  useEffect(() => () => { if (claimed) controller.release(tipId); }, [claimed, tipId, controller]);

  function dismiss() {
    controller.markSeen(tipId);
    controller.release(tipId);
    setClaimed(false);
  }

  return { visible: eligible && claimed, dismiss };
}
