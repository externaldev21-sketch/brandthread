/**
 * QA-0057: buyer Settings > Notifications must be a real, persisted screen
 * with buyer toggles and the promotional opt-in — never seller rows.
 */
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { nativeComponent, prefs } = vi.hoisted(() => ({
  nativeComponent: (name: string) => {
    function MockNativeComponent(props: Record<string, unknown>) {
      return React.createElement(name, props, props.children as React.ReactNode);
    }
    MockNativeComponent.displayName = name;
    return MockNativeComponent;
  },
  prefs: { get: vi.fn(), update: vi.fn() },
}));

vi.mock('react-native', () => ({
  ActivityIndicator: nativeComponent('ActivityIndicator'),
  ScrollView: nativeComponent('ScrollView'),
  View: nativeComponent('View'),
  Text: nativeComponent('Text'),
  StyleSheet: { create: (st: unknown) => st, hairlineWidth: 1 },
}));
vi.mock('expo-router', () => ({ useRouter: () => ({ back: vi.fn() }) }));
const stableApi = { notificationPrefs: prefs };
vi.mock('@/hooks/useApi', () => ({ useApi: () => stableApi }));
vi.mock('@/components/ScreenHeader', () => ({ ScreenHeader: nativeComponent('ScreenHeader') }));
vi.mock('@/lib/navigation/goBackOr', () => ({ goBackOr: vi.fn() }));
vi.mock('@/hooks/useColors', () => ({ useColors: () => ({ border: '#333', foreground: '#fff', mutedForeground: '#aaa' }) }));
vi.mock('@/lib/haptics', () => ({ hapticToggle: vi.fn() }));
vi.mock('@/components/ui', () => ({ ListRow: nativeComponent('ListRow'), ChipGroup: nativeComponent('ChipGroup') }));
vi.mock('@/components/ui/Card', () => ({ Card: nativeComponent('Card') }));
vi.mock('@/components/ui/RetryRow', () => ({ RetryRow: nativeComponent('RetryRow') }));
vi.mock('@/constants/typography', () => ({ TYPE_SCALE: { footnote: {} } }));
vi.mock('@/constants/spacing', () => ({ SPACING: { md: 16, sm: 8, xxs: 2 } }));
vi.mock('@/lib/theme', () => ({ FONT: { semibold: 'Inter' } }));

import NotificationsSettingsScreen from '@/app/notifications-settings';

let tree: ReactTestRenderer | undefined;
const titles = () => tree!.root.findAllByType('ListRow' as never).map((r) => r.props.title as string);

describe('notification settings for buyers (QA-0057)', () => {
  afterEach(() => { act(() => tree?.unmount()); tree = undefined; vi.clearAllMocks(); });

  it('shows buyer toggles only, plus the promotional opt-in', async () => {
    prefs.get.mockResolvedValue({ role: 'buyer', pushEnabled: true, promotionalPush: false, quietHours: { start: null, end: null }, categories: {}, digest: 'realtime' });
    await act(async () => { tree = create(<NotificationsSettingsScreen />); });
    expect(titles()).toEqual(expect.arrayContaining(['Order updates', 'Messages', 'Promotions & offers']));
    expect(titles()).not.toContain('New orders');
    expect(titles()).not.toContain('Payout confirmations');
  });

  it('shows no rows (not seller rows) before the role is known', async () => {
    prefs.get.mockReturnValue(new Promise(() => {}));
    await act(async () => { tree = create(<NotificationsSettingsScreen />); });
    expect(titles()).toEqual([]);
  });

  it('saves a toggle to the server', async () => {
    prefs.get.mockResolvedValue({ role: 'buyer', pushEnabled: true, promotionalPush: false, quietHours: { start: null, end: null }, categories: {}, digest: 'realtime' });
    prefs.update.mockResolvedValue({ role: 'buyer', pushEnabled: true, promotionalPush: true, quietHours: { start: null, end: null }, categories: {}, digest: 'realtime' });
    await act(async () => { tree = create(<NotificationsSettingsScreen />); });
    const promo = tree!.root.findAllByType('ListRow' as never).find((r) => r.props.title === 'Promotions & offers')!;
    await act(async () => { await promo.props.toggle.onChange(true); });
    expect(prefs.update).toHaveBeenCalledWith({ promotionalPush: true });
  });

  it('offers a retry instead of guessing when loading fails', async () => {
    prefs.get.mockRejectedValue(new Error('offline'));
    await act(async () => { tree = create(<NotificationsSettingsScreen />); });
    expect(tree!.root.findAllByType('RetryRow' as never)).toHaveLength(1);
    expect(titles()).toEqual([]);
  });
});
