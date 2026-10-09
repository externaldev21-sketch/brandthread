import { useCallback, useEffect, useRef, type RefObject } from 'react';

type ScrollableToEnd = { scrollToEnd: (options?: { animated?: boolean }) => void };

/**
 * "Scroll to the bottom once the row I just appended has laid out" — without
 * guessing how long layout takes with `setTimeout(() => ref.scrollToEnd(), N)`.
 *
 * `requestScrollToEnd()` marks a scroll as pending; the list's own
 * `onContentSizeChange` (wire the returned handler to it) performs it the
 * moment the new content has a size, so it never scrolls to the stale end
 * on a slow frame and never waits longer than it has to.
 *
 * Appending to a capped list (e.g. `.slice(-80)`) can leave the content
 * height unchanged, in which case `onContentSizeChange` doesn't fire. A
 * two-frame fallback (one frame to commit, one to lay out) covers that case;
 * it leaves the request pending so a content-size change that arrives later
 * still lands on the true end. A user drag (`cancelScrollToEnd`, e.g. from
 * `onScrollBeginDrag`) drops any pending request.
 */
export function useScrollToEndOnContentChange(ref: RefObject<ScrollableToEnd | null>): {
  requestScrollToEnd: (animated?: boolean) => void;
  onContentSizeChange: () => void;
  cancelScrollToEnd: () => void;
} {
  const pendingRef = useRef<boolean | null>(null);
  const frameRef = useRef<number | null>(null);

  const cancelFrame = useCallback(() => {
    if (frameRef.current != null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(frameRef.current);
    }
    frameRef.current = null;
  }, []);

  const onContentSizeChange = useCallback(() => {
    const animated = pendingRef.current;
    if (animated === null) return;
    pendingRef.current = null;
    cancelFrame();
    ref.current?.scrollToEnd({ animated });
  }, [ref, cancelFrame]);

  const requestScrollToEnd = useCallback((animated = true) => {
    pendingRef.current = animated;
    cancelFrame();
    if (typeof requestAnimationFrame !== 'function') return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null;
        const pending = pendingRef.current;
        if (pending !== null) ref.current?.scrollToEnd({ animated: pending });
      });
    });
  }, [ref, cancelFrame]);

  const cancelScrollToEnd = useCallback(() => {
    pendingRef.current = null;
    cancelFrame();
  }, [cancelFrame]);

  useEffect(() => cancelScrollToEnd, [cancelScrollToEnd]);

  return { requestScrollToEnd, onContentSizeChange, cancelScrollToEnd };
}
