import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const storage = vi.hoisted(() => {
  let resolveRead: (v: string | null) => void = () => {};
  return {
    resolveRead: (v: string | null) => resolveRead(v),
    getItem: vi.fn(() => new Promise<string | null>((r) => { resolveRead = r; })),
    setItem: vi.fn(async () => {}),
  };
});
vi.mock('@react-native-async-storage/async-storage', () => ({ default: storage }));

import { usePhotoAutoAdvance } from './photoAutoAdvance';

describe('usePhotoAutoAdvance (audit)', () => {
  it('a toggle made before the stored value loads is not overwritten by the stale read', async () => {
    let latest: [boolean, (v: boolean) => void] | null = null;
    function Probe() { latest = usePhotoAutoAdvance(); return null; }
    act(() => { create(<Probe />); });
    expect(storage.getItem).toHaveBeenCalledTimes(1);
    expect(latest![0]).toBe(false);

    act(() => { latest![1](true); });
    expect(latest![0]).toBe(true);
    expect(storage.setItem).toHaveBeenCalledWith(expect.any(String), '1');

    // The read started before the toggle and returns the old value.
    await act(async () => { storage.resolveRead('0'); await Promise.resolve(); });
    expect(latest![0]).toBe(true);
  });
});
