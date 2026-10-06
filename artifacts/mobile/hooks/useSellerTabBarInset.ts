import { useSellerShell } from '@/contexts/SellerShellContext';
import { useTabBarMetrics } from '@/components/buyer-nav/buyerTabBarMetrics';
import { isSellerDevPreview } from '@/lib/devPreview';
import { useTabBarHiddenByScreen } from '@/lib/tabBarVisibility';

/**
 * Bottom space taken by the floating seller tab bar (SellerGlobalTabBar),
 * which app/_layout.tsx mounts over every root-stack seller screen that isn't
 * in its full-screen deny-list. Use it as `paddingBottom` on a scroll view's
 * content (or a pinned footer's offset) so the last row / CTA always clears
 * the bar. Returns 0 when no seller bar is on screen (buyer sessions, or a
 * screen that hid the bar with useHideTabBar), so buyer screens get no
 * dead gap.
 */
export function useSellerTabBarInset(): number {
  const { isActiveSeller } = useSellerShell();
  const hiddenByScreen = useTabBarHiddenByScreen();
  const occupied = useTabBarMetrics(2).occupiedHeight;
  const sellerBarShown = isActiveSeller || isSellerDevPreview();
  return sellerBarShown && !hiddenByScreen ? occupied : 0;
}
