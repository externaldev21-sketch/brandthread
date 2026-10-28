/**
 * react-native-web reports onLayout from a ResizeObserver. A scene the stack
 * hides under a pushed screen (display: none) then "lays out" at 0×0, and
 * every width-measured component on it (charts, grids, the order globe)
 * collapses while hidden — so coming back paints one frame of the collapsed
 * layout before the real size is measured again: the jump on every return
 * to a screen.
 *
 * Drop resize entries for elements that are not rendered at all (no client
 * rects: display: none on them or an ancestor, or detached), so a hidden
 * scene keeps its last real layout and returns exactly as it was left. A
 * visible element that genuinely shrinks to 0×0 still has a client rect and
 * is reported as before. Must run before react-native-web creates its
 * observer (first onLayout), hence from the app entry's bootstrap.
 */
export function installHiddenLayoutGuard(): void {
  if (typeof window === 'undefined' || typeof window.ResizeObserver !== 'function') return;
  const NativeResizeObserver = window.ResizeObserver;
  if ((NativeResizeObserver as { __btHiddenLayoutGuard?: boolean }).__btHiddenLayoutGuard) return;
  class GuardedResizeObserver extends NativeResizeObserver {
    static __btHiddenLayoutGuard = true;
    constructor(callback: ResizeObserverCallback) {
      super((entries, observer) => {
        const rendered = entries.filter((entry) => !(
          entry.contentRect.width === 0
          && entry.contentRect.height === 0
          && entry.target.getClientRects().length === 0
        ));
        if (rendered.length > 0) callback(rendered, observer);
      });
    }
  }
  window.ResizeObserver = GuardedResizeObserver;
}
