import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let responderConfig: any = null;
vi.mock('react-native', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    PanResponder: {
      create: (config: unknown) => { responderConfig = config; return { panHandlers: {} }; },
    },
  };
});
vi.mock('@/lib/haptics', () => ({ haptics: {}, haptic: () => {} }));

import { InlineSlider } from '../InlineSlider';

describe('InlineSlider drag', () => {
  it('applies the cumulative drag distance to the value the drag started from', () => {
    const onChange = vi.fn();
    const props = { min: 0, max: 100, onChange, accessibilityLabel: 'Budget' };
    let renderer!: ReturnType<typeof create>;
    act(() => { renderer = create(<InlineSlider value={0} {...props} />); });
    // 100px wide track over a 0–100 range: 1px = 1 unit.
    const touch = renderer.root.findAll((n) => typeof n.props.onLayout === 'function')[0];
    act(() => { touch.props.onLayout({ nativeEvent: { layout: { width: 100 } } }); });

    responderConfig.onPanResponderGrant({}, { dx: 0 });
    responderConfig.onPanResponderMove({}, { dx: 10 });
    expect(onChange).toHaveBeenLastCalledWith(10);

    // The screen re-renders with the new value mid-drag; the finger is now
    // 20px from where it started, so the value must be 20 — not 10 + 20.
    act(() => { renderer.update(<InlineSlider value={10} {...props} />); });
    responderConfig.onPanResponderMove({}, { dx: 20 });
    expect(onChange).toHaveBeenLastCalledWith(20);
  });
});
