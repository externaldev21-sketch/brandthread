/**
 * The AI credit balance belongs to one account. After an account switch the
 * hook must not keep showing (or later be overwritten by) the previous
 * account's balance.
 */
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

const auth = { isSignedIn: true, userId: 'user_a' as string | null };
const pending = new Map<string, Array<(v: unknown) => void>>();
const api = {
  aiCredits: {
    get: vi.fn(() => new Promise((resolve) => {
      const list = pending.get(auth.userId!) ?? [];
      list.push(resolve);
      pending.set(auth.userId!, list);
    })),
  },
};

vi.mock('@clerk/expo', () => ({ useAuth: () => ({ ...auth }) }));
vi.mock('@/lib/api', () => ({ useApi: () => api }));

import { invalidateAiCredits, useAiCredits } from './useAiCredits';

type Result = ReturnType<typeof useAiCredits>;
function Probe({ onValue }: { onValue: (v: Result) => void }) {
  onValue(useAiCredits());
  return null;
}

async function flush() { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); }

describe('useAiCredits across an account switch', () => {
  it("never shows (or is overwritten by) the previous account's balance", async () => {
    invalidateAiCredits();
    let latest!: Result;
    let r!: ReactTestRenderer;
    act(() => { r = create(<Probe onValue={(v) => { latest = v; }} />); });
    // Account A's first request is slow; it is still in flight when the
    // switch happens.
    const slowA = pending.get('user_a')!.shift()!;

    auth.userId = 'user_b';
    act(() => { r.update(<Probe onValue={(v) => { latest = v; }} />); });
    await flush();
    pending.get('user_b')!.shift()!({ balance: 7, unlimited: false });
    await flush();
    expect((latest.overview as { balance: number } | null)?.balance).toBe(7);

    // A's late answer must not replace B's balance.
    slowA({ balance: 500, unlimited: false });
    await flush();
    expect((latest.overview as { balance: number } | null)?.balance).toBe(7);
    act(() => r.unmount());
  });

  it('clears the shown balance while the new account loads', async () => {
    invalidateAiCredits();
    auth.userId = 'user_c';
    pending.clear();
    let latest!: Result;
    let r!: ReactTestRenderer;
    act(() => { r = create(<Probe onValue={(v) => { latest = v; }} />); });
    pending.get('user_c')!.shift()!({ balance: 3, unlimited: false });
    await flush();
    expect((latest.overview as { balance: number } | null)?.balance).toBe(3);

    auth.userId = 'user_d';
    act(() => { r.update(<Probe onValue={(v) => { latest = v; }} />); });
    await flush();
    // user_d's request has not answered yet: nothing, not user_c's 3.
    expect(latest.overview).toBeNull();
    act(() => r.unmount());
  });
});
