/**
 * Brandthread Social Types
 * All typed models for: profiles, posts, friendships, messaging,
 * stories, notifications, blocking, reporting, saved content, privacy.
 */

// ─── Account & Feed Eligibility ───────────────────────────────────────────────

export type AccountType = 'buyer' | 'seller';

/**
 * feedEligibility is stored EXPLICITLY on every post/repost.
 * NEVER infer from screen location. Buyers are always 'profile_only'.
 */
export type FeedEligibility = 'thread_eligible' | 'profile_only';
export type ProfileVisibility = 'public' | 'private';

// ─── Buyer Social Profile ─────────────────────────────────────────────────────

export interface BuyerSocialProfile {
  id: string;
  userId: string;
  accountType: 'buyer';
  name: string;
  username: string;
  pronouns: string;
  bio: string;
  website: string;
  location: string;
  avatarColor: string;
  avatarInitials: string;
  profileVisibility: ProfileVisibility;
  postsCount: number;
  friendsCount: number;
  savedCount: number;
  followingBrandsCount: number;
  createdAt: string;
}

// ─── Buyer Post ───────────────────────────────────────────────────────────────

export type BuyerPostType = 'photo' | 'slideshow' | 'video';
export type BuyerPostVisibility = 'public' | 'friends_only';

export interface BuyerPost {
  id: string;
  authorId: string;
  authorName: string;
  authorHandle: string;
  authorInitials: string;
  authorColor: string;
  authorAccountType: 'buyer';        // Always 'buyer'
  feedEligibility: 'profile_only';   // Always 'profile_only' — never enters Thread
  profileVisibility: BuyerPostVisibility;
  type: BuyerPostType;
  caption: string;
  hashtags: string[];
  mediaColors: string[];             // Demo gradient colors (real URIs in production)
  likesCount: number;
  commentsCount: number;
  repostsCount: number;
  likedByMe: boolean;
  savedByMe: boolean;
  repostedByMe: boolean;
  isArchived: boolean;
  isDraft: boolean;
  createdAt: string;
  updatedAt: string;
}

// ─── Repost Record ────────────────────────────────────────────────────────────

export interface RepostRecord {
  id: string;
  reposterId: string;
  originalPostId: string;
  originalAuthorId: string;
  originalAuthorName: string;
  originalAuthorHandle: string;
  originalCaption: string;
  feedEligibility: FeedEligibility;  // Inherited — buyer reposts stay 'profile_only'
  createdAt: string;
}

// ─── Friendship ───────────────────────────────────────────────────────────────

export type FriendshipStatus =
  | 'pending_sent'
  | 'pending_received'
  | 'accepted'
  | 'blocked'
  | 'declined'
  | 'cancelled';

export interface Friendship {
  id: string;
  userId: string;
  name: string;
  handle: string;
  initials: string;
  color: string;
  status: FriendshipStatus;
  mutualFriendsCount: number;
  lastSeenAt?: string;
  updatedAt: string;
}

export interface FriendRequest {
  id: string;
  fromId: string;
  fromName: string;
  fromHandle: string;
  fromInitials: string;
  fromColor: string;
  toId: string;
  status: 'pending' | 'accepted' | 'declined' | 'cancelled';
  mutualFriends: number;
  createdAt: string;
}

export interface FriendSuggestion {
  id: string;
  userId: string;
  name: string;
  handle: string;
  initials: string;
  color: string;
  reason: string;      // e.g. "3 mutual friends"
  mutualCount: number;
}

// ─── Conversation & Messaging ─────────────────────────────────────────────────

export type ConversationType =
  | 'buyer_to_buyer'
  | 'buyer_to_seller'
  | 'buyer_to_seller_product'
  | 'buyer_to_seller_order';

export interface ConversationParticipant {
  userId: string;
  name: string;
  handle: string;
  initials: string;
  color: string;
  accountType: AccountType;
}

export type MessageAttachmentType =
  | 'image' | 'video' | 'voice'
  | 'product' | 'post' | 'order' | 'profile';

export interface MessageAttachment {
  type: MessageAttachmentType;
  uri?: string;
  title?: string;
  subtitle?: string;
  accentColor?: string;
  meta?: Record<string, string>;
}

export type MessageStatus = 'sending' | 'sent' | 'delivered' | 'failed';

export interface MessageReaction {
  emoji: string;
  fromId: string;
  fromName: string;
}

export interface Message {
  id: string;
  conversationId: string;
  fromId: string;          // 'me' for own messages
  fromName: string;
  fromInitials: string;
  fromColor: string;
  text: string;
  attachment?: MessageAttachment;
  replyToId?: string;
  replyPreview?: string;
  reactions: MessageReaction[];
  status: MessageStatus;   // delivered/read only shown with backend confirmation
  ts: number;              // Unix ms
  deletedForMe: boolean;
}

export interface Conversation {
  id: string;
  type: ConversationType;
  participants: ConversationParticipant[];
  lastMessage?: string;
  lastMessageTs?: number;
  unreadCount: number;
  isFriendshipActive: boolean;  // buyer_to_buyer: false = new messages disabled
  isArchived: boolean;
  isRequest: boolean;
  contextOrderId?: string;
  contextOrderNumber?: string;
  contextOrderStatus?: string;
  contextProductId?: string;
  contextProductName?: string;
  contextSellerName?: string;
  updatedAt: string;
}

// ─── Story ────────────────────────────────────────────────────────────────────

export type StoryMediaType = 'photo' | 'video' | 'text';
export type StoryReplyPermission = 'everyone' | 'friends' | 'off';

/** Overlay placed on top of a story slide (link, gif, positioned text) */
export interface StoryOverlay {
  id: string;
  type: 'link' | 'gif' | 'text';
  x: number;
  y: number;
  // link fields
  linkUrl?: string;
  linkText?: string;
  // gif fields
  gifUrl?: string;
  gifW?: number;
  gifH?: number;
  // positioned text fields (from advanced editor)
  text?: string;
  color?: string;
  size?: number;
}

export interface StoryMedia {
  id: string;
  type: StoryMediaType;
  backgroundColor: string;
  textContent?: string;
  textColor?: string;
  duration: number;          // seconds
  productTagId?: string;     // Seller only
  productTagName?: string;
  imageUri?: string;         // local URI (photo) or remote URL (after upload)
  overlays?: StoryOverlay[]; // links, GIFs, and positioned text overlays
}

export interface StoryPrivacySettings {
  visibility: 'public' | 'friends';
  replyPermission: StoryReplyPermission;
  hiddenFromUserIds: string[];
  closeFriendsOnly: boolean;
}

export interface StoryViewer {
  userId: string;
  name: string;
  handle: string;
  viewedAt: number;
}

export interface Story {
  id: string;
  authorId: string;
  authorName: string;
  authorHandle: string;
  authorInitials: string;
  authorColor: string;
  authorAccountType: AccountType;
  media: StoryMedia[];
  privacy: StoryPrivacySettings;
  viewers: StoryViewer[];
  repliesDisabled: boolean;
  createdAt: number;         // Unix ms
  expiresAt: number;         // createdAt + 24h
}

// ─── Notifications ────────────────────────────────────────────────────────────

export type NotificationCategory =
  | 'social' | 'orders' | 'messages'
  | 'seller_updates' | 'products' | 'marketing' | 'system';

export type NotificationType =
  | 'friend_request' | 'friend_accepted' | 'post_like' | 'post_comment'
  | 'repost' | 'mention' | 'story_reaction' | 'story_reply' | 'new_follower'
  | 'order_confirmed' | 'order_processing' | 'order_production'
  | 'order_shipped' | 'order_delivered' | 'order_delay'
  | 'return_update' | 'refund_update' | 'dispute_update'
  | 'product_restocked' | 'drop_live' | 'preorder_closing'
  | 'price_drop' | 'saved_product_update'
  | 'new_friend_message' | 'new_seller_reply' | 'new_order_message' | 'message_request'
  | 'system' | 'marketing';

export interface Notification {
  id: string;
  category: NotificationCategory;
  type: NotificationType;
  title: string;
  body: string;
  isRead: boolean;
  isMuted: boolean;
  actorName?: string;
  actorHandle?: string;
  actorInitials?: string;
  actorColor?: string;
  targetId?: string;
  targetType?: string;
  cta?: string;
  createdAt: string;
}

export interface NotificationPreference {
  category: NotificationCategory;
  push: boolean;
  email: boolean;
  sms: boolean;
  inApp: boolean;
}

// ─── Blocking & Muting ────────────────────────────────────────────────────────

export interface BlockRecord {
  id: string;
  blockedUserId: string;
  blockedUserName: string;
  blockedUserHandle: string;
  blockedUserInitials: string;
  blockedUserColor: string;
  createdAt: string;
}

export interface MuteRecord {
  id: string;
  mutedUserId: string;
  mutedUserName: string;
  mutedUserHandle: string;
  mutedUserInitials: string;
  mutedUserColor: string;
  createdAt: string;
}

export interface RestrictRecord {
  id: string;
  restrictedUserId: string;
  restrictedUserName: string;
  restrictedUserHandle: string;
  restrictedUserInitials: string;
  restrictedUserColor: string;
  createdAt: string;
}

// ─── Reporting ────────────────────────────────────────────────────────────────

export type ReportTargetType = 'profile' | 'post' | 'story' | 'message' | 'seller' | 'product';

export type ReportReason =
  | 'spam' | 'harassment' | 'hate_or_abuse' | 'scam'
  | 'impersonation' | 'inappropriate_content'
  | 'intellectual_property' | 'dangerous_product' | 'other';

export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  spam: 'Spam',
  harassment: 'Harassment',
  hate_or_abuse: 'Hate or abuse',
  scam: 'Scam',
  impersonation: 'Impersonation',
  inappropriate_content: 'Inappropriate content',
  intellectual_property: 'Intellectual property',
  dangerous_product: 'Dangerous product',
  other: 'Other',
};

export interface Report {
  id: string;
  targetType: ReportTargetType;
  targetId: string;
  targetLabel?: string;
  reason: ReportReason;
  description: string;
  blockAfterReport: boolean;
  submittedAt: string;
}

// ─── Saved Content ────────────────────────────────────────────────────────────

export type SavedItemType = 'post' | 'product' | 'collection' | 'store';

export interface SavedItem {
  id: string;
  type: SavedItemType;
  targetId: string;
  title: string;
  subtitle?: string;
  accentColor?: string;
  savedAt: string;
}

// ─── Privacy Settings ─────────────────────────────────────────────────────────

export type AudienceOption = 'everyone' | 'friends' | 'nobody' | 'only_me' | 'friends_of_friends';

/** Controls who can send DMs to this user.
 *  Enforced server-side at POST /api/conversations.
 *  'requests'      — non-followers go to Requests inbox (default)
 *  'followers_only'— only people the user follows can message them at all
 */
export type DmPrivacy = 'requests' | 'followers_only';

export interface PrivacySettings {
  profileVisibility: ProfileVisibility;
  whoCanSendFriendRequests: AudienceOption;
  whoCanSeePosts: AudienceOption;
  whoCanSeeFriendsList: AudienceOption;
  whoCanReplyToStories: AudienceOption;
  whoCanMention: AudienceOption;
  activityStatusVisible: boolean;
  readReceiptsEnabled: boolean;
  searchable: boolean;
  contactDiscovery: boolean;
  /** Server-side DM privacy — loaded from and saved to /api/auth/privacy */
  whoCanMessageMe: DmPrivacy;
}

export const DEFAULT_PRIVACY_SETTINGS: PrivacySettings = {
  profileVisibility: 'public',
  whoCanSendFriendRequests: 'everyone',
  whoCanSeePosts: 'everyone',
  whoCanSeeFriendsList: 'friends',
  whoCanReplyToStories: 'everyone',
  whoCanMention: 'everyone',
  activityStatusVisible: true,
  readReceiptsEnabled: true,
  searchable: true,
  contactDiscovery: false,
  whoCanMessageMe: 'requests',
};

export const DEFAULT_NOTIFICATION_PREFS: NotificationPreference[] = [
  { category: 'social',         push: true,  email: false, sms: false, inApp: true },
  { category: 'orders',         push: true,  email: true,  sms: true,  inApp: true },
  { category: 'messages',       push: true,  email: false, sms: false, inApp: true },
  { category: 'seller_updates', push: true,  email: false, sms: false, inApp: true },
  { category: 'products',       push: true,  email: false, sms: false, inApp: true },
  { category: 'marketing',      push: false, email: false, sms: false, inApp: false },
  { category: 'system',         push: true,  email: true,  sms: false, inApp: true },
];

// ─── Comments ────────────────────────────────────────────────────────────────

export interface Comment {
  id: string;
  postId: string;
  authorId: string;
  authorName: string;
  authorHandle: string;
  authorInitials: string;
  authorColor: string;
  text: string;
  /** id of the comment being replied to (one level deep) */
  replyToId?: string;
  /** display name of the person being replied to */
  replyToAuthorName?: string;
  /** short preview of the parent comment text */
  replyToText?: string;
  likedByMe: boolean;
  likesCount: number;
  createdAt: string;
}

// ─── Search ───────────────────────────────────────────────────────────────────

export interface ProfileSearchResult {
  id: string;
  userId: string;
  name: string;
  handle: string;
  initials: string;
  color: string;
  accountType: AccountType;
  profileVisibility: ProfileVisibility;
  mutualFriendsCount: number;
  isBlocked: boolean;
  friendshipStatus?: FriendshipStatus;
}
