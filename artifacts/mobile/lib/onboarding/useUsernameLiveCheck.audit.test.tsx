import React from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const pending: Array<(r: { available: boolean; error?: string }) => void> = [];
const checkUsernamePublic = vi.fn(() => new Promise<{ available: boolean; error?: string }>((resolve) => { pending.push(resolve); }));
const api = { auth: { checkUsernamePublic } };
vi.mock('@/lib/api', () => ({ useApi: () => api }));

import { useUsernameLiveCheck } from './useUsernameLiveCheck';

let latest: { error: string; checking: boolean } = { error: '', checking: false };
function Probe({ username }: { username: string }) {
  latest = useUsernameLiveCheck(username);
  return null;
}

describe('useUsernameLiveCheck (audit)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    pending.length = 0;
    checkUsernamePublic.mockClear();
  });
  afterEach(() => { vi.useRealTimers(); });

  it('ignores a reply for a name the field no longer holds once it was cleared', async () => {
    let r!: ReturnType<typeof create>;
    act(() => { r = create(<Probe username="taken_name" />); });
    act(() => { vi.advanceTimersByTime(500); });
    expect(checkUsernamePublic).toHaveBeenCalledWith('taken_name');

    // The person erases the field while the check is still in flight.
    act(() => { r.update(<Probe username="" />); });
    expect(latest).toEqual({ error: '', checking: false });

    await act(async () => { pending[0]({ available: false, error: 'Username is already taken.' }); });
    expect(latest).toEqual({ error: '', checking: false });
  });

  it('ignores a reply for a name that has since become invalid locally', async () => {
    let r!: ReturnType<typeof create>;
    act(() => { r = create(<Probe username="abc" />); });
    act(() => { vi.advanceTimersByTime(500); });
    act(() => { r.update(<Probe username="ab" />); });
    await act(async () => { pending[0]({ available: false }); });
    expect(latest.error).toBe('');
  });
});
