/**
 * The day chips must follow the clock: a seller who opens the launch picker
 * after midnight (app left running) must get today's date for "Today", not
 * the date the module happened to be loaded on.
 */
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@/hooks/useColors', () => ({
  useColors: () => ({ primary: '#fff', primaryForeground: '#000', border: '#333', card: '#111', foreground: '#fff', mutedForeground: '#999' }),
}));
vi.mock('@/components/ui/Icon', () => ({ Icon: () => null }));
vi.mock('@/components/ui/NativeDateTimeField', () => ({ NativeDateTimeField: () => null }));
vi.mock('@/components/ui/ChipRow', () => ({
  ChipRow: ({ children }: { children: React.ReactNode }) => React.createElement('ChipRow', null, children),
}));
vi.mock('@/lib/inputReset', () => ({ WEB_INPUT_RESET: {} }));

afterEach(() => { vi.useRealTimers(); });

describe('LaunchTimePicker day chips', () => {
  it('labels the current day "Today" even when the module was loaded the day before', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 0, 10, 23, 0, 0));
    const { LaunchTimePicker } = await import('../LaunchTimePicker');

    // The app stays open past midnight.
    vi.setSystemTime(new Date(2026, 0, 11, 9, 0, 0));
    const onDateChange = vi.fn();
    let r!: ReactTestRenderer;
    act(() => {
      r = create(<LaunchTimePicker dateValue="" timeValue="" onDateChange={onDateChange} onTimeChange={() => {}} />);
    });
    const chipRows = r.root.findAll((n) => (n.type as unknown) === 'ChipRow');
    const todayChip = chipRows[0].findAll((n) => typeof n.props.onPress === 'function')[0];
    act(() => { todayChip.props.onPress(); });
    expect(onDateChange).toHaveBeenCalledWith('2026-01-11');
  });
});
