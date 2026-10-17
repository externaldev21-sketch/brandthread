/**
 * Retarget rules for the tab bar's sliding pill (the "bubble") under rapid
 * tapping — kept pure so they can be unit-tested without Reanimated.
 *
 * A press moves the pill right away, on touch-down, before the navigator has
 * committed the new route. When taps come faster than navigation commits
 * (5+ taps a second, a busy JS thread), the commits arrive late and in order:
 * tap Discover, tap Inbox, *then* the Discover commit lands. Treating that
 * late commit as "the pill should be on Discover" is what dragged the pill
 * back to an older tab mid-burst and then forward again.
 *
 * So a commit that disagrees with a recent press is held as stale. It only
 * wins once no newer press arrives for `STALE_COMMIT_MS`; that covers a press
 * that never became a navigation (finger slid off, tabPress prevented). The
 * final resting position is always the last committed route.
 */
export const STALE_COMMIT_MS = 450;

export type PillRetargetState = {
  /** Last slot the pill was sent to (press or commit). */
  target: number;
  /** Most recent press that the navigator hasn't confirmed yet. */
  pending: { index: number; at: number } | null;
  /** Last slot the navigator actually committed. */
  committed: number;
};

export function initialPillState(committed: number): PillRetargetState {
  return { target: committed, pending: null, committed };
}

/** A press on `index`. Returns the next state and the slot to move to, or
 *  null when the pill is already heading there (duplicate tap). */
export function pillPress(state: PillRetargetState, index: number, now: number): { state: PillRetargetState; moveTo: number | null } {
  const moveTo = state.target === index ? null : index;
  return { state: { ...state, target: index, pending: { index, at: now } }, moveTo };
}

/** The navigator committed `index`. A commit that disagrees with a press
 *  younger than STALE_COMMIT_MS is a late commit from an earlier tap in the
 *  burst and is held; anything else moves the pill to the committed slot. */
export function pillCommit(state: PillRetargetState, index: number, now: number): { state: PillRetargetState; moveTo: number | null } {
  const { pending } = state;
  if (pending && pending.index !== index && now - pending.at < STALE_COMMIT_MS) {
    return { state: { ...state, committed: index }, moveTo: null };
  }
  const moveTo = state.target === index ? null : index;
  return { state: { target: index, pending: null, committed: index }, moveTo };
}

/** Runs STALE_COMMIT_MS after the last press: if the navigator never
 *  confirmed it, the pill returns to the last committed slot. */
export function pillSettle(state: PillRetargetState, now: number): { state: PillRetargetState; moveTo: number | null } {
  const { pending } = state;
  if (!pending || now - pending.at < STALE_COMMIT_MS) return { state, moveTo: null };
  const moveTo = state.target === state.committed ? null : state.committed;
  return { state: { ...state, target: state.committed, pending: null }, moveTo };
}
