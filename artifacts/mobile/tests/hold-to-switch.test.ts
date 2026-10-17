import { describe, expect, it } from 'vitest';

import {
  HOLD_RING_DELAY_MS, HOLD_RING_DRAW_MS, HOLD_SWITCH_MS, HOLD_TAP_MAX_MS,
  holdOutcome, pickNextAccount,
} from '@/lib/holdToSwitch';

describe('hold-to-switch threshold', () => {
  it('the ring takes 450-550ms to draw, and the switch fires when it closes', () => {
    expect(HOLD_RING_DRAW_MS).toBeGreaterThanOrEqual(450);
    expect(HOLD_RING_DRAW_MS).toBeLessThanOrEqual(550);
    expect(HOLD_SWITCH_MS).toBe(HOLD_RING_DELAY_MS + HOLD_RING_DRAW_MS);
  });

  it('a quick tap opens Profile', () => {
    expect(holdOutcome(60, false)).toBe('tap');
    expect(holdOutcome(HOLD_TAP_MAX_MS - 1, false)).toBe('tap');
  });

  it('releasing after a tap but before the ring closes cancels', () => {
    expect(holdOutcome(HOLD_TAP_MAX_MS, false)).toBe('cancel');
    expect(holdOutcome(HOLD_SWITCH_MS - 1, false)).toBe('cancel');
    // Even past the nominal time: until the ring itself has closed, nothing switches.
    expect(holdOutcome(HOLD_SWITCH_MS + 50, false)).toBe('cancel');
  });

  it('a completed ring switches, however the release is timed', () => {
    expect(holdOutcome(HOLD_SWITCH_MS, true)).toBe('switch');
    expect(holdOutcome(2_000, true)).toBe('switch');
  });

  it('the ring does not start inside the tap window', () => {
    expect(HOLD_RING_DELAY_MS).toBeGreaterThanOrEqual(HOLD_TAP_MAX_MS);
  });
});

describe('next account', () => {
  const a = { id: 'a', lastActiveAt: 1_000 };
  const b = { id: 'b', lastActiveAt: 3_000 };
  const c = { id: 'c', lastActiveAt: 2_000 };

  it('two accounts toggle', () => {
    expect(pickNextAccount([a, b], 'a')?.id).toBe('b');
    expect(pickNextAccount([a, b], 'b')?.id).toBe('a');
  });

  it('with 3+ accounts, goes to the most recently used other account', () => {
    expect(pickNextAccount([a, b, c], 'b')?.id).toBe('c');
    expect(pickNextAccount([a, b, c], 'c')?.id).toBe('b');
    expect(pickNextAccount([a, b, c], 'a')?.id).toBe('b');
  });

  it('after switching, the account just left is the next one back (rotation)', () => {
    // On b; switch -> c (most recent other). Clerk then stamps b as just-left.
    const now = 5_000;
    const afterSwitch = [a, { ...b, lastActiveAt: now }, { ...c, lastActiveAt: now + 1 }];
    expect(pickNextAccount(afterSwitch, 'c')?.id).toBe('b');
  });

  it('accepts Date timestamps and missing ones', () => {
    expect(pickNextAccount([{ id: 'x', lastActiveAt: null }, { id: 'y', lastActiveAt: new Date(10) }], 'z')?.id).toBe('y');
  });

  it('only one account: nothing to switch to', () => {
    expect(pickNextAccount([a], 'a')).toBeNull();
    expect(pickNextAccount([], 'a')).toBeNull();
  });
});
