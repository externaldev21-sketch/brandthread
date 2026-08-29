/** Pure expiry model used by reversible destructive-action UI. */
export function undoExpiresAt(now: number, durationMs = 6000): number {
  return now + durationMs;
}
export function canUndoUntil(expiresAt: number, now: number): boolean {
  return now < expiresAt;
}