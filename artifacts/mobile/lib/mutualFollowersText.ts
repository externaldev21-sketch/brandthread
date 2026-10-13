/**
 * Instagram's profile-header "Followed by …" wording, split into segments so
 * the caller can bold the names:
 *   1 → "Followed by maya"
 *   2 → "Followed by maya and leo"
 *   3 → "Followed by maya, leo and 1 other"
 *   n → "Followed by maya, leo and n-2 others"
 * Shows at most two names; anyone beyond that is counted.
 */
export type MutualFollowerName = { username?: string | null; displayName?: string | null };
export type MutualTextSegment = { text: string; bold: boolean };

export function mutualFollowerLabel(user: MutualFollowerName): string {
  return (user.username || user.displayName || '').trim();
}

export function mutualFollowersSegments(users: MutualFollowerName[], count: number): MutualTextSegment[] {
  const names = users.map(mutualFollowerLabel).filter(Boolean).slice(0, 2);
  if (names.length === 0 || count <= 0) return [];
  const others = Math.max(0, count - names.length);
  const segments: MutualTextSegment[] = [{ text: 'Followed by ', bold: false }];
  names.forEach((name, index) => {
    if (index > 0) segments.push({ text: others > 0 ? ', ' : ' and ', bold: false });
    segments.push({ text: name, bold: true });
  });
  if (others > 0) segments.push({ text: ` and ${others} ${others === 1 ? 'other' : 'others'}`, bold: false });
  return segments;
}
