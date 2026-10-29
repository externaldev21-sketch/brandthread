/**
 * OrderConfetti promises "Skipped entirely under Reduce Motion". The setting
 * is read asynchronously, so the burst (and its success haptic) must wait for
 * it instead of firing on the first render with an assumed "motion on".
 */
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AccessibilityInfo } from 'react-native';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const success = vi.fn();
vi.mock('@/lib/haptics', () => ({ haptics: { success: () => success() } }));
vi.mock('react-native-reanimated', async () => {
  const shim = await vi.importActual<Record<string, unknown>>('../../../tests/shims/reanimated');
  return { ...shim, withDelay: (_ms: number, value: unknown) => value };
});

import { OrderConfetti } from '../OrderConfetti';

const original = AccessibilityInfo.isReduceMotionEnabled;
afterEach(() => {
  AccessibilityInfo.isReduceMotionEnabled = original;
  success.mockReset();
});

function confetti(renderer: ReactTestRenderer) {
  return renderer.root.findAll((n) => (n.type as unknown) === 'View' && n.props.testID === 'order-confetti');
}

describe('OrderConfetti and Reduce Motion', () => {
  it('never bursts or buzzes when Reduce Motion resolves on', async () => {
    let resolve!: (v: boolean) => void;
    AccessibilityInfo.isReduceMotionEnabled = () => new Promise<boolean>((r) => { resolve = r; });
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<OrderConfetti play />); });
    // Still unknown: nothing yet.
    expect(confetti(renderer)).toHaveLength(0);
    expect(success).not.toHaveBeenCalled();
    await act(async () => { resolve(true); });
    expect(confetti(renderer)).toHaveLength(0);
    expect(success).not.toHaveBeenCalled();
  });

  it('plays once the setting is known to be off', async () => {
    AccessibilityInfo.isReduceMotionEnabled = async () => false;
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<OrderConfetti play />); });
    expect(confetti(renderer)).toHaveLength(1);
    expect(success).toHaveBeenCalledTimes(1);
  });
});
