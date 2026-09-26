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
  mediaUrl?: string;
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
  /** Optional live-presence flag. Not populated by the current backend —
   *  UI reading this field must treat it as absent/false when undefined. */
  isOnline?: boolean;
  /** Optional last-seen timestamp (ISO), for future presence UI. */
  lastSeenAt?: string;
  /** Optional avatar image URL. Not populated by the current backend for
   *  ordinary users (they render an initials circle) — used today only by
   *  the seeded dev/preview inbox (see lib/previewInbox.ts), which reuses
   *  bundled preview poster images as stand-in avatars. UI reading this
   *  field must fall back to the initials circle when it's absent. */
  avatarUri?: string;
}

export type MessageAttachmentType =
  | 'image' | 'video' | 'voice'
  | 'product' | 'post' | 'order' | 'profile' | 'thread_cash'
  // Brandthread Agent only. `agent_card` is a generic deep-linking card
  // (Thread Cash explainer, product, brand/profile, "Go to Discover" — see
  // meta.cardKind / meta.deepLink); `quick_replies` renders a row of tappable
  // reply chips (meta.optionsJson: JSON-encoded {label,value}[]).
  | 'agent_card' | 'quick_replies';

export interface MessageAttachment {
  type: MessageAttachmentType;
  uri?: string;
  title?: string;
  subtitle?: string;
  accentColor?: string;
  meta?: Record<string, string>;
}

export type MessageStatus = 'sending' | 'sent' | 'delivered' | 'read' | 'failed';

/** Small fixed reaction bar (no free-form emoji picker). One of REACTION_TYPES. */
export type ReactionType = 'like' | 'love' | 'haha' | 'wow' | 'sad' | 'fire';

export interface MessageReaction {
  /** The reaction chosen — `emoji` is a legacy name kept for existing call sites;
   *  its value is always one of ReactionType, not a free-form emoji string. */
  emoji: string;
  fromId: string;
  fromName: string;
  /** Same value as `emoji`, explicitly typed. */
  reactionType?: ReactionType;
  createdAt?: string;
  /** The API's own field names (see `GET/POST /api/conversations/:id/messages`).
   *  Present on reactions that came straight from the server; local/optimistic
   *  reactions use `fromId`/`fromName`/`emoji` instead. Readers should fall
   *  back through both naming schemes. */
  userId?: string;
  userName?: string;
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
  /** ISO timestamp the recipient's device received the message, when known. */
  deliveredAt?: string;
  /** ISO timestamp the recipient read the message, when known — drives the
   *  double-check "read" receipt. */
  readAt?: string;
  ts: number;              // Unix ms
  deletedForMe: boolean;
}

export interface Conversation {
  id: string;
  type: ConversationType;
  participants: ConversationParticipant[];
  lastMessage?: string;
  lastMessageTs?: number;
  /** Optional id of who sent the last message ('me'/MY_USER_ID for the buyer).
   *  Not populated by the current backend — UI must treat undefined as unknown. */
  lastMessageSenderId?: string;
  /** Optional attachment kind of the last message, for a non-text preview icon. */
  lastMessageType?: MessageAttachmentType;
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
  /** Placeholder extension point for the official "Brandthread Agent" AI
   *  friend account (pinned welcome thread), which is being wired up to a
   *  real backend in a separate change. Not populated by the current
   *  backend/API — only set by the seeded dev/preview inbox today (see
   *  lib/previewInbox.ts). `isPinned` conversations should render above the
   *  rest of the list; `isOfficial` marks the row for a verified badge + a
   *  small "AI" tag instead of an ordinary avatar/initials treatment. */
  isPinned?: boolean;
  isOfficial?: boolean;
  /** True while the Brandthread Agent is generating a reply in this
   *  conversation — polled via GET /api/conversations/:id (no websocket
   *  layer exists for DMs yet). Only ever set for the agent's conversation. */
  agentTyping?: boolean;
}

// ─── Story ────────────────────────────────────────────────────────────────────

export type StoryMediaType = 'photo' | 'video' | 'text';
export type StoryReplyPermission = 'everyone' | 'friends' | 'off';

/** Overlay placed on top of a story slide (link, gif, positioned text, or a sticker). */
export type StoryOverlayType =
  | 'link' | 'gif' | 'text'
  | 'mention' | 'location' | 'time' | 'poll' | 'question'
  | 'product' | 'shop' | 'threadcash';

export interface StoryPollOption {
  label: string;
  votes: number;
}

export interface StoryOverlay {
  id: string;
  type: StoryOverlayType;
  x: number;
  y: number;
  /** Rotation in degrees, applied around the overlay's center. Defaults to 0. */
  rotation?: number;
  /** Uniform scale factor applied on top of `size`/`fontSize`. Defaults to 1. */
  scale?: number;
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
  align?: 'left' | 'center' | 'right';
  // mention sticker
  mentionHandle?: string;
  // location sticker
  locationLabel?: string;
  // question sticker (answers are not yet persisted server-side — UI-only)
  questionPrompt?: string;
  // poll sticker (results are not yet persisted server-side — UI-only)
  pollQuestion?: string;
  pollOptions?: StoryPollOption[];
  // product-tag sticker (sellers, or buyers tagging a saved product)
  productId?: string;
  productName?: string;
  productImageUri?: string;
  productPriceCents?: number;
  // shop-link sticker (sellers)
  shopUrl?: string;
  shopLabel?: string;
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
  | 'order_shipped' | 'order_delivered' | 'order_cancelled' | 'order_delay'
  | 'order_out_for_delivery' | 'order_exception' | 'order_returned_to_sender'
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
  /** Board this item is filed into, if any. */
  collectionId?: string;
  notifyOnPriceDrop?: boolean;
  // ── Live badge data (product items only) ────────────────────────────────
  image?: string;
  brand?: string;
  /** Current lowest variant price, in cents. */
  priceCents?: number;
  /** The price this was saved at — shown struck through when priceDropped. */
  oldPriceCents?: number;
  priceDropped?: boolean;
  inStock?: boolean;
  lowStock?: boolean;
  soldOut?: boolean;
  backInStock?: boolean;
}

// ─── Saved Collections (boards) ────────────────────────────────────────────────

export interface SavedCollection {
  id: string;
  name: string;
  coverImageUrl?: string | null;
  isPublic: boolean;
  sortOrder: number;
  itemCount: number;
  createdAt: string;
  updatedAt: string;
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
