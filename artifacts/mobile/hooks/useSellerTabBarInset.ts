import { useSellerShell } from '@/contexts/SellerShellContext';
import { useBuyerTabBarMetrics } from '@/components/buyer-nav/buyerTabBarMetrics';
import { isSellerDevPreview } from '@/lib/devPreview';
import { useTabBarHiddenByScreen } from '@/lib/tabBarVisibility';
import { useScreenBottomInset } from '@/hooks/useScreenBottomInset';

/**
 * Bottom padding for a root-Stack seller screen that the floating
 * SellerGlobalTabBar overlays (every seller route outside the full-screen
 * deny-list in app/_layout.tsx). Same `occupiedHeight` the bar itself is laid
 * out from (`useTabBarMetrics(2)` in SellerGlobalTabBar), so the last row of a
 * scroll view or a pinned footer always clears the bar. Falls back to the plain
 * safe-area floor when the bar isn't showing (buyer session, or a screen that
 * called useHideTabBar), so buyers on shared routes don't get dead space.
 */
export function useSellerTabBarInset(): number {
  const { isActiveSeller } = useSellerShell();
  const hiddenByScreen = useTabBarHiddenByScreen();
  const occupied = useBuyerTabBarMetrics(2).occupiedHeight;
  const floor = useScreenBottomInset();
  const barShown = (isActiveSeller || isSellerDevPreview()) && !hiddenByScreen;
  return barShown ? occupied : floor;
}
