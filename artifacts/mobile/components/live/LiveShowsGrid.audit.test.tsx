import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

const provider = {
  id: 'api',
  listLive: vi.fn(),
  listUpcoming: vi.fn(),
  setReminder: vi.fn(),
};

vi.mock('@/lib/live/liveProvider', () => ({ getLiveStreamProvider: () => provider }));
vi.mock('@/lib/live/useLiveAvailability', () => ({ useLiveAvailability: () => 'available' }));
vi.mock('@/lib/live/liveAvailability', () => ({ LIVE_NOT_CONFIGURED_BUYER_BODY: '', LIVE_NOT_CONFIGURED_TITLE: '' }));
vi.mock('@/lib/live/liveOrdering', () => ({ formatUpcomingTime: () => 'Today 7:00 PM', formatViewerCount: (n: number) => String(n) }));
vi.mock('@/contexts/AppThemeContext', () => ({
  useAppTheme: () => ({ theme: { text: '#fff', muted: '#888', border: '#333', borderSubtle: '#222', background: '#000', cardElevated: '#111' } }),
}));
vi.mock('@/lib/theme', () => ({ FONT: {}, FS: {}, MEDIA: { fg: '#fff' }, SP: { sm: 12, md: 16, lg: 24, xl: 32, xs: 8 } }));
vi.mock('@/constants/typography', () => ({ TABULAR_NUMS: {} }));
vi.mock('@/lib/haptics', () => ({ hapticLight: vi.fn() }));
vi.mock('@/components/CachedImage', () => ({ CachedImage: () => null }));
vi.mock('@/components/ui/ThemedRefreshControl', () => ({ ThemedRefreshControl: () => null }));
vi.mock('./LiveOverlays', () => ({ LiveHostAvatar: () => null }));
vi.mock('./LiveNotice', () => ({ LiveNotice: () => null }));
vi.mock('./LiveAvatarRing', () => ({ LIVE_RED: '#d00' }));

import { LiveShowsGrid } from './LiveShowsGrid';

const upcoming = [{ id: 'u1', title: 'Drop', startsAt: Date.now() + 3600_000, reminderSet: false, host: { id: 'h1', name: 'Host' } }];
const flush = () => act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); });
const remindLabel = (r: ReactTestRenderer) =>
  r.root.findAll((n) => typeof n.props.accessibilityLabel === 'string' && n.props.accessibilityLabel.includes('Drop') && n.props.onPress)[0].props.accessibilityLabel as string;

describe('LiveShowsGrid', () => {
  it('a remount seeded from the cache shows the reminder the viewer just set', async () => {
    provider.listLive.mockResolvedValue([]);
    provider.listUpcoming.mockResolvedValue(upcoming);
    provider.setReminder.mockResolvedValue(undefined);
    let r!: ReactTestRenderer;
    act(() => { r = create(<LiveShowsGrid onOpenShow={() => {}} />); });
    await flush();
    expect(remindLabel(r)).toBe('Remind me about Drop');
    const btn = r.root.findAll((n) => n.props.accessibilityLabel === 'Remind me about Drop' && n.props.onPress)[0];
    await act(async () => { (btn.props.onPress as () => void)(); await Promise.resolve(); });
    expect(remindLabel(r)).toBe('Reminder set for Drop');
    act(() => { r.unmount(); });

    // Next mount: the refresh hasn't answered yet, so the cache is all there is.
    provider.listLive.mockReturnValue(new Promise(() => {}));
    let r2!: ReactTestRenderer;
    act(() => { r2 = create(<LiveShowsGrid onOpenShow={() => {}} />); });
    expect(remindLabel(r2)).toBe('Reminder set for Drop');
    act(() => { r2.unmount(); });
  });
});
