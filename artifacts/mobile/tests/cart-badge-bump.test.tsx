import React from 'react';
import { act, create } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { anim } = vi.hoisted(() => ({
  anim: { setValues: [] as number[], springs: [] as Array<Record<string, unknown>>, sequences: 0, reduce: false as boolean },
}));

vi.mock('react-native', () => ({
  AccessibilityInfo: {
    isReduceMotionEnabled: () => Promise.resolve(anim.reduce),
    addEventListener: () => ({ remove: () => {} }),
  },
  Animated: {
    Value: class {
      constructor(public v: number) {}
      setValue(v: number) { anim.setValues.push(v); }
    },
    spring: (_v: unknown, config: Record<string, unknown>) => { anim.springs.push(config); return {}; },
    sequence: () => ({ start: () => { anim.sequences += 1; } }),
  },
}));

import { CART_BUMP, useCartBadgeBump } from '@/hooks/useCartBadgeBump';

let bump: () => void = () => {};
function Probe({ reduceMotion }: { reduceMotion?: boolean | null }) {
  bump = useCartBadgeBump(reduceMotion).bump;
  return null;
}
async function mount(reduceMotion?: boolean | null) {
  await act(async () => { create(<Probe reduceMotion={reduceMotion} />); });
}

describe('useCartBadgeBump', () => {
  beforeEach(() => {
    anim.setValues = [];
    anim.springs = [];
    anim.sequences = 0;
    anim.reduce = false;
  });

  it('never animates on mount — only when bump() is called', async () => {
    await mount(false);
    expect(anim.sequences).toBe(0);
    act(() => bump());
    expect(anim.sequences).toBe(1);
  });

  it("uses the feed's original spring: dip 0.78 → 1.18 → 1", async () => {
    await mount(false);
    act(() => bump());
    expect(anim.setValues).toEqual([CART_BUMP.dipTo]);
    expect(CART_BUMP.dipTo).toBe(0.78);
    expect(anim.springs).toEqual([
      { toValue: 1.18, speed: 28, bounciness: 8, useNativeDriver: true },
      { toValue: 1, speed: 24, bounciness: 4, useNativeDriver: true },
    ]);
  });

  it('respects Reduce Motion passed by the screen, and unknown (null) = no animation', async () => {
    await mount(true);
    act(() => bump());
    await mount(null);
    act(() => bump());
    expect(anim.sequences).toBe(0);
  });

  it('tracks Reduce Motion itself when the screen does not pass it', async () => {
    anim.reduce = true;
    await mount();
    act(() => bump());
    expect(anim.sequences).toBe(0);
    anim.reduce = false;
    await mount();
    act(() => bump());
    expect(anim.sequences).toBe(1);
  });
});
