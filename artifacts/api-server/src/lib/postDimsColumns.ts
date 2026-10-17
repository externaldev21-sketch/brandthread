/** Drizzle select fragment for the post media dimension columns (see lib/mediaDimensions). */
import { posts } from "@workspace/db";

export const postDimsColumns = {
  mediaWidth: posts.mediaWidth,
  mediaHeight: posts.mediaHeight,
  thumbnailWidth: posts.thumbnailWidth,
  thumbnailHeight: posts.thumbnailHeight,
  mediaDimensions: posts.mediaDimensions,
} as const;
