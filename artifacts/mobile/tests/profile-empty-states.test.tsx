import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// Regression guard for "the empty state is cut off under the floating tab
// bar": every profile tab's empty state (buyer Posts/Tagged/Reposts/Saved,
// seller Post/Draft/Schedule, the public videos grid, and the Shop list) is
// rendered at 375x667 and its resting bounds at the end of the scroll must
// sit fully inside the visible area — below the tabs row, above the bar.

vi.mock('react-native', () => {
  const ReactActual = require('react') as typeof import('react');
  const host = (name: string) => (props: any) => ReactActual.createElement(name, props, props.children);
  return {
    View: host('View'),
    Text: host('Text'),
    TouchableOpacity: host('TouchableOpacity'),
    ActivityIndicator: host('ActivityIndicator'),
    StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1, absoluteFill: {} },
    Platform: { OS: 'ios', select: (obj: Record<string, unknown>) => obj.ios ?? obj.default },
  };
});
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 20, bottom: 0, left: 0, right: 0 }) }));
vi.mock('@expo/vector-icons', () => ({ Feather: ({ name }: { name: string }) => React.createElement('Feather', { name }) }));
vi.mock('@/components/ui/ErrorState', () => ({ ErrorState: () => React.createElement('ErrorState') }));
vi.mock('@/components/profile/ProfileVideoGrid', () => ({ ProfileGridSkeleton: () => React.createElement('Skeleton') }));
vi.mock('@/contexts/AppThemeContext', () => ({
  useAppTheme: () => ({
    theme: { background: '#000', text: '#fff', muted: '#aaa', border: '#333', card: '#111', accent: '#eee', onAccent: '#000', error: '#f00' },
  }),
}));

import { getBuyerTabBarMetrics } from '@/components/buyer-nav/buyerTabBarMetrics';
import { ProfileEmptyAreaContext } from '@/components/profile/ProfileEmptyAreaContext';
import { ProfileGridPlaceholder } from '@/components/profile/ProfileGridStates';
import {
  EMPTY_AREA_MIN_HEIGHT, computeEmptyArea, profileEmptyState, type ProfileEmptyTab,
} from '@/components/profile/profileEmptyStates';
import { computeProfileLayout } from '@/components/profile/profileGeometry';

const VIEWPORT = { width: 375, height: 667 };
const SAFE_TOP = 20;
const COMPACT_BAR = 64;
/** Tabs row: 24pt breathing room above + 60pt tabs + hairline. */
const TABS_ROW = 24 + 60 + 1;
/** Shop screen header (back button, title, count, owner buttons). */
const SHOP_HEADER = 190;

type Case = { tab: ProfileEmptyTab; own: boolean; bar: 'buyer' | 'seller' | 'none'; extraReserve?: number; topChrome?: number; tabs?: number };

const CASES: Case[] = [
  ...(['buyer:posts', 'buyer:tagged', 'buyer:reposts', 'buyer:saved'] as const).map((tab) => ({ tab, own: true, bar: 'buyer' as const, extraReserve: 24 })),
  { tab: 'buyer:posts', own: false, bar: 'none' },
  ...(['seller:post', 'seller:draft', 'seller:schedule'] as const).map((tab) => ({ tab, own: true, bar: 'seller' as const })),
  { tab: 'seller:videos', own: false, bar: 'none', extraReserve: 60 + 24 },
  { tab: 'shop', own: true, bar: 'none', topChrome: SHOP_HEADER, tabs: 0 },
  { tab: 'shop', own: false, bar: 'none', topChrome: SHOP_HEADER, tabs: 0 },
];

function barOccupied(bar: Case['bar']): number {
  if (bar === 'none') return 0;
  return getBuyerTabBarMetrics({ ...VIEWPORT, bottomInset: 0, sideCircleCount: bar === 'seller' ? 2 : 1 }).occupiedHeight;
}

describe('profile empty states — copy and CTAs', () => {
  it('gives your own tabs a CTA into the real flow and other people’s profiles none', () => {
    expect(profileEmptyState('buyer:posts', true).cta).toEqual({ label: 'Post your first video', route: '/create-post?accountType=buyer' });
    expect(profileEmptyState('seller:post', true).cta).toEqual({ label: 'Create your first post', route: '/create-post' });
    expect(profileEmptyState('seller:draft', true).cta?.route).toBe('/create-post');
    expect(profileEmptyState('seller:schedule', true).cta).toEqual({ label: 'Schedule a post', route: '/create-post?mode=schedule' });
    expect(profileEmptyState('shop', true).cta).toEqual({ label: 'Add a product', route: '/add-product' });
    for (const { tab } of CASES) {
      const pub = profileEmptyState(tab, false);
      expect(pub.cta).toBeUndefined();
      expect(pub.message.length).toBeGreaterThan(0);
    }
  });
});

describe('profile empty states — never under the tab bar (375x667)', () => {
  const layout = computeProfileLayout(VIEWPORT.width, VIEWPORT.height, 'ios');

  for (const testCase of CASES) {
    const label = `${testCase.tab} (${testCase.own ? 'own' : 'public'})`;
    it(`${label} rests fully inside the visible area`, async () => {
      const occupied = barOccupied(testCase.bar);
      // What the screen hands the shell: the bar's occupied height (which
      // already includes the home indicator) plus any screen extra, or the
      // safe area when there is no bar.
      const bottomInset = Math.max(occupied + (testCase.bar === 'buyer' ? 24 : 0), 8);
      const topChrome = testCase.topChrome ?? SAFE_TOP + COMPACT_BAR;
      const tabsHeight = testCase.tabs ?? TABS_ROW;
      const floatingReserve = testCase.extraReserve && testCase.bar === 'none' ? testCase.extraReserve : 0;
      const area = computeEmptyArea({ viewportHeight: VIEWPORT.height, topChrome, tabsHeight, bottomInset, floatingReserve });

      // Rendered: the placeholder fills exactly the computed area and centres.
      const copy = profileEmptyState(testCase.tab, testCase.own);
      let renderer!: ReactTestRenderer;
      await act(async () => {
        renderer = create(
          <ProfileEmptyAreaContext.Provider value={area.minHeight}>
            <ProfileGridPlaceholder
              loading={false}
              error={false}
              onRetry={() => {}}
              layout={layout}
              icon={copy.icon as never}
              title={copy.title}
              description={copy.message}
              action={copy.cta ? { label: copy.cta.label, onPress: () => {} } : undefined}
            />
          </ProfileEmptyAreaContext.Provider>,
        );
      });
      const root = renderer.root.findAll((node) => node.props.testID === 'profile-empty-state' && typeof node.type === 'string')[0];
      const flat = Object.assign({}, ...[root.props.style].flat(3).filter(Boolean));
      expect(flat.minHeight).toBe(area.minHeight);
      expect(flat.justifyContent).toBe('center');
      const cta = renderer.root.findAll((node) => node.props.testID === 'profile-empty-state-action' && typeof node.type === 'string');
      expect(cta.length).toBe(copy.cta ? 1 : 0);

      // Bounds at the end of the scroll: top below the tabs row, bottom above
      // the floating bar (and the home indicator / rounded corners).
      expect(area.visibleTop).toBeGreaterThanOrEqual(topChrome + tabsHeight);
      expect(area.visibleBottom).toBeLessThanOrEqual(VIEWPORT.height - occupied);
      expect(area.visibleBottom).toBeLessThanOrEqual(VIEWPORT.height - 8);
      expect(area.minHeight).toBeGreaterThanOrEqual(EMPTY_AREA_MIN_HEIGHT);
      await act(async () => { renderer.unmount(); });
    });
  }
});
