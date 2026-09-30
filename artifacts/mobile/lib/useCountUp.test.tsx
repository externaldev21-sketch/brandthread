/**
 * useCountUp — the dashboard hero number's count-up animation. Reported bug:
 * the hero showed $0.00 while the delta line (computed instantly, not
 * animated) already showed a real "+$162.57 (16.4%)" figure, and it stayed
 * that way well past the animation's own duration. Root cause: the hero's
 * displayed number is driven entirely by requestAnimationFrame, which a
 * backgrounded/inactive tab can throttle or fully suspend — leaving the
 * displayed number stuck mid-animation indefinitely. These tests simulate
 * exactly that (rAF registered but never invoked) and assert the hook still
 * converges to `target` via its setTimeout backstop.
 */
import React from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCountUp } from './useCountUp';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function TestComponent({ target, active, onRender }: { target: number; active: boolean; onRender: (value: number) => void }) {
  const value = useCountUp(target, active);
  React.useEffect(() => { onRender(value); });
  return null;
}

describe('useCountUp', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('converges to target via its setTimeout backstop even if requestAnimationFrame stalls after the first frame (a backgrounded tab)', () => {
    // Simulates the real failure: the browser runs the animation's first
    // frame (display drops toward 0, exactly the "$0.00" moment the report
    // describes) then the tab backgrounds and rAF never calls back again.
    let calls = 0;
    vi.stubGlobal('requestAnimationFrame', vi.fn((cb: FrameRequestCallback) => {
      calls += 1;
      if (calls === 1) cb(0); // one real frame, at t=0 → eased progress 0
      return calls;
    }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    let latest = -1;
    act(() => {
      create(<TestComponent target={16257} active onRender={(v) => { latest = v; }} />);
    });
    // After that single stalled frame, the hero would show $0.00 next to a
    // delta line that already reflects the real (nonzero) target — exactly
    // the reported bug, absent the backstop below.
    expect(latest).toBe(0);

    act(() => { vi.advanceTimersByTime(900); }); // durationMs (650) + backstop buffer (250)
    expect(latest).toBe(16257);
  });

  it('tracks target exactly (no animation) when active is false, e.g. while scrubbing the chart', () => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 0));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    let latest = -1;
    act(() => {
      create(<TestComponent target={4200} active={false} onRender={(v) => { latest = v; }} />);
    });
    expect(latest).toBe(4200);
  });
});
