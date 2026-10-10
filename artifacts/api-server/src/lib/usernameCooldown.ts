/** @handle change cooldown (migration 117: users.username_changed_at). */
export const USERNAME_COOLDOWN_DAYS = 30;
export const USERNAME_COOLDOWN_MS = USERNAME_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;

/**
 * The next instant the handle may change, or null when a change is allowed
 * right now. A handle that was never changed through the profile screen
 * (`changedAt` null) is always free to change.
 */
export function usernameNextChangeAt(changedAt: Date | string | null | undefined, now: Date = new Date()): Date | null {
  if (!changedAt) return null;
  const changed = changedAt instanceof Date ? changedAt : new Date(changedAt);
  if (Number.isNaN(changed.getTime())) return null;
  const next = new Date(changed.getTime() + USERNAME_COOLDOWN_MS);
  return next.getTime() > now.getTime() ? next : null;
}

export type UsernameChangeDecision =
  | { kind: "unchanged" }
  | { kind: "blocked"; nextChangeAt: Date }
  | { kind: "allowed"; stamp: boolean };

/**
 * Decide what a requested username (already trimmed/lowercased; "" = clear)
 * means for a user whose current handle is `current`.
 * - same value: no-op, never counts as a change.
 * - clearing: always allowed; stamps the clock only when it is not already
 *   running, so clear-then-reset cannot dodge the cooldown.
 * - first-ever set or any other change: allowed unless the cooldown is running.
 */
export function decideUsernameChange(params: {
  current: string | null;
  requested: string;
  changedAt: Date | string | null | undefined;
  now?: Date;
}): UsernameChangeDecision {
  const now = params.now ?? new Date();
  const current = params.current?.toLowerCase() ?? "";
  if (params.requested === current) return { kind: "unchanged" };
  const next = usernameNextChangeAt(params.changedAt, now);
  if (params.requested === "") {
    return { kind: "allowed", stamp: current !== "" && !next };
  }
  if (next) return { kind: "blocked", nextChangeAt: next };
  return { kind: "allowed", stamp: true };
}
