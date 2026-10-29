/**
 * Per-screen hook for the reusable <FirstRunTip> system. A screen calls this
 * once with a unique, stable tip id and gets back whether to render the tip
 * right now, plus dismiss/skip handlers that mark it seen.
 *
 * Handles every must-have rule in one place so individual screens don't have
 * to reimplement them:
 *  - Only the first time this account sees this tip id. In the dev preview,
 *    Dev's `&tips=1` turns tips on (the plain preview shows none) but the
 *    seen-state still holds: dismiss, leave, come back — nothing.
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

  // Whether the screen can host the tip right now (content loaded, not an
  // auth route, not suppressed). Separate from seen-state: a tip that is
  // already showing stays up even though it was marked seen when it appeared.
  const canShow = contentReady && !suppressed && !isAuthFlowRoute(pathname) && (forceShow || !previewSuppressed);

  const eligible = useMemo(() => {
    if (!canShow) return false;
    // Never decide before the saved seen-state has loaded (and auth settled).
    // `&tips=1` included: it only lifts the plain preview's suppression. The
    // preview has no server session, so its seen-state is the local cache
    // (written on dismiss), and that has to hold across navigations and
    // reloads like it does for a real account. Settings > Replay tips resets it.
    if (!controller.ready) return false;
    return !controller.hasSeen(tipId);
    // controller.hasSeen closes over state that changes identity each render when relevant —
    // depending on the primitives it reads keeps this from re-running needlessly.
  }, [canShow, controller, tipId]);

  useEffect(() => {
    if (claimed) {
      if (!canShow) { controller.release(tipId); setClaimed(false); }
      return;
    }
    if (!eligible) return;
    if (controller.claim(tipId)) {
      setClaimed(true);
      // Seen the moment it shows: swiping away, switching tabs or killing
      // the app all count, so no first-run tip ever repeats.
      controller.markSeen(tipId);
    }
    // Intentionally does not retry on every render if the claim fails (another
    // tip is showing) — this screen simply doesn't show its tip this visit,
    // per the "never stacks" rule. It will show next time the screen mounts
    // fresh with nothing else active.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eligible, canShow, tipId]);

  useEffect(() => () => { if (claimed) controller.release(tipId); }, [claimed, tipId, controller]);

  function dismiss() {
    controller.markSeen(tipId);
    controller.release(tipId);
    setClaimed(false);
  }

  return { visible: claimed && canShow, dismiss };
}
