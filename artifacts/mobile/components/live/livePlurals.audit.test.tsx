import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/contexts/AppThemeContext', () => ({
  useAppTheme: () => ({ theme: { text: '#fff', muted: '#888', border: '#333', background: '#000', accent: '#fff', onAccent: '#000' } }),
}));
vi.mock('@/lib/theme', () => ({ FONT: {}, FS: {}, RADIUS: {}, SP: { sm: 12, md: 16, lg: 24, xl: 32, xs: 8 }, MEDIA: { fg: '#fff', fgMuted: '#ccc', chip: '#000', hairline: '#333', scrim: '#000', onFg: '#000' } }));
vi.mock('@/constants/radii', () => ({ radius: { sm: 4 } }));
vi.mock('@/constants/typography', () => ({ TABULAR_NUMS: {} }));
vi.mock('@/lib/haptics', () => ({ hapticLight: vi.fn(), hapticSelection: vi.fn() }));
vi.mock('@/components/CachedImage', () => ({ CachedImage: () => null }));
vi.mock('@/lib/money', () => ({ formatCents: (c: number) => `$${c / 100}` }));
vi.mock('@/lib/live/liveOrdering', () => ({
  LIVE_CHAT_VISIBLE: 5, formatViewerCount: (n: number) => String(n), formatUpcomingTime: () => 'Today',
}));
vi.mock('@/components/ui/Icon', () => ({ Icon: () => null }));
vi.mock('@/hooks/useColors', () => ({ useColors: () => ({ foreground: '#fff', mutedForeground: '#888' }) }));
vi.mock('@/components/analytics/AnalyticsKit', () => ({ CardDivider: () => null, SectionTitle: () => null }));
vi.mock('@/lib/live/liveAnalytics', () => ({
  formatLiveDate: () => 'Oct 1', formatLiveDuration: () => '1h', revenueLabel: (c: number) => `$${c / 100}`,
}));

import { LiveEmptyState } from './LiveEmptyState';
import { LiveRail } from './LiveOverlays';
import { LiveSummaryRows } from './LiveSummaryRows';

const json = (r: ReactTestRenderer) => JSON.stringify(r.toJSON());

describe('live copy pluralization', () => {
  it('Creators to follow: "1 follower"', () => {
    let r!: ReactTestRenderer;
    act(() => {
      r = create(
        <LiveEmptyState
          upcoming={[]}
          suggested={[{ host: { id: 'h', name: 'H', initials: 'H', avatarColor: '#000' }, followerCount: 1, following: false } as never]}
          topInset={0} bottomInset={0} onRemind={() => {}} onFollow={() => {}} onOpenCreator={() => {}}
        />,
      );
    });
    expect(json(r)).toMatch(/"1"," ","follower"/);
  });

  it('LIVE rail Shop label: "1 item"', () => {
    let r!: ReactTestRenderer;
    act(() => { r = create(<LiveRail productCount={1} onMore={() => {}} onOpenShop={() => {}} />); });
    const shop = r.root.findAll((n) => n.props.testID === 'live-bag' && typeof n.props.accessibilityLabel === 'string')[0];
    expect(shop.props.accessibilityLabel).toBe('Shop, 1 item');
  });

  it('Lives analytics row label: "1 order"', () => {
    let r!: ReactTestRenderer;
    act(() => {
      r = create(
        <LiveSummaryRows
          lives={[{ streamId: 's', title: 'Show', orders: 1, revenueCents: 500, status: 'ended', startedAt: '2026-10-01', durationSeconds: 60 } as never]}
          onOpen={() => {}}
        />,
      );
    });
    const row = r.root.findAll((n) => typeof n.props.accessibilityLabel === 'string' && n.props.accessibilityLabel.startsWith('Show'))[0];
    expect(row.props.accessibilityLabel).toBe('Show, 1 order, $5');
  });
});
