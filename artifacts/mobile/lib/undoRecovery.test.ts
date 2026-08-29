import { describe, expect, it } from 'vitest';
import { canUndoUntil, undoExpiresAt } from './undoRecovery';

describe('undo recovery expiry', () => {
  it('permits undo only before the recovery window expires', () => {
    const expiresAt = undoExpiresAt(1_000, 6_000);
    expect(canUndoUntil(expiresAt, 6_999)).toBe(true);
    expect(canUndoUntil(expiresAt, 7_000)).toBe(false);
  });
});