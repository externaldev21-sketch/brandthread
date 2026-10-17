/**
 * Hold-to-switch on the tab bar's Profile button — the pure rules, kept free
 * of React Native/Clerk so they can be unit-tested directly.
 *
 * Holding the button draws a ring around it; when the ring closes the app
 * switches to the person's other signed-in account (Instagram's
 * double-tap-the-avatar switch, as a hold). A quick tap still opens Profile;
 * letting go after that but before the ring closes cancels.
 */

/** A press shorter than this is a plain tap: open Profile, no ring. */
export const HOLD_TAP_MAX_MS = 150;
/** The ring starts drawing (with its light haptic) exactly when a press
 *  stops counting as a tap, so a normal tap never flashes a sliver of it or
 *  buzzes. */
export const HOLD_RING_DELAY_MS = HOLD_TAP_MAX_MS;
/** Time for the ring to draw all the way around. */
export const HOLD_RING_DRAW_MS = 480;
/** Press duration at which the switch fires. */
export const HOLD_SWITCH_MS = HOLD_RING_DELAY_MS + HOLD_RING_DRAW_MS;
/** How fast an unfinished ring retracts on early release. */
export const HOLD_RING_RETRACT_MS = 140;

export type HoldOutcome = 'tap' | 'cancel' | 'switch';

/** What a release after `heldMs` means. `completed` is the ring's own
 *  completion (the UI-thread animation finished), which wins over the
 *  clock: the switch fires exactly when the ring visibly closes. */
export function holdOutcome(heldMs: number, completed: boolean): HoldOutcome {
  if (completed) return 'switch';
  if (heldMs < HOLD_TAP_MAX_MS) return 'tap';
  return 'cancel';
}

export interface SwitchableAccount {
  id: string;
  /** Last time this account was the active one (ms since epoch, or a Date). */
  lastActiveAt?: number | Date | null;
}

const time = (value: SwitchableAccount['lastActiveAt']) => (
  value instanceof Date ? value.getTime() : typeof value === 'number' ? value : 0
);

/**
 * The account a completed hold switches to: the most recently used account
 * other than the current one. With two accounts that toggles between them;
 * with three or more, each hold goes back to whichever one was used last,
 * the same way Instagram's quick switch does. Ties keep list order. Null
 * when there is no other account (the caller opens the switcher instead).
 */
export function pickNextAccount<T extends SwitchableAccount>(accounts: readonly T[], currentId: string | null | undefined): T | null {
  let best: T | null = null;
  for (const account of accounts) {
    if (account.id === currentId) continue;
    if (!best || time(account.lastActiveAt) > time(best.lastActiveAt)) best = account;
  }
  return best;
}
