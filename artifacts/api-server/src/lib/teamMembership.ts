import { teamMembers } from "@workspace/db";
import { asc, desc } from "drizzle-orm";

/**
 * Select the active membership that represents the caller's current store.
 *
 * Newest acceptance wins. The owner and membership ids make ties deterministic
 * instead of relying on database row order.
 */
export function teamMembershipOrderBy() {
  return [
    desc(teamMembers.acceptedAt),
    asc(teamMembers.ownerId),
    asc(teamMembers.id),
  ] as const;
}