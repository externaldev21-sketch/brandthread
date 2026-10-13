import { describe, expect, it } from 'vitest';
import { canUnsend, UNSEND_WINDOW_MS } from '../unsend';

const id = '0b6f2f0e-1c2d-4e5f-8a9b-0c1d2e3f4a5b';
const now = 1_800_000_000_000;

describe('canUnsend', () => {
  it('own, sent, inside the window', () => {
    expect(canUnsend({ id, ts: now - 60_000, status: 'sent' }, true, now)).toBe(true);
  });
  it('not for other people, old, failed, pending or local-only messages', () => {
    expect(canUnsend({ id, ts: now - 60_000 }, false, now)).toBe(false);
    expect(canUnsend({ id, ts: now - UNSEND_WINDOW_MS - 1 }, true, now)).toBe(false);
    expect(canUnsend({ id, ts: now, status: 'failed' }, true, now)).toBe(false);
    expect(canUnsend({ id, ts: now, status: 'sending' }, true, now)).toBe(false);
    expect(canUnsend({ id: 'local-123', ts: now }, true, now)).toBe(false);
  });
});
