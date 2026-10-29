import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => {
  const React = require('react') as typeof import('react');
  const host = (name: string) => React.forwardRef((props: Record<string, unknown>, ref) => {
    React.useImperativeHandle(ref, () => ({ scrollTo() {} }));
    return React.createElement(name, props, props.children as React.ReactNode);
  });
  return {
    View: host('View'), Text: host('Text'), ScrollView: host('ScrollView'),
    Platform: { OS: 'web' },
    StyleSheet: { create: (s: unknown) => s },
  };
});
vi.mock('@/lib/ageGate', () => ({
  daysInMonth: () => 31,
  MONTH_NAMES: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
}));
vi.mock('@/lib/theme', () => ({ FILL_ELEVATED: '#111', TEXT: { body: {} } }));
vi.mock('@/hooks/useColors', () => ({ useColors: () => ({ foreground: '#fff', mutedForeground: '#888' }) }));
vi.mock('@/constants/radii', () => ({ radius: { lg: 16, sm: 4 } }));

import { WheelDatePicker } from './WheelDatePicker';

describe('WheelDatePicker (web settle)', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('does not report a change after it unmounts mid-settle', () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    let r!: ReactTestRenderer;
    act(() => { r = create(<WheelDatePicker value={{ year: 2000, month: 1, day: 1 }} onChange={onChange} minYear={1926} maxYear={2026} />); });
    const month = r.root.findAll((n) => n.props.testID === 'onboarding-birthday-month' && n.props.onScroll)[0];
    act(() => { (month.props.onScroll as (e: unknown) => void)({ nativeEvent: { contentOffset: { y: 36 * 4 } } }); });
    act(() => { r.unmount(); });
    act(() => { vi.advanceTimersByTime(500); });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('still settles while mounted', () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    let r!: ReactTestRenderer;
    act(() => { r = create(<WheelDatePicker value={{ year: 2000, month: 1, day: 1 }} onChange={onChange} minYear={1926} maxYear={2026} />); });
    const month = r.root.findAll((n) => n.props.testID === 'onboarding-birthday-month' && n.props.onScroll)[0];
    act(() => { (month.props.onScroll as (e: unknown) => void)({ nativeEvent: { contentOffset: { y: 36 * 4 } } }); });
    act(() => { vi.advanceTimersByTime(500); });
    expect(onChange).toHaveBeenCalledWith({ year: 2000, month: 5, day: 1 });
  });
});
