/**
 * Each date field's label carries the zone abbreviation for that field's own
 * instant: a sale starting in July and ending in December reads EDT / EST,
 * not today's abbreviation for both.
 */
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@/components/products/LaunchTimePicker', () => ({ LaunchTimePicker: () => null }));
vi.mock('@/components/BrandthreadUI', () => ({ HapticSwitch: () => null, PressableScale: () => null }));
vi.mock('@/components/ScreenHeader', () => ({ ScreenHeader: () => null }));
vi.mock('@/contexts/AppThemeContext', () => ({
  useAppTheme: () => ({ theme: new Proxy({}, { get: () => '#000' }) }),
}));
vi.mock('@/lib/haptics', () => ({ hapticSelection: () => {} }));
vi.mock('@/lib/inputReset', () => ({ WEB_INPUT_RESET: {} }));

import { ActiveDatesFields } from '../ActiveDatesFields';

function labels(r: ReactTestRenderer): string[] {
  return r.root.findAll((n) => (n.type as unknown) === 'Text')
    .map((n) => [].concat(n.props.children).join(''))
    .filter((t) => /date and time/.test(t));
}

describe('ActiveDatesFields zone abbreviations', () => {
  it('labels a July start EDT and a December end EST in New York', () => {
    let r!: ReactTestRenderer;
    act(() => {
      r = create(
        <ActiveDatesFields
          value={{
            startDate: '2026-07-01', startTime: '10:00',
            hasEnd: true, endDate: '2026-12-01', endTime: '10:00',
            zone: 'America/New_York', startWasEmpty: false, startTouched: true, touched: false,
          }}
          onChange={() => {}}
        />,
      );
    });
    expect(labels(r)).toEqual(['Start date and time (EDT)', 'End date and time (EST)']);
  });
});
