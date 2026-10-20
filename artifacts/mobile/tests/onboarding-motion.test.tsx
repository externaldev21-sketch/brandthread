import React, { useContext, useEffect } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const h = vi.hoisted(() => ({
  reduce: false,
  completions: [] as ((done: boolean) => void)[],
  mounts: {} as Record<string, number>,
  unmounts: {} as Record<string, number>,
  inert: {} as Record<string, boolean>,
  arrival: {} as Record<string, boolean>,
}));
vi.mock('@/contexts/AppThemeContext', () => ({
  useAppTheme: () => ({ theme: { background: '#000000' } }),
}));
vi.mock('@/lib/haptics', () => ({ hapticLight: vi.fn() }));
vi.mock('react-native-reanimated', async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  useReducedMotion: () => h.reduce,
  withSpring: vi.fn((to: number, _config?: unknown, completed?: (done: boolean) => void) => {
    if (completed) h.completions.push(completed);
    return to;
  }),
  withTiming: vi.fn((to: number) => to),
  withDelay: (_ms: number, animation: unknown) => animation,
  withSequence: (...animations: unknown[]) => animations.at(-1),
}));

import { OnboardingStepTransition } from '@/components/onboarding/OnboardingStepTransition';
import { ArrivalContext, InertContext, usePressMotion } from '@/components/onboarding/launch/motion';
import { hapticLight } from '@/lib/haptics';
import { withSpring, withTiming } from 'react-native-reanimated';

function Step({ id }: { id: string }) {
  h.inert[id] = useContext(InertContext);
  h.arrival[id] = useContext(ArrivalContext);
  useEffect(() => {
    h.mounts[id] = (h.mounts[id] ?? 0) + 1;
    return () => { h.unmounts[id] = (h.unmounts[id] ?? 0) + 1; };
  }, [id]);
  return <>{id}</>;
}

let tree: ReactTestRenderer;
const screen = (id: string, direction: 1 | -1 = 1) => (
  <OnboardingStepTransition stepId={id} direction={direction} onBack={() => {}}>
    <Step id={id} />
  </OnboardingStepTransition>
);

describe('onboarding motion lifecycle and touch feedback', () => {
  beforeEach(() => {
    h.reduce = false;
    h.completions.length = 0;
    h.mounts = {};
    h.unmounts = {};
    h.inert = {};
    h.arrival = {};
    vi.clearAllMocks();
  });
  afterEach(() => { act(() => tree?.unmount()); });

  it('keeps the outgoing instance mounted but inert until its spring finishes', () => {
    act(() => { tree = create(screen('welcome')); });
    expect(h.arrival.welcome).toBe(true);
    act(() => { tree.update(screen('birthday')); });
    expect(h.mounts.welcome).toBe(1);
    expect(h.unmounts.welcome ?? 0).toBe(0);
    expect(h.inert.welcome).toBe(true);
    expect(h.inert.birthday).toBe(false);
    act(() => { h.completions.at(-1)?.(true); });
    expect(h.unmounts.welcome).toBe(1);
    expect(h.mounts.birthday).toBe(1);
  });

  it('does not remove a live step when an older rapid-navigation spring completes', () => {
    act(() => { tree = create(screen('welcome')); });
    act(() => { tree.update(screen('birthday')); });
    const oldCompletion = h.completions.at(-1);
    act(() => { tree.update(screen('welcome', -1)); });
    act(() => { oldCompletion?.(true); });
    expect(h.inert.welcome).toBe(false);
    expect(h.arrival.welcome).toBe(false);
    expect(h.mounts.welcome).toBe(1);
    expect(h.unmounts.welcome ?? 0).toBe(0);
  });

  it('uses immediate swaps instead of page springs under Reduce Motion', () => {
    h.reduce = true;
    act(() => { tree = create(screen('welcome')); });
    act(() => { tree.update(screen('birthday')); });
    expect(h.unmounts.welcome).toBe(1);
    expect(withSpring).not.toHaveBeenCalled();
  });

  it('scales on press-in with one light haptic, springs on release, and ignores disabled presses', () => {
    let controls!: ReturnType<typeof usePressMotion>;
    function Button({ disabled = false }: { disabled?: boolean }) {
      controls = usePressMotion({ disabled });
      return null;
    }
    act(() => { tree = create(<Button />); });
    act(() => { controls.onPressIn(); });
    expect(hapticLight).toHaveBeenCalledTimes(1);
    expect(vi.mocked(withTiming).mock.calls.some(([target]) => target === 0.96)).toBe(true);
    act(() => { controls.onPressOut(); });
    expect(withSpring).toHaveBeenCalledWith(1, expect.any(Object));
    act(() => { tree.update(<Button disabled />); });
    act(() => { controls.onPressIn(); });
    expect(hapticLight).toHaveBeenCalledTimes(1);
  });
});
