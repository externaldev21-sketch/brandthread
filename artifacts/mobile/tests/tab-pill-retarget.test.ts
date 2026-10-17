/**
 * Tab bar pill under rapid tapping: every tap retargets the pill to the
 * newest tab from wherever it is, late navigation commits from earlier taps
 * in the burst never drag it backwards, duplicate taps are no-ops, and the
 * pill always ends on the tab the navigator actually committed.
 */
import { describe, expect, it } from 'vitest';

import {
  STALE_COMMIT_MS, initialPillState, pillCommit, pillPress, pillSettle, type PillRetargetState,
} from '@/lib/tabPillRetarget';

type Event = { at: number } & ({ press: number } | { commit: number } | { settle: true });

/** Replays a timeline and returns every slot the pill was sent to. */
function replay(start: number, events: Event[]) {
  let state: PillRetargetState = initialPillState(start);
  const moves: number[] = [];
  for (const event of events) {
    const step = 'press' in event
      ? pillPress(state, event.press, event.at)
      : 'commit' in event
        ? pillCommit(state, event.commit, event.at)
        : pillSettle(state, event.at);
    state = step.state;
    if (step.moveTo !== null) moves.push(step.moveTo);
  }
  return { state, moves };
}

describe('tab pill retarget', () => {
  it('moves on press, and the matching commit does not move it again', () => {
    const { state, moves } = replay(0, [{ at: 0, press: 2 }, { at: 30, commit: 2 }]);
    expect(moves).toEqual([2]);
    expect(state.target).toBe(2);
    expect(state.pending).toBeNull();
  });

  it('a 10-tap burst at ~8 taps/s with commits lagging one tap behind never goes backwards', () => {
    const taps = [1, 2, 3, 0, 1, 3, 2, 0, 3, 1];
    const events: Event[] = [];
    taps.forEach((tab, i) => {
      events.push({ at: i * 120, press: tab });
      // Each tap's commit lands just after the NEXT tap's press-in.
      if (i > 0) events.push({ at: i * 120 + 5, commit: taps[i - 1] });
    });
    events.push({ at: 9 * 120 + 60, commit: taps[9] });
    const { state, moves } = replay(0, events);
    // Exactly one move per tap, in tap order: no snap back to a late commit.
    expect(moves).toEqual(taps);
    expect(state.target).toBe(1);
    expect(state.committed).toBe(1);
    expect(state.pending).toBeNull();
  });

  it('ignores a duplicate tap on the tab the pill is already on or heading to', () => {
    const { moves } = replay(0, [
      { at: 0, press: 0 },
      { at: 10, commit: 0 },
      { at: 100, press: 2 },
      { at: 120, press: 2 },
      { at: 150, commit: 2 },
    ]);
    expect(moves).toEqual([2]);
  });

  it('returns to the committed tab when a press never becomes a navigation', () => {
    const { state, moves } = replay(1, [
      { at: 0, press: 3 },
      // finger slid off / tabPress prevented: no commit for 3
      { at: STALE_COMMIT_MS + 1, settle: true },
    ]);
    expect(moves).toEqual([3, 1]);
    expect(state.target).toBe(1);
  });

  it('a settle check while a press is still fresh does nothing', () => {
    const { moves } = replay(1, [{ at: 0, press: 3 }, { at: 100, settle: true }]);
    expect(moves).toEqual([3]);
  });

  it('a commit with no pending press (back button, deep link) moves the pill', () => {
    const { moves } = replay(0, [{ at: 0, commit: 3 }]);
    expect(moves).toEqual([3]);
  });

  it('a late commit is held only while the newer press is fresh', () => {
    const { state, moves } = replay(0, [
      { at: 0, press: 2 },
      { at: STALE_COMMIT_MS + 10, commit: 1 },
    ]);
    expect(moves).toEqual([2, 1]);
    expect(state.target).toBe(1);
  });
});
