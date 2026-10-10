import { describe, expect, it, vi } from 'vitest';
import {
  afterThreadCashWrite,
  emitThreadCashChanged,
  isThreadCashNotification,
  subscribeThreadCashChanged,
} from '../threadCashEvents';

describe('threadCashEvents', () => {
  it('notifies every subscriber, and stops after unsubscribe', () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = subscribeThreadCashChanged(a);
    const offB = subscribeThreadCashChanged(b);
    emitThreadCashChanged();
    offA();
    emitThreadCashChanged();
    offB();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(2);
  });

  it('keeps notifying the others when one listener throws', () => {
    const ok = vi.fn();
    const offBad = subscribeThreadCashChanged(() => { throw new Error('boom'); });
    const offOk = subscribeThreadCashChanged(ok);
    expect(() => emitThreadCashChanged()).not.toThrow();
    expect(ok).toHaveBeenCalledTimes(1);
    offBad(); offOk();
  });

  it('fires after a successful write only, passing the result through', async () => {
    const listener = vi.fn();
    const off = subscribeThreadCashChanged(listener);
    await expect(afterThreadCashWrite(Promise.resolve({ ok: true }))).resolves.toEqual({ ok: true });
    expect(listener).toHaveBeenCalledTimes(1);
    await expect(afterThreadCashWrite(Promise.reject(new Error('402')))).rejects.toThrow('402');
    expect(listener).toHaveBeenCalledTimes(1);
    off();
  });

  it('recognises Thread Cash pushes and nothing else', () => {
    expect(isThreadCashNotification({ type: 'thread_cash_received', targetType: 'thread_cash_transfer' })).toBe(true);
    expect(isThreadCashNotification({ type: 'referral_reward', targetType: 'thread_cash_transfer' })).toBe(true);
    expect(isThreadCashNotification({ type: 'thread_cash_expiring' })).toBe(true);
    expect(isThreadCashNotification({ type: 'new_follower', targetType: 'user' })).toBe(false);
    expect(isThreadCashNotification(undefined)).toBe(false);
  });
});
