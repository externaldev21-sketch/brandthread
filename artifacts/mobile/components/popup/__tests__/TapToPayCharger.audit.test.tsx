/**
 * Reader discovery has a 20s "nothing found" fallback. It is cancelled when
 * readers arrive first and when the charger unmounts.
 */
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let onReaders: ((readers: unknown[]) => void) | null = null;
let discovered: Promise<unknown[]> | null = null;
const sdk = {
  StripeTerminalProvider: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
  useStripeTerminal: (opts: { onUpdateDiscoveredReaders: (r: unknown[]) => void }) => {
    onReaders = opts.onUpdateDiscoveredReaders;
    return { initialize: async () => ({}) };
  },
};
vi.mock('@/lib/tapToPay', () => ({
  loadTerminalModule: () => sdk,
  chargeWithTapToPay: async ({ nextDiscoveredReaders }: { nextDiscoveredReaders: () => Promise<unknown[]> }) => {
    discovered = nextDiscoveredReaders();
    return { status: 'pending' };
  },
}));

import { TapToPayCharger, type TapToPayChargerHandle } from '../TapToPayCharger';

async function startCharge(): Promise<ReactTestRenderer> {
  const ref = React.createRef<TapToPayChargerHandle>();
  let r!: ReactTestRenderer;
  act(() => { r = create(<TapToPayCharger ref={ref} fetchConnectionToken={async () => 'tok'} />); });
  await act(async () => { await ref.current!.charge('secret', 'loc'); });
  return r;
}

afterEach(() => { vi.useRealTimers(); discovered = null; });

describe('TapToPayCharger reader discovery', () => {
  it('cancels the fallback once readers are reported', async () => {
    vi.useFakeTimers();
    await startCharge();
    expect(vi.getTimerCount()).toBe(1);
    act(() => { onReaders!(['reader-1']); });
    await expect(discovered).resolves.toEqual(['reader-1']);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels the fallback on unmount', async () => {
    vi.useFakeTimers();
    const r = await startCharge();
    expect(vi.getTimerCount()).toBe(1);
    act(() => { r.unmount(); });
    expect(vi.getTimerCount()).toBe(0);
  });
});
