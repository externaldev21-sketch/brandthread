import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

const timing = vi.fn(() => ({ start: (cb?: () => void) => cb?.() }));
let listener: ((p: unknown) => void) | null = null;

vi.mock('react-native', () => {
  const React = require('react') as typeof import('react');
  const host = (name: string) => (props: Record<string, unknown>) => React.createElement(name, props, props.children as React.ReactNode);
  class Value { constructor(public v: number) {} setValue(n: number) { this.v = n; } }
  return {
    View: host('View'), Text: host('Text'), TouchableOpacity: host('TouchableOpacity'),
    Animated: { View: host('AnimatedView'), Value, timing: (...a: unknown[]) => timing(...(a as [])), spring: () => ({ start() {} }) },
    PanResponder: { create: () => ({ panHandlers: {} }) },
    StyleSheet: { create: (s: unknown) => s, hairlineWidth: 1 },
  };
});
vi.mock('@/hooks/useHeaderTopInset', () => ({ useHeaderTopInset: () => 0 }));
vi.mock('@/components/ui/Icon', () => ({ Icon: () => null }));
vi.mock('@/lib/haptics', () => ({ haptic: vi.fn() }));
vi.mock('@/lib/newOrderAlert', () => ({ isNewOrderNotification: () => false, playBannerFeedback: vi.fn() }));
vi.mock('@/contexts/AppThemeContext', () => ({ useAppTheme: () => ({ theme: { text: '#fff', muted: '#888', border: '#333', accent: '#fff', cardElevated: '#111', shadowColor: '#000' } }) }));
vi.mock('@/lib/theme', () => ({ FONT: {}, FS: {}, SP: { xs: 8, sm: 12 }, RADIUS: {} }));
vi.mock('@/lib/notificationBannerBus', () => ({ setNotificationBannerListener: (l: typeof listener) => { listener = l; } }));
vi.mock('@/lib/notificationNavigation', () => ({ createNotificationResponseHandler: () => () => {} }));

import NotificationBanner from './NotificationBanner';

describe('NotificationBanner', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('cancels its auto-dismiss when it unmounts', () => {
    vi.useFakeTimers();
    let r!: ReactTestRenderer;
    act(() => { r = create(<NotificationBanner />); });
    act(() => { listener?.({ id: 'n1', title: 'Hi', haptic: 'none' }); });
    act(() => { r.unmount(); });
    timing.mockClear();
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(timing).not.toHaveBeenCalled();
  });
});
