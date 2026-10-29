/**
 * Motion blur names its stage 'mblur' for the next stage to read. When the
 * blur length at the render scale is 0 (xScale 0, e.g. a not-yet-measured
 * 0-wide thumbnail), motionBlurTaps returns ONE tap, and the only composite
 * was named 'mb_a0' — so 'mblur' never existed and every later stage (and
 * the caller's blend stage) read a dangling input.
 */
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native-svg', () => ({
  FeColorMatrix: 'FeColorMatrix', FeComposite: 'FeComposite', FeGaussianBlur: 'FeGaussianBlur',
  FeOffset: 'FeOffset', FeBlend: 'FeBlend',
}));

import { buildAdjustmentStages } from '../layerFilterChain';

type El = React.ReactElement<Record<string, unknown>>;
function flatten(nodes: React.ReactNode): El[] {
  const out: El[] = [];
  React.Children.forEach(nodes, (n) => {
    if (!React.isValidElement(n)) return;
    const el = n as El;
    if (el.type === React.Fragment) out.push(...flatten(el.props.children as React.ReactNode));
    else out.push(el);
  });
  return out;
}

describe('motion blur stage naming', () => {
  it('produces its declared result even with a single tap', () => {
    const { stages, lastResult } = buildAdjustmentStages(
      { effects: { motionBlur: { amount: 10, angle: 0 }, bloom: 0.5 } } as never,
      0,
    );
    const els = flatten(stages);
    const results = new Set(els.map((e) => e.props.result));
    expect(results.has('mblur')).toBe(true);
    // The stage after motion blur reads it.
    expect(els.some((e) => e.props.in === 'mblur')).toBe(true);
    expect(lastResult).toBe('bloom');
  });
});
