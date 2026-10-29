/**
 * Audit (chunk 09): two quick taps — the first save failing after the
 * second was sent must not undo the second choice, and a failed latest save
 * reverts to what the server last confirmed.
 */
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

type D = { promise: Promise<unknown>; resolve: (v: unknown) => void; reject: (e: unknown) => void };
function deferred(): D {
  let resolve!: (v: unknown) => void; let reject!: (e: unknown) => void;
  const promise = new Promise<unknown>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const h = vi.hoisted(() => ({ saves: [] as Array<{ hours: number | null; d: D }> }));

vi.mock('@/lib/api', () => {
  const api = {
    seller: {
      getCancelWindow: async () => ({ hours: null }),
      setCancelWindow: (hours: number | null) => {
        let resolve!: (v: unknown) => void; let reject!: (e: unknown) => void;
        const promise = new Promise<unknown>((res, rej) => { resolve = res; reject = rej; });
        h.saves.push({ hours, d: { promise, resolve, reject } });
        return promise;
      },
    },
  };
  return { useApi: () => api };
});
vi.mock('@/contexts/AppThemeContext', () => ({ useAppTheme: () => ({ theme: { text: '#fff', muted: '#888', card: '#111', border: '#333' } }) }));
vi.mock('@/lib/haptics', () => ({ hapticError: () => {}, hapticSelection: () => {} }));
vi.mock('@/components/BrandthreadUI', async () => {
  const RN = await import('react-native');
  return { PressableScale: (props: any) => React.createElement(RN.Pressable, props, props.children) };
});

import { CancelWindowSetting } from '../CancelWindowSetting';
import { CANCEL_WINDOW_OPTIONS } from '@/lib/cancelWindow';

async function flush() {
  await act(async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); });
}
function selectedHours(r: ReactTestRenderer) {
  return CANCEL_WINDOW_OPTIONS
    .filter((o) => r.root.findByProps({ testID: `cancel-window-${o.hours ?? 'shipped'}` }).props.accessibilityState.selected)
    .map((o) => o.hours);
}
async function press(r: ReactTestRenderer, hours: number | null) {
  await act(async () => { r.root.findByProps({ testID: `cancel-window-${hours ?? 'shipped'}` }).props.onPress(); });
}

describe('CancelWindowSetting', () => {
  it('an older failed save does not undo a newer successful one', async () => {
    void deferred;
    h.saves.length = 0;
    const [first, second] = CANCEL_WINDOW_OPTIONS.filter((o) => o.hours !== null);
    let r!: ReactTestRenderer;
    await act(async () => { r = create(<CancelWindowSetting />); });
    await flush();
    await press(r, first.hours);
    await press(r, second.hours);
    await act(async () => { h.saves[1].d.resolve({ hours: second.hours }); });
    await flush();
    await act(async () => { h.saves[0].d.reject(new Error('timeout')); });
    await flush();
    expect(selectedHours(r)).toEqual([second.hours]);
  });

  it('a failed latest save reverts to the last confirmed value', async () => {
    h.saves.length = 0;
    const [first, second] = CANCEL_WINDOW_OPTIONS.filter((o) => o.hours !== null);
    let r!: ReactTestRenderer;
    await act(async () => { r = create(<CancelWindowSetting />); });
    await flush();
    await press(r, first.hours);
    await act(async () => { h.saves[0].d.resolve({ hours: first.hours }); });
    await flush();
    await press(r, second.hours);
    await act(async () => { h.saves[1].d.reject(new Error('offline')); });
    await flush();
    expect(selectedHours(r)).toEqual([first.hours]);
  });
});
