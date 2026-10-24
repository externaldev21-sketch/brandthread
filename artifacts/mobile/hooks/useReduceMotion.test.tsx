import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const os = { enabled: false, listener: null as null | ((v: boolean) => void) };

vi.mock('react-native', () => ({
  AccessibilityInfo: {
    isReduceMotionEnabled: () => Promise.resolve(os.enabled),
    addEventListener: (_event: string, cb: (v: boolean) => void) => {
      os.listener = cb;
      return { remove() {} };
    },
  },
}));

import {
  __resetReduceMotionForTests, isMotionReduced, resolveReduceMotion, setReduceMotionPreference,
} from '@/lib/reduceMotion';
import { useReduceMotion } from './useReduceMotion';

function Probe({ onValue }: { onValue: (v: boolean) => void }) {
  onValue(useReduceMotion());
  return null;
}

describe('resolveReduceMotion', () => {
  it('is on when either the buyer setting or the OS setting is on', () => {
    expect(resolveReduceMotion(false, false)).toBe(false);
    expect(resolveReduceMotion(true, false)).toBe(true);
    expect(resolveReduceMotion(false, true)).toBe(true);
    expect(resolveReduceMotion(true, true)).toBe(true);
    expect(resolveReduceMotion(undefined, null)).toBe(false);
  });
});

describe('useReduceMotion', () => {
  beforeEach(() => {
    __resetReduceMotionForTests();
    os.enabled = false;
    os.listener = null;
  });

  it('follows the buyer "Reduce motion" setting', () => {
    let value = true;
    let renderer!: ReactTestRenderer;
    act(() => { renderer = create(<Probe onValue={(v) => { value = v; }} />); });
    expect(value).toBe(false);
    act(() => setReduceMotionPreference(true));
    expect(value).toBe(true);
    act(() => setReduceMotionPreference(false));
    expect(value).toBe(false);
    act(() => renderer.unmount());
  });

  it('follows the OS setting (initial value and change events)', async () => {
    os.enabled = true;
    let value = false;
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<Probe onValue={(v) => { value = v; }} />); });
    expect(value).toBe(true);
    act(() => os.listener?.(false));
    expect(value).toBe(false);
    expect(isMotionReduced()).toBe(false);
    act(() => renderer.unmount());
  });
});
