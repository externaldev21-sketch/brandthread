import React from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@/contexts/AppThemeContext', () => ({ useAppTheme: () => ({ theme: { accent: '#A855F7' } }) }));

import { useSecondsRemaining } from '../CommerceSignal';

afterEach(() => { vi.useRealTimers(); });

describe('useSecondsRemaining', () => {
  it('follows the real clock, not the number of ticks that happened to fire', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-29T12:00:00Z'));
    const endsAt = new Date('2026-10-29T13:00:00Z').toISOString(); // 3600s away
    const seen: Array<number | null> = [];
    function Probe() { seen.push(useSecondsRemaining(endsAt)); return null; }
    let renderer!: ReturnType<typeof create>;
    act(() => { renderer = create(<Probe />); });
    expect(seen[seen.length - 1]).toBe(3600);

    // The app sat in the background for 10 minutes (no timer ticks fired);
    // the next tick must show the real remaining time.
    vi.setSystemTime(new Date('2026-10-29T12:10:00Z'));
    act(() => { vi.advanceTimersByTime(1000); });
    expect(seen[seen.length - 1]).toBe(3600 - 601);
    act(() => { renderer.unmount(); });
  });
});
