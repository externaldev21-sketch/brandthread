/**
 * Every Follow / Unfollow tap in the app fires the same haptic, from one
 * place: `hapticFollow` in lib/haptics.ts. Follow = one light impact,
 * Unfollow = selection tick, no-op on web.
 *
 * Two guards:
 *  1. Unit — hapticFollow plays the right expo-haptics calls per direction.
 *  2. Static scan — every file that starts a follow (calls a follow network
 *     primitive) or renders a follow control must reach `hapticFollow`, either
 *     by calling it directly or by rendering a shared follow control that
 *     calls it on tap. A new Follow button that skips the helper fails here.
 *
 * Lightweight source scan, not a full TSX parse — same approach as
 * tests/discover-no-nested-pressables.test.ts.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const platform = vi.hoisted(() => ({ OS: 'ios' as string }));
const haptics = vi.hoisted(() => ({
  impactAsync: vi.fn(() => Promise.resolve()),
  notificationAsync: vi.fn(() => Promise.resolve()),
  selectionAsync: vi.fn(() => Promise.resolve()),
}));

vi.mock('react-native', () => ({ Platform: platform }));
vi.mock('expo-haptics', () => ({
  ...haptics,
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));

import { hapticFollow, resetHapticsForTests } from '@/lib/haptics';

describe('hapticFollow', () => {
  beforeEach(() => {
    platform.OS = 'ios';
    haptics.impactAsync.mockClear();
    haptics.notificationAsync.mockClear();
    haptics.selectionAsync.mockClear();
    resetHapticsForTests();
  });

  it('Follow plays one light impact (max one haptic per action)', () => {
    hapticFollow(true);
    expect(haptics.impactAsync).toHaveBeenCalledTimes(1);
    expect(haptics.impactAsync).toHaveBeenCalledWith('light');
    expect(haptics.notificationAsync).not.toHaveBeenCalled();
    expect(haptics.selectionAsync).not.toHaveBeenCalled();
  });

  it('Unfollow plays only a soft selection tick', () => {
    hapticFollow(false);
    expect(haptics.selectionAsync).toHaveBeenCalledTimes(1);
    expect(haptics.impactAsync).not.toHaveBeenCalled();
    expect(haptics.notificationAsync).not.toHaveBeenCalled();
  });

  it('is a no-op on web', () => {
    platform.OS = 'web';
    hapticFollow(true);
    hapticFollow(false);
    expect(haptics.impactAsync).not.toHaveBeenCalled();
    expect(haptics.notificationAsync).not.toHaveBeenCalled();
    expect(haptics.selectionAsync).not.toHaveBeenCalled();
  });
});

// ─── Static coverage ──────────────────────────────────────────────────────────

const ROOT = resolve(__dirname, '..');
const SCAN_DIRS = ['app', 'components', 'hooks', 'lib', 'services', 'contexts'];

/** Calls that create or remove a follow. */
const FOLLOW_PRIMITIVES = [
  /\.social\.(follow|unfollow)\(/,
  /\bsetSellerFollowing\(/,
  /\.hashtags\.(follow|unfollow)\(/,
];

/**
 * Shared follow controls: each fires hapticFollow inside its own onPress, so a
 * screen that renders one is covered. `file` must call hapticFollow.
 */
const SHARED_CONTROLS: Array<{ tag: RegExp; file: string }> = [
  { tag: /<FollowButton\b/, file: 'components/social/FollowButton.tsx' },
  { tag: /<FollowMorphButton\b/, file: 'components/ui/MotionPrimitives.tsx' },
  { tag: /<(PersonRow|FollowPill)\b/, file: 'components/search/PersonRow.tsx' },
  { tag: /<RightActionRail\b/, file: 'components/buyer-feed/RightActionRail.tsx' },
  { tag: /<LiveHostPill\b/, file: 'components/live/LiveOverlays.tsx' },
  { tag: /<LiveEmptyState\b/, file: 'components/live/LiveEmptyState.tsx' },
  // Activity rows render the PersonRow FollowPill (seller-activity reuses it).
  { tag: /<ActivityRowView\b/, file: 'app/activity-center.tsx' },
];

/**
 * Modules that call a follow primitive but are not tap handlers — API
 * definitions, providers and background retry queues. The tap that leads to
 * them fires the haptic in the control above.
 */
const NON_TAP_MODULES = new Set([
  'lib/api.ts',
  'services/socialService.ts',
  'lib/live/apiLiveProvider.ts',
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '__tests__') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.(ts|tsx)$/.test(name) && !name.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

const sources = SCAN_DIRS.flatMap((d) => walk(join(ROOT, d))).map((full) => ({
  rel: relative(ROOT, full).split('\\').join('/'),
  src: readFileSync(full, 'utf8'),
}));

const callsHelper = (src: string) => /\bhapticFollow\(/.test(src);
const rendersSharedControl = (src: string) => SHARED_CONTROLS.some((c) => c.tag.test(src));

describe('every follow entry point routes through hapticFollow', () => {
  it('each shared follow control reaches exactly one hapticFollow owner on tap', () => {
    for (const { file } of SHARED_CONTROLS) {
      const src = readFileSync(join(ROOT, file), 'utf8');
      if (file === 'components/buyer-feed/RightActionRail.tsx') {
        // The rebuilt rail delegates its action to the account-scoped parent;
        // firing here as well would produce two haptics for a single follow.
        expect(src).toContain('await onFollow();');
        expect(callsHelper(src)).toBe(false);
        for (const parent of ['app/(tabs)/feed.tsx', 'app/buyer-post-viewer.tsx']) {
          const owner = readFileSync(join(ROOT, parent), 'utf8');
          expect(callsHelper(owner), `${parent} owns the rail follow haptic`).toBe(true);
          expect(owner).toContain('onFollow=');
        }
      } else {
        expect(callsHelper(src), `${file} must call hapticFollow() in its follow onPress`).toBe(true);
      }
    }
  });

  it('every file that starts a follow calls hapticFollow or renders a shared follow control', () => {
    const followers = sources.filter(({ rel, src }) =>
      !NON_TAP_MODULES.has(rel) && FOLLOW_PRIMITIVES.some((re) => re.test(src)));
    // Sanity: the scan actually found the follow surfaces.
    expect(followers.length).toBeGreaterThan(10);
    const missing = followers
      .filter(({ src }) => !callsHelper(src) && !rendersSharedControl(src))
      .map(({ rel }) => rel);
    expect(missing, 'Follow taps must call hapticFollow() from lib/haptics').toEqual([]);
  });

  it('local Follow toggles (no network call) still call hapticFollow', () => {
    // Screens whose Follow button only flips local state today.
    for (const file of ['app/live-feed.tsx', 'app/hashtag/[tag].tsx']) {
      const src = readFileSync(join(ROOT, file), 'utf8');
      expect(callsHelper(src), `${file} must call hapticFollow()`).toBe(true);
    }
  });

  it('nobody plays a raw expo-haptics call on a follow press', () => {
    const offenders = sources
      .filter(({ src }) => /onPress=\{[^}]*Haptics\.\w+Async[^}]*on(Follow|ToggleFollow)\(/.test(src))
      .map(({ rel }) => rel);
    expect(offenders).toEqual([]);
  });
});
