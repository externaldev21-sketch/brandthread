/**
 * Guard against the "floating tab bar renders on top of a full-screen
 * camera/creation flow" regression class (e.g. 'buyer-story-create' was
 * missing from the SELLER deny-list, so the bar rendered jammed under the
 * story camera's shutter row) — and asserts each deny-list drives a real
 * slide animation (never a spring, never a bare jump) rather than an
 * instant mount/unmount. Covers BOTH the seller tab bar
 * (SellerGlobalTabBar.tsx, gated by app/_layout.tsx's SellerBarGate) and
 * the buyer tab bar (components/buyer-nav/BuyerTabBar.tsx, gated by its own
 * useSegments() check) — both drive the SAME TAB_BAR_SLIDE_MS/
 * TAB_BAR_SLIDE_EASING/tabBarSlideTargetY helper. Also guards the adjacent
 * bug found in the same screen: buyer-story-create.tsx's LIVE mode item was
 * gated on an `accountType` route param that every real seller entry point
 * omits, so LIVE never showed for an actual seller.
 *
 * Source-inspection, same convention as lib/__tests__/freshInstallPreview.test.ts:
 * app/_layout.tsx pulls in Clerk/Notifications/etc. at module scope, which
 * vitest can't import directly.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { tabBarSlideTargetY } from '../lib/tabBarSlide';

function src(relPath: string): string {
  return readFileSync(resolve(__dirname, relPath), 'utf8');
}

describe('SELLER_TAB_BAR_FULL_SCREEN_SEGMENTS covers every fullScreenModal route', () => {
  it('every Stack.Screen registered with presentation: \'fullScreenModal\' is in the deny-list', () => {
    const layout = src('../app/_layout.tsx');

    const screenNames: string[] = [];
    const screenRegex = /<Stack\.Screen\s+name="([^"]+)"[^/]*?presentation:\s*'fullScreenModal'/gs;
    let match: RegExpExecArray | null;
    while ((match = screenRegex.exec(layout)) !== null) {
      screenNames.push(match[1]);
    }
    // Sanity: this regex must actually find the known fullScreenModal
    // routes, or the test would pass vacuously on a parsing regression.
    expect(screenNames).toEqual(expect.arrayContaining([
      'camera-capture', 'create-post', 'buyer-story-viewer', 'buyer-story-create',
      'seller-go-live', 'seller-live', 'buyer-live', 'live', 'live-feed',
    ]));

    const setMatch = layout.match(/const SELLER_TAB_BAR_FULL_SCREEN_SEGMENTS = new Set\(\[([\s\S]*?)\]\);/);
    expect(setMatch).toBeTruthy();
    const setBody = setMatch![1];

    for (const name of screenNames) {
      expect(setBody, `'${name}' is a fullScreenModal route but missing from SELLER_TAB_BAR_FULL_SCREEN_SEGMENTS`)
        .toMatch(new RegExp(`'${name}'`));
    }
  });

  it('SellerBarGate keeps SellerGlobalTabBar mounted through a full-screen route (passes `hidden`, doesn\'t unmount it) so it can animate', () => {
    const layout = src('../app/_layout.tsx');
    expect(layout).toMatch(/if \(!showBar\) return null;/);
    expect(layout).toMatch(/<SellerGlobalTabBar hidden=\{isFullScreenRoute\}/);
  });
});

describe('tab bar slide motion: fast, plain ease-out, no spring', () => {
  it('SellerGlobalTabBar drives translateY via withTiming on TAB_BAR_SLIDE_MS/EASING, never a spring', () => {
    const bar = src('../components/SellerGlobalTabBar.tsx');
    expect(bar).toContain("import { TAB_BAR_SLIDE_EASING, TAB_BAR_SLIDE_MS } from '@/constants/motion';");
    expect(bar).toMatch(/withTiming\(tabBarSlideTargetY\(hidden, offscreenY\), \{\s*duration: TAB_BAR_SLIDE_MS,\s*easing: TAB_BAR_SLIDE_EASING,/);
    expect(bar).not.toMatch(/withSpring/);
    expect(bar).not.toContain('Animated.spring');
  });

  it('TAB_BAR_SLIDE_MS is fast (~200ms) and defines no spring constant alongside it', () => {
    const motion = src('../constants/motion.ts');
    expect(motion).toMatch(/export const TAB_BAR_SLIDE_MS = 200;/);
    expect(motion).toMatch(/export const TAB_BAR_SLIDE_EASING = Easing\.bezier\(/);
    expect(motion).not.toMatch(/TAB_BAR_SLIDE_SPRING/);
  });

  it('while hidden, the bar does not block taps (pointerEvents flips to none, not just visually offscreen)', () => {
    const bar = src('../components/SellerGlobalTabBar.tsx');
    expect(bar).toMatch(/pointerEvents=\{hidden \? 'none' : 'box-none'\}/);
  });
});

describe('BUYER_TAB_BAR_FULL_SCREEN_SEGMENTS + BuyerTabBar: same helper, same motion, same guarantees', () => {
  it('covers every buyer-reachable creation/story/video/live route', () => {
    const bar = src('../components/buyer-nav/BuyerTabBar.tsx');
    const setMatch = bar.match(/const BUYER_TAB_BAR_FULL_SCREEN_SEGMENTS = new Set\(\[([\s\S]*?)\]\);/);
    expect(setMatch).toBeTruthy();
    const setBody = setMatch![1];
    for (const name of [
      'camera-capture', 'create-post', 'buyer-story-create', 'buyer-story-viewer',
      'buyer-live', 'live-feed', 'live',
    ]) {
      expect(setBody, `'${name}' is a buyer-reachable full-screen route but missing from BUYER_TAB_BAR_FULL_SCREEN_SEGMENTS`)
        .toMatch(new RegExp(`'${name}'`));
    }
  });

  it('reads the true current route via useSegments(), not the Tabs navigator\'s own state (which can\'t see a root-Stack sibling)', () => {
    const bar = src('../components/buyer-nav/BuyerTabBar.tsx');
    expect(bar).toContain("import { useSegments, type Tabs } from 'expo-router';");
    expect(bar).toMatch(/const segments = useSegments\(\);/);
    expect(bar).toMatch(/const isFullScreenRoute = BUYER_TAB_BAR_FULL_SCREEN_SEGMENTS\.has\(firstSegment\) \|\| hiddenByScreen;/);
  });

  it('drives translateY via the SAME TAB_BAR_SLIDE_MS/EASING/tabBarSlideTargetY helper as the seller bar, never a spring', () => {
    const bar = src('../components/buyer-nav/BuyerTabBar.tsx');
    expect(bar).toContain("import { TAB_BAR_SLIDE_EASING, TAB_BAR_SLIDE_MS } from '@/constants/motion';");
    expect(bar).toContain("import { tabBarSlideTargetY } from '@/lib/tabBarSlide';");
    expect(bar).toMatch(/withTiming\(tabBarSlideTargetY\(isFullScreenRoute, offscreenY\), \{\s*duration: TAB_BAR_SLIDE_MS,\s*easing: TAB_BAR_SLIDE_EASING,/);
    expect(bar).not.toMatch(/withSpring/);
    expect(bar).not.toContain('Animated.spring');
  });

  it('while hidden, does not block taps and stays mounted (keeps BUYER_TAB_BAR_HIDDEN_ROUTES\' early return unreachable for this path)', () => {
    const bar = src('../components/buyer-nav/BuyerTabBar.tsx');
    expect(bar).toMatch(/pointerEvents=\{isFullScreenRoute \? 'none' : 'box-none'\}/);
    // The slide hooks must run before the BUYER_TAB_BAR_HIDDEN_ROUTES early
    // return, or hook order breaks whenever that branch fires.
    const slideHookIndex = bar.indexOf('const [barHeight, setBarHeight] = useState(96);');
    const earlyReturnIndex = bar.indexOf('if (BUYER_TAB_BAR_HIDDEN_ROUTES.has(activeRoute)) return null;');
    expect(slideHookIndex).toBeGreaterThan(0);
    expect(earlyReturnIndex).toBeGreaterThan(slideHookIndex);
  });
});

describe("buyer-story-create.tsx: LIVE mode item is gated on the REAL role, not a route param", () => {
  it('derives isSeller from useRole() (RoleContext), not params.accountType', () => {
    const storyCreate = src('../app/buyer-story-create.tsx');
    expect(storyCreate).toContain("import { useRole } from '@/contexts/RoleContext';");
    expect(storyCreate).toMatch(/const \{ role \} = useRole\(\);\s*\n\s*const isSeller = role === 'seller';/);
    // The actual bug: every seller entry point (camera-capture.tsx,
    // create-post.tsx) pushes this route with no `accountType` param, so
    // deriving isSeller from that param always read a seller as a buyer —
    // LIVE never showed no matter the account.
    expect(storyCreate).not.toMatch(/const isSeller = params\.accountType/);
  });

  it('camera-capture.tsx and create-post.tsx push to buyer-story-create with no accountType param — the real shape a seller actually hits', () => {
    const cameraCapture = src('../app/camera-capture.tsx');
    const createPost = src('../app/create-post.tsx');
    expect(cameraCapture).toMatch(/router\.replace\('\/buyer-story-create' as never\)/);
    expect(createPost).toMatch(/router\.replace\('\/buyer-story-create' as never\)/);
  });

  it('a seller sees LIVE in the mode carousel (isSeller drives the array, not a disabled/greyed item)', () => {
    const storyCreate = src('../app/buyer-story-create.tsx');
    expect(storyCreate).toMatch(/isSeller \? \(\['post', 'story', 'live'\] as CaptureMode\[\]\) : \(\['post', 'story'\] as CaptureMode\[\]\)/);
  });
});

describe('tabBarSlideTargetY: guaranteed end state, any toggle sequence', () => {
  const offscreenY = 132;

  it('returns exactly 0 when shown, exactly offscreenY when hidden — never anything in between', () => {
    expect(tabBarSlideTargetY(false, offscreenY)).toBe(0);
    expect(tabBarSlideTargetY(true, offscreenY)).toBe(offscreenY);
  });

  it('a rapid alternating sequence of hidden toggles always resolves to one of exactly two values', () => {
    const sequence = [true, false, true, true, false, false, true, false];
    const results = sequence.map((h) => tabBarSlideTargetY(h, offscreenY));
    for (const r of results) {
      expect([0, offscreenY]).toContain(r);
    }
    // The final call in any sequence determines the final target — never a
    // stale/blended value from an earlier toggle.
    expect(results[results.length - 1]).toBe(tabBarSlideTargetY(sequence[sequence.length - 1], offscreenY));
  });

  it('is a pure function of its two inputs (same inputs always produce the same output)', () => {
    for (const hidden of [true, false]) {
      for (const y of [0, 96, 250]) {
        expect(tabBarSlideTargetY(hidden, y)).toBe(tabBarSlideTargetY(hidden, y));
      }
    }
  });
});
