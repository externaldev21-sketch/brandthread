/**
 * Community (topic group chat) types — mirrors api-server routes/communities.ts.
 * See lib/communities/useCommunityClient.ts for how screens talk to it.
 */

export type CommunityKind = 'official' | 'user';
export type CommunityVisibility = 'public' | 'private';
export type CommunityRole = 'owner' | 'admin' | 'member';

export interface Community {
  id: string;
  name: string;
  slug: string;
  description: string;
  /** Feather icon name — official communities render a monochrome icon tile. */
  iconKey?: string;
  iconUrl?: string;
  coverUrl?: string;
  kind: CommunityKind;
  /** Official Brandthread communities only → small verified mark. */
  verified: boolean;
  visibility: CommunityVisibility;
  requireApproval: boolean;
  memberCount: number;
  joined: boolean;
  role: CommunityRole | null;
  muted: boolean;
  /** head seq − my read cursor (derived on the server; no per-member unread rows). */
  unreadCount: number;
  lastMessage?: string;
  lastMessageSenderName?: string;
  lastMessageTs?: number;
  createdAt: string;
}

export interface CommunityReaction {
  userId: string;
  reactionType: string;
  createdAt: string;
}

export interface CommunityAttachment {
  type: 'image';
  url: string;
  uri?: string;
  width?: number;
  height?: number;
}

/** Shaped like the DM message so the existing chat bubbles can render it. */
export interface CommunityMessage {
  id: string;
  communityId: string;
  seq: number;
  fromId: string;
  fromName: string;
  fromHandle: string;
  fromInitials: string;
  fromColor: string;
  fromAvatarUrl?: string;
  /** 'seller' | 'buyer' — show a role badge next to the name. */
  fromAccountType?: string;
  /** 'owner' | 'admin' | 'member' in THIS community. */
  fromMemberRole?: string;
  text: string;
  attachments: CommunityAttachment[];
  replyToId?: string;
  replyPreview?: string;
  replyToAuthorName?: string;
  reactions: CommunityReaction[];
  ts: number;
}

export interface CommunityMember {
  userId: string;
  name: string;
  handle: string;
  initials: string;
  avatarUrl?: string;
  accountType?: string;
  role: CommunityRole;
  joinedAt: string;
}

export interface CommunityJoinRequest {
  userId: string;
  name: string;
  handle: string;
  initials: string;
  avatarUrl?: string;
  requestedAt: string;
}

export interface CommunityInvitePreview {
  id: string;
  name: string;
  description: string;
  iconKey?: string;
  iconUrl?: string;
  coverUrl?: string;
  kind: CommunityKind;
  verified: boolean;
  visibility: CommunityVisibility;
  requireApproval: boolean;
  memberCount: number;
}

export type CommunityEvent =
  | { type: 'message.created'; message: CommunityMessage }
  | { type: 'message.deleted'; messageId: string }
  | { type: 'reaction.updated'; messageId: string; reactions: CommunityReaction[] }
  | { type: 'member.removed'; userId: string }
  | { type: 'community.deleted' };

export interface CommunityMessagesPage {
  messages: CommunityMessage[];
  hasMore: boolean;
  /** Pass as `before` to load the next older page. */
  nextBefore: number | null;
  lastSeq: number;
}

export interface CreateCommunityInput {
  name: string;
  description?: string;
  visibility: CommunityVisibility;
  requireApproval?: boolean;
  iconUrl?: string | null;
  coverUrl?: string | null;
}

export type UpdateCommunityInput = Partial<CreateCommunityInput>;

/** Thrown by the read-only (signed-out / fresh preview) client for any write. */
export class CommunityAuthRequiredError extends Error {
  constructor() {
    super('Sign in to join groups.');
    this.name = 'CommunityAuthRequiredError';
  }
}

/** Number shown next to a member count: 1,240 → "1.2K members". */
export function formatMemberCount(n: number): string {
  const label = n === 1 ? 'member' : 'members';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1).replace(/\.0$/, '')}M ${label}`;
  if (n >= 10_000) return `${Math.round(n / 1000)}K ${label}`;
  if (n >= 1_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}K ${label}`;
  return `${n} ${label}`;
}

/** Bold/badge counts in the tab bar ignore muted communities (their row still shows unread quietly). */
export function loudUnreadTotal(communities: Pick<Community, 'unreadCount' | 'muted'>[]): number {
  return communities.reduce((sum, c) => (c.muted ? sum : sum + c.unreadCount), 0);
}

export const COMMUNITY_REACTIONS = ['like', 'love', 'haha', 'wow', 'sad', 'fire'] as const;
