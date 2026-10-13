/**
 * "Saved by people you follow" on the product page (GET /api/buyer/saved/friends/:id).
 * The server only returns people the viewer follows whose saves are visible to
 * followers; this file only words the line.
 */
export interface FriendsSavedPerson {
  userId: string;
  name: string;
  handle: string;
  initials: string;
  avatarUrl: string | null;
}

export interface FriendsSaved {
  count: number;
  people: FriendsSavedPerson[];
}

/** One person is named; more read as a count. Null means show nothing. */
export function friendsSavedLabel(data: FriendsSaved | null | undefined): string | null {
  if (!data || data.count < 1) return null;
  if (data.count === 1) {
    const name = data.people[0]?.name?.trim();
    return name ? `${name} saved this` : '1 friend saved this';
  }
  return `${data.count} friends saved this`;
}
