/**
 * Everything the report pipeline needs to know about each reportable content
 * type: how to find it (and who is responsible for it), how a moderator
 * removes it, and how held content is released after review.
 *
 * Reporters never supply the owner or content snapshot — both are resolved
 * server-side so a report cannot be aimed at the wrong person.
 */
import { and, eq, or, sql } from "drizzle-orm";
import {
  db, messages, postComments, posts, products, stories, users,
} from "@workspace/db";
import type { ReportTargetType } from "./safety";

export const REPORT_TARGET_TYPES: readonly ReportTargetType[] = [
  "post", "video", "live", "live_comment", "comment", "story", "product", "profile", "message",
] as const;

export const REPORT_REASONS = [
  "spam", "harassment", "nudity", "hate", "violence", "ip_counterfeit", "scam", "other",
] as const;
export type ReportReason = typeof REPORT_REASONS[number];

/** Older clients sent free-form reason ids; map them onto the fixed set. */
const LEGACY_REASONS: Record<string, ReportReason> = {
  inappropriate: "nudity",
  sexual: "nudity",
  explicit: "nudity",
  bullying: "harassment",
  hate_speech: "hate",
  violent: "violence",
  self_harm: "violence",
  counterfeit: "ip_counterfeit",
  intellectual_property: "ip_counterfeit",
  ip: "ip_counterfeit",
  fraud: "scam",
  misleading: "scam",
  impersonation: "scam",
};

export function normalizeReportReason(raw: unknown): ReportReason | null {
  if (typeof raw !== "string") return null;
  const key = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if ((REPORT_REASONS as readonly string[]).includes(key)) return key as ReportReason;
  return LEGACY_REASONS[key] ?? null;
}

export function normalizeTargetType(raw: unknown): ReportTargetType | null {
  if (typeof raw !== "string") return null;
  if (raw === "seller" || raw === "user") return "profile";
  if (raw === "dm") return "message";
  return (REPORT_TARGET_TYPES as readonly string[]).includes(raw) ? raw as ReportTargetType : null;
}

export interface ResolvedTarget {
  targetId: string;
  ownerId: string | null;
  excerpt: string | null;
  label: string | null;
  mediaUrl?: string | null;
  /** For messages/comments: the parent container (conversation / post). */
  containerId?: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function clip(value: string | null | undefined, max = 600): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

async function rawFirstRow(query: ReturnType<typeof sql>): Promise<Record<string, unknown> | null> {
  try {
    const result = await db.execute(query);
    return ((result as any).rows?.[0] as Record<string, unknown> | undefined) ?? null;
  } catch {
    // Live shopping tables are provisioned with the live feature. When they
    // are absent there is nothing to report or moderate.
    return null;
  }
}

export async function resolveReportTarget(type: ReportTargetType, rawId: string): Promise<ResolvedTarget | null> {
  const id = rawId.trim();
  switch (type) {
    case "post":
    case "video": {
      if (!UUID_RE.test(id)) return null;
      const [row] = await db
        .select({ id: posts.id, userId: posts.userId, caption: posts.caption, mediaType: posts.mediaType, mediaUrl: posts.mediaUrl, thumbnailUrl: posts.thumbnailUrl })
        .from(posts).where(eq(posts.id, id)).limit(1);
      if (!row) return null;
      return {
        targetId: row.id,
        ownerId: row.userId,
        excerpt: clip(row.caption),
        label: row.mediaType === "video" ? "Video" : row.mediaType === "slideshow" ? "Slideshow" : "Post",
        mediaUrl: row.thumbnailUrl ?? (row.mediaType === "video" ? null : row.mediaUrl),
      };
    }
    case "comment": {
      if (!UUID_RE.test(id)) return null;
      const [row] = await db
        .select({ id: postComments.id, authorId: postComments.authorId, body: postComments.body, postId: postComments.postId })
        .from(postComments).where(eq(postComments.id, id)).limit(1);
      if (!row) return null;
      return { targetId: row.id, ownerId: row.authorId, excerpt: clip(row.body), label: "Comment", containerId: row.postId };
    }
    case "story": {
      if (!UUID_RE.test(id)) return null;
      const [row] = await db
        .select({ id: stories.id, authorId: stories.authorId, authorName: stories.authorName, media: stories.media })
        .from(stories).where(eq(stories.id, id)).limit(1);
      if (!row) return null;
      const media = Array.isArray(row.media) ? row.media as Array<{ uri?: string; url?: string }> : [];
      return {
        targetId: row.id,
        ownerId: row.authorId,
        excerpt: `Story by ${row.authorName}`,
        label: "Story",
        mediaUrl: media[0]?.uri ?? media[0]?.url ?? null,
      };
    }
    case "product": {
      if (!UUID_RE.test(id)) return null;
      const [row] = await db
        .select({ id: products.id, ownerId: products.ownerId, name: products.name, description: products.description, images: products.images })
        .from(products).where(eq(products.id, id)).limit(1);
      if (!row) return null;
      return {
        targetId: row.id,
        ownerId: row.ownerId,
        excerpt: clip([row.name, row.description].filter(Boolean).join(" — ")),
        label: row.name,
        mediaUrl: Array.isArray(row.images) ? row.images[0] ?? null : null,
      };
    }
    case "profile": {
      const [row] = await db
        .select({
          clerkId: users.clerkId, name: users.name, displayName: users.displayName, brandName: users.brandName,
          username: users.username, bio: users.bio, accountType: users.accountType,
          avatarUrl: users.avatarUrl, profileImageUrl: users.profileImageUrl,
        })
        .from(users)
        .where(UUID_RE.test(id) ? or(eq(users.clerkId, id), eq(users.id, id)) : eq(users.clerkId, id))
        .limit(1);
      if (!row) return null;
      const name = (row.accountType === "seller" ? row.brandName : null) || row.displayName || row.name;
      return {
        targetId: row.clerkId,
        ownerId: row.clerkId,
        excerpt: clip([row.username ? `@${row.username}` : null, row.bio].filter(Boolean).join(" · ")),
        label: name,
        mediaUrl: row.profileImageUrl ?? row.avatarUrl,
      };
    }
    case "message": {
      if (!UUID_RE.test(id)) return null;
      const [row] = await db
        .select({ id: messages.id, senderId: messages.senderId, body: messages.body, conversationId: messages.conversationId })
        .from(messages).where(eq(messages.id, id)).limit(1);
      if (!row) return null;
      return { targetId: row.id, ownerId: row.senderId, excerpt: clip(row.body), label: "Direct message", containerId: row.conversationId };
    }
    case "live": {
      if (!UUID_RE.test(id)) return null;
      const row = await rawFirstRow(sql`SELECT id, seller_id, title FROM live_streams WHERE id = ${id}::uuid LIMIT 1`);
      if (!row) return null;
      return { targetId: String(row.id), ownerId: String(row.seller_id), excerpt: clip(String(row.title ?? "")), label: "Live stream" };
    }
    case "live_comment": {
      if (!UUID_RE.test(id)) return null;
      const row = await rawFirstRow(sql`SELECT id, user_id, message, stream_id FROM live_comments WHERE id = ${id}::uuid LIMIT 1`);
      if (!row) return null;
      return {
        targetId: String(row.id), ownerId: String(row.user_id), excerpt: clip(String(row.message ?? "")),
        label: "Live chat message", containerId: String(row.stream_id),
      };
    }
  }
}

/**
 * Remove reported content. Removal is final for the content itself; the
 * report row keeps the excerpt as the audit record.
 */
export async function removeReportedContent(type: ReportTargetType, id: string, moderatorId: string): Promise<boolean> {
  const now = new Date();
  switch (type) {
    case "post":
    case "video": {
      const rows = await db.update(posts)
        .set({ moderationStatus: "removed", moderatedAt: now, updatedAt: now })
        .where(eq(posts.id, id)).returning({ id: posts.id });
      return rows.length > 0;
    }
    case "comment": {
      const rows = await db.update(postComments)
        .set({ moderationStatus: "removed", moderatedAt: now, moderatedBy: moderatorId, updatedAt: now })
        .where(eq(postComments.id, id)).returning({ id: postComments.id });
      return rows.length > 0;
    }
    case "story": {
      const rows = await db.delete(stories).where(eq(stories.id, id)).returning({ id: stories.id });
      return rows.length > 0;
    }
    case "product": {
      const rows = await db.update(products)
        .set({ status: "archived", deletedAt: now, recoverableUntil: null, removalKind: "moderation_removed", updatedAt: now })
        .where(eq(products.id, id)).returning({ id: products.id });
      return rows.length > 0;
    }
    case "profile": {
      // Removing a profile's content resets the public, member-authored fields.
      // Suspension is the separate action for removing the person.
      const rows = await db.update(users)
        .set({ bio: null, website: null, avatarUrl: null, profileImageUrl: null, updatedAt: now })
        .where(eq(users.clerkId, id)).returning({ id: users.id });
      return rows.length > 0;
    }
    case "message": {
      const rows = await db.update(messages)
        .set({ moderationStatus: "removed", deletedAt: now, deletedBy: moderatorId })
        .where(eq(messages.id, id)).returning({ id: messages.id });
      return rows.length > 0;
    }
    case "live": {
      try {
        await db.execute(sql`UPDATE live_streams SET status = 'ended', ended_at = now() WHERE id = ${id}::uuid`);
        return true;
      } catch {
        return false;
      }
    }
    case "live_comment": {
      try {
        await db.execute(sql`DELETE FROM live_comments WHERE id = ${id}::uuid`);
        return true;
      } catch {
        return false;
      }
    }
  }
}

/** Publish content the automatic filter held, after a moderator approves it. */
export async function releaseHeldContent(type: ReportTargetType, id: string, moderatorId: string): Promise<void> {
  const now = new Date();
  if (type === "comment") {
    await db.update(postComments)
      .set({ moderationStatus: "visible", moderatedAt: now, moderatedBy: moderatorId, updatedAt: now })
      .where(and(eq(postComments.id, id), eq(postComments.moderationStatus, "held")));
  } else if (type === "post" || type === "video") {
    await db.update(posts)
      .set({ moderationStatus: "visible", moderatedAt: now, updatedAt: now })
      .where(and(eq(posts.id, id), eq(posts.moderationStatus, "held")));
  }
}
