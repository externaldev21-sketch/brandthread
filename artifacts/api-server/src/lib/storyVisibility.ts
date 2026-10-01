import { and, eq, ne, or, type SQL } from "drizzle-orm";
import { stories } from "@workspace/db";

/**
 * A story is listed for `viewerId` when it is not removed and not held by
 * automatic media screening — held stories are visible to their author only.
 * Replaces `ne(stories.moderationStatus, "removed")` at every read site.
 */
export function storyListedFor(viewerId: string | null | undefined): SQL {
  const notRemoved = ne(stories.moderationStatus, "removed");
  const visible = viewerId
    ? or(eq(stories.moderationStatus, "visible"), eq(stories.authorId, viewerId))
    : eq(stories.moderationStatus, "visible");
  return and(notRemoved, visible) as SQL;
}
