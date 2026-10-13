/**
 * Who may be put on a Close Friends list (pure rules, no I/O).
 *
 * Everyone: people in my follow graph (they follow me, or I follow them).
 * Sellers additionally: their top buyers — anyone with a paid, non-cancelled
 * order from this seller — even when that buyer doesn't follow them. The
 * paid-order relation is the proof, so it's enforced server-side and a
 * client can't add an arbitrary stranger by claiming they're a customer.
 *
 * Never: myself, anyone blocked either way, a deleted or suspended account.
 */

export interface CloseFriendCandidateProfile {
  deleted: boolean;
  suspended: boolean;
}

export interface CloseFriendRuleInput {
  myId: string;
  requested: readonly string[];
  /** ids that follow me or that I follow */
  followGraph: ReadonlySet<string>;
  /** ids with a paid, non-cancelled order where I am the seller */
  paidBuyers: ReadonlySet<string>;
  /** blocked either way */
  blocked: ReadonlySet<string>;
  profiles: ReadonlyMap<string, CloseFriendCandidateProfile>;
}

export function allowedCloseFriendIds(input: CloseFriendRuleInput): string[] {
  const { myId, requested, followGraph, paidBuyers, blocked, profiles } = input;
  return requested.filter((id) => {
    if (id === myId || blocked.has(id)) return false;
    const p = profiles.get(id);
    if (!p || p.deleted || p.suspended) return false;
    return followGraph.has(id) || paidBuyers.has(id);
  });
}

/** Seller accounts get top-buyer suggestions (dual accounts sell too). */
export function isSellerAccountType(accountType: string | null | undefined): boolean {
  return accountType === "seller" || accountType === "both";
}

export const SUGGESTIONS_DEFAULT_LIMIT = 25;
export const SUGGESTIONS_MAX_LIMIT = 50;

export function parseSuggestionsLimit(raw: unknown): number {
  const n = typeof raw === "string" ? parseInt(raw, 10) : NaN;
  if (!Number.isFinite(n) || n <= 0) return SUGGESTIONS_DEFAULT_LIMIT;
  return Math.min(n, SUGGESTIONS_MAX_LIMIT);
}

/**
 * The close-friends PUT body has historically been sent two ways: the
 * close-friends router's `{ userIds }` and the mobile `api.closeFriends`
 * client's `{ friendIds }`. Accept either; `userIds` wins when both exist.
 */
export function closeFriendIdsFromBody(body: unknown): unknown {
  const b = (body ?? {}) as { userIds?: unknown; friendIds?: unknown };
  return b.userIds !== undefined ? b.userIds : b.friendIds;
}
