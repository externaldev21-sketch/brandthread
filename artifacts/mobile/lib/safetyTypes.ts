/**
 * Client types for trust & safety and account-control endpoints. These mirror
 * the OpenAPI contract in lib/api-spec/openapi.yaml (tags: safety, moderation,
 * account).
 */

export type ReportTargetType =
  | 'post' | 'video' | 'live' | 'live_comment' | 'comment'
  | 'story' | 'product' | 'profile' | 'message';

export type ReportReasonId =
  | 'spam' | 'harassment' | 'nudity' | 'hate' | 'violence'
  | 'ip_counterfeit' | 'scam' | 'other';

export interface ProfileSummary {
  userId: string;
  name: string;
  handle: string;
  initials: string;
  avatarUrl: string | null;
  accountType: string | null;
  suspended: boolean;
  deleted: boolean;
}

export interface ThreadComment {
  id: string;
  postId: string;
  parentId: string | null;
  body: string;
  createdAt: string;
  author: ProfileSummary;
  likesCount: number;
  likedByMe: boolean;
  isMine: boolean;
  canDelete: boolean;
  /** Held by the content filter — visible only to its author until reviewed. */
  pendingReview: boolean;
  replies: ThreadComment[];
}

export interface CommentThread {
  comments: ThreadComment[];
  total: number;
  hiddenByMutedWords: number;
  commentsDisabled: boolean;
  canComment: boolean;
  nextCursor: string | null;
}

export interface CreatedComment {
  comment: ThreadComment;
  moderation: { status: 'visible' | 'held'; message?: string };
}

export interface ModerationQueueItem {
  id: string;
  status: 'pending' | 'reviewed' | 'actioned' | 'dismissed';
  source: 'user' | 'auto_filter';
  targetType: string;
  targetId: string;
  targetLabel: string | null;
  contentExcerpt: string | null;
  reason: string;
  note: string | null;
  createdAt: string;
  resolution: { action: string | null; note: string | null; resolvedAt: string | null } | null;
  owner: ProfileSummary | null;
  reporter: ProfileSummary | null;
  openReportsOnTarget: number;
  ownerPriorActions: number;
}

export interface ModerationQueue {
  items: ModerationQueueItem[];
  hasMore: boolean;
  summary: { open: number; heldByFilter: number; resolvedToday: number };
}

export type ModerationAction = 'dismiss' | 'remove_content' | 'suspend_user';

export interface BlockedAccount {
  userId: string;
  name: string;
  handle: string;
  initials: string;
  avatarUrl: string | null;
  accountType: string | null;
  color: string;
  blockedAt: string;
}

export interface MutedWord {
  phrase: string;
  createdAt: string;
}

export interface DeletionBlocker {
  code: string;
  title: string;
  detail: string;
  count: number;
  amountCents: number | null;
  actionRoute: string;
  actionLabel: string;
}

export interface AccountDeletionCheck {
  canDelete: boolean;
  accountType: string | null;
  blockers: DeletionBlocker[];
  willDelete: string[];
  willRetain: string[];
}

export interface AccountSession {
  id: string;
  current: boolean;
  status: string;
  device: string;
  browser: string | null;
  isMobile: boolean;
  location: string | null;
  ipAddress: string | null;
  lastActiveAt: string;
  createdAt: string;
}
