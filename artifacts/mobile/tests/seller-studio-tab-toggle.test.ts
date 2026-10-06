import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const studio = readFileSync(resolve(process.cwd(), 'components/SellerStudioRadialMenu.tsx'), 'utf8');
const tabBar = readFileSync(resolve(process.cwd(), 'components/SellerGlobalTabBar.tsx'), 'utf8');
const layout = readFileSync(resolve(process.cwd(), 'app/_layout.tsx'), 'utf8');

/**
 * Dev: with the close (X) button gone, closing the Studio page still has to
 * work three ways: swipe-down, Android back (see
 * seller-studio-menu-swipe-dismiss.test.ts), and tapping the Studio tab bar
 * button again. Since SellerStudioRadialMenu's `open` state was previously
 * fully internal (openRequestKey only ever OPENED, guarded on `!open`), a
 * second prop pair (closeRequestKey + onOpenChange) lets the tab bar track
 * and toggle it without lifting the whole animation state out of the menu.
 */
describe('Studio page accepts a closeRequestKey + reports its own open state', () => {
  it('closeRequestKey closes the page (only when already open), mirroring openRequestKey', () => {
    expect(studio).toContain('closeRequestKey?: number;');
    expect(studio).toContain('closeRequestKey = 0,');
    // A request only acts when its key CHANGED since this instance mounted
    // (the menu remounts after full-screen routes and must not replay a
    // stale key — see docs/NAVIGATION.md / lib/navigation/studioReturn.ts).
    expect(studio).toContain('if (closeRequestKey === handledCloseKeyRef.current) return;');
    expect(studio).toContain('if (openRequestKey === handledOpenKeyRef.current) return;');
  });

  it('onOpenChange fires whenever the internal open state changes', () => {
    expect(studio).toContain('onOpenChange?: (open: boolean) => void;');
    expect(studio).toContain('onOpenChange?.(open);');
  });
});

describe('Studio tab bar button toggles open/close and relabels itself', () => {
  it('accepts isStudioOpen and swaps its accessibility label accordingly', () => {
    expect(tabBar).toContain('isStudioOpen?: boolean;');
    expect(tabBar).toContain("accessibilityLabel={isStudioOpen ? 'Close Studio tools' : 'Open Studio tools'}");
  });

  it('the live wiring (SellerBarGate) tracks isStudioOpen and bumps close vs. open depending on it', () => {
    expect(layout).toContain('const [isStudioOpen, setIsStudioOpen] = useState(false);');
    expect(layout).toContain('if (isStudioOpen) setStudioCloseRequestKey((k) => k + 1);');
    expect(layout).toContain('else setStudioOpenRequestKey((k) => k + 1);');
    expect(layout).toContain('onOpenChange={setIsStudioOpen}');
    expect(layout).toContain('closeRequestKey={studioCloseRequestKey}');
  });

  it('resets the tracked open state when the Studio menu force-unmounts on a full-screen route', () => {
    expect(layout).toContain('if (isFullScreenRoute) setIsStudioOpen(false);');
  });
});
