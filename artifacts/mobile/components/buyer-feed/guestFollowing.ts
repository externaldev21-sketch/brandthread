/** Guests have no follow graph: Following resolves to an empty result locally instead of calling the protected feed endpoint (no 401 / sign-in modal). */
export function isGuestFollowing(tab: string, userId: string | null | undefined): boolean {
  return tab === 'following' && !userId;
}
