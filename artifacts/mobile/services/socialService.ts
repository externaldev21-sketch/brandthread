/**
 * Brandthread Social Service
 * All social features backed by AsyncStorage with in-memory caching.
 * API-backed social data with user-scoped local preferences and drafts.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { serviceRequest } from '@/lib/serviceConfig';
import type {
  BuyerSocialProfile, BuyerPost, RepostRecord,
  Friendship, FriendshipStatus, FriendRequest, FriendSuggestion,
  Conversation, ConversationType, ConversationParticipant,
  Message, MessageAttachment, MessageReaction,
  Story, StoryMedia, StoryPrivacySettings, StoryViewer,
  Notification, NotificationCategory, NotificationPreference,
  BlockRecord, MuteRecord, RestrictRecord,
  SavedItem, SavedItemType, SavedCollection, PrivacySettings, ProfileSearchResult,
  Comment,
} from './socialTypes';
import { DEFAULT_PRIVACY_SETTINGS, DEFAULT_NOTIFICATION_PREFS } from './socialTypes';

// ─── Keys (scoped by user ID so two accounts never share storage) ─────────────

/** Set by initSocialService() after sign-in. Falls back to 'anon' so the
 *  service is safe to call before the user ID is available. */
let _socialUserId = 'anon';

/** Call once after Clerk resolves the current user ID (and again on sign-out
 *  with null to reset to 'anon'). */
export function initSocialService(userId: string | null): void {
  _socialUserId = userId ?? 'anon';
  if (userId) {
    const keys = K(userId);
    AsyncStorage.getItem(keys.seeded).then((wasSeeded) => {
      if (wasSeeded !== 'true') return;
      return AsyncStorage.multiRemove([
        keys.seeded, keys.friendships, keys.requests, keys.conversations,
        keys.stories, keys.notifications, keys.saved, keys.posts, keys.reposts,
        keys.friendLikes,
      ]);
    }).catch(() => {});
  }
}

/**
 * Returns a snapshot of AsyncStorage keys scoped to the given user ID.
 * Each exported function captures its own snapshot at entry (before any await)
 * so that a mid-flight userId change cannot corrupt another user's data.
 */
function K(uid = _socialUserId) {
  return {
    /** Baked-in user ID — compare against _socialUserId after awaits to detect account switches. */
    userId:             uid,
    profile:            `bt:social:${uid}:profile:v1`,
    posts:              `bt:social:${uid}:posts:v1`,
    reposts:            `bt:social:${uid}:reposts:v1`,
    friendships:        `bt:social:${uid}:friendships:v1`,
    requests:           `bt:social:${uid}:requests:v1`,
    conversations:      `bt:social:${uid}:convs:v1`,
    messages:           (id: string) => `bt:social:${uid}:msgs:${id}:v1`,
    comments:           (postId: string) => `bt:social:${uid}:comments:${postId}:v1`,
    stories:            `bt:social:${uid}:stories:v1`,
    notifications:      `bt:social:${uid}:notifs:v1`,
    notifPrefs:         `bt:social:${uid}:notif_prefs:v1`,
    blocks:             `bt:social:${uid}:blocks:v1`,
    mutes:              `bt:social:${uid}:mutes:v1`,
    restricts:          `bt:social:${uid}:restricts:v1`,
    saved:              `bt:social:${uid}:saved:v1`,
    privacy:            `bt:social:${uid}:privacy:v1`,
    seeded:             `bt:social:${uid}:seeded:v1`,
    friendLikes:        `bt:social:${uid}:friend-likes:v1`,
    sellerPosts:        `bt:social:${uid}:seller-posts:v1`,
    sellerPostsSeeded:  `bt:social:${uid}:seller-posts:seeded:v1`,
    closeFriends:       `bt:close-friends:${uid}:v1`,
  };
}
/** Keys snapshot type — passed through the call chain so inner helpers
 *  never re-resolve _socialUserId in async continuations. */
type SocialKeys = ReturnType<typeof K>;

/** Capture immutable storage keys for a specific authenticated account before
 * starting an async operation that may outlive the current Clerk session. */
export function socialKeysForUser(userId: string): SocialKeys {
  return K(userId);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

let _uidCounter = 0;
function uid(): string {
  return `${Date.now()}_${++_uidCounter}_${Math.random().toString(36).slice(2, 7)}`;
}
function iso(): string { return new Date().toISOString(); }
function getMessagePreview(text: string, attachment?: MessageAttachment): string {
  return attachment?.title?.trim() || (attachment ? 'Attachment' : text);
}

export const MY_USER_ID = 'me';
export const MY_NAME    = 'Jordan';
export const MY_HANDLE  = '@jordan';
export const MY_INITIALS = 'J';
export const MY_COLOR    = '#8B5CF6';

// ─── Pub/Sub ─────────────────────────────────────────────────────────────────

type Listener = () => void;
const listeners = new Set<Listener>();
export function subscribeSocial(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function notify() { listeners.forEach(fn => fn()); }

// ─── AsyncStorage helpers ─────────────────────────────────────────────────────

async function load<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch { return fallback; }
}
async function save(key: string, value: unknown): Promise<void> {
  try { await AsyncStorage.setItem(key, JSON.stringify(value)); } catch {}
}


const H24 = 24 * 3600 * 1000;

// ─── Cache invalidation ───────────────────────────────────────────────────────

/**
 * Clear all social AsyncStorage keys for the given user (defaults to current).
 * Scanned by prefix so message/comment keys are also removed.
 * Pass an explicit userId when calling during sign-out to avoid a race between
 * this function and initSocialService(null) resetting _socialUserId to 'anon'.
 */
export async function clearSocialCache(userId?: string): Promise<void> {
  const u = userId ?? _socialUserId;
  try {
    const allKeys = await AsyncStorage.getAllKeys();
    const socialPrefix = `bt:social:${u}:`;
    const cfPrefix     = `bt:close-friends:${u}:`;
    const toRemove = (allKeys as string[]).filter(
      k => k.startsWith(socialPrefix) || k.startsWith(cfPrefix),
    );
    if (toRemove.length > 0) await AsyncStorage.multiRemove(toRemove);
  } catch {}
  notify();
}

// ─── Profile ──────────────────────────────────────────────────────────────────

function emptyProfile(userId: string): BuyerSocialProfile {
  return {
    id: userId, userId, accountType: 'buyer',
    name: '', username: '', pronouns: '', bio: '', website: '', location: '',
    avatarColor: MY_COLOR, avatarInitials: '',
    profileVisibility: 'public', postsCount: 0, friendsCount: 0, savedCount: 0,
    followingBrandsCount: 0, createdAt: iso(),
  };
}

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  return parts.length === 1
    ? parts[0].slice(0, 2).toUpperCase()
    : `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export async function getMyProfile(k: SocialKeys = K()): Promise<BuyerSocialProfile> {
  return load(k.profile, emptyProfile(k.userId));
}
export async function updateMyProfile(updates: Partial<BuyerSocialProfile>, k: SocialKeys = K()): Promise<BuyerSocialProfile> {
  const current = await getMyProfile(k);
  const next = { ...current, ...updates };
  await save(k.profile, next);
  notify();
  return next;
}

/** Hydrate the local buyer surface from the provisioned authenticated account.
 * This profile is intentionally user-scoped and never receives demo identity
 * values. It also repairs old locally seeded "Jordan" profiles on first sign-in. */
export async function hydrateMyProfileFromAccount(
  identity: { userId: string; name: string; username?: string | null; bio?: string | null },
  k: SocialKeys = K(),
): Promise<BuyerSocialProfile> {
  if (identity.userId !== k.userId) {
    throw new Error('Cannot hydrate a profile into another user’s storage');
  }
  const current = await getMyProfile(k);
  const name = identity.name.trim();
  const username = identity.username?.trim().replace(/^@/, '') ?? '';
  const isLegacyDemo = current.name === MY_NAME && current.username === 'jordan';
  const next: BuyerSocialProfile = {
    ...current,
    id: k.userId,
    userId: identity.userId,
    name: name || (isLegacyDemo ? '' : current.name),
    username: username || (isLegacyDemo ? '' : current.username),
    bio: identity.bio?.trim() || (isLegacyDemo ? '' : current.bio),
    avatarInitials: name ? initialsFor(name) : (isLegacyDemo ? '' : current.avatarInitials),
  };
  await save(k.profile, next);
  notify();
  return next;
}

// ─── Posts ────────────────────────────────────────────────────────────────────

export async function getMyPosts(k: SocialKeys = K()): Promise<BuyerPost[]> {
  if (k.userId === 'anon') return [];
  const remote = await serviceRequest<BuyerPost[]>(
    `/api/social/profile/${encodeURIComponent(k.userId)}/posts`,
  );
  return Array.isArray(remote) ? remote : [];
}
export async function createPost(params: {
  type: BuyerPost['type'];
  caption: string;
  hashtags: string[];
  mediaColors: string[];
  profileVisibility: BuyerPost['profileVisibility'];
  isDraft?: boolean;
}): Promise<BuyerPost> {
  throw new Error('Buyer post publishing is not available yet.');
}
export async function updatePost(id: string, updates: Partial<Pick<BuyerPost, 'caption' | 'hashtags' | 'profileVisibility' | 'isDraft'>>, k: SocialKeys = K()): Promise<BuyerPost | null> {
  const posts = await getMyPosts(k);
  const idx = posts.findIndex(p => p.id === id);
  if (idx < 0) return null;
  const updated = { ...posts[idx], ...updates, updatedAt: iso() };
  posts[idx] = updated;
  await save(k.posts, posts);
  notify();
  return updated;
}
export async function deletePost(id: string): Promise<void> {
  const k = K();
  const posts = await getMyPosts(k);
  await save(k.posts, posts.filter(p => p.id !== id));
  const p = await getMyProfile(k);
  await updateMyProfile({ postsCount: Math.max(0, p.postsCount - 1) }, k);
  notify();
}
export async function archivePost(id: string): Promise<void> {
  const k = K();
  await updatePost(id, {}, k);
  const posts = await getMyPosts(k);
  const idx = posts.findIndex(p => p.id === id);
  if (idx >= 0) { posts[idx].isArchived = true; await save(k.posts, posts); notify(); }
}
export async function unarchivePost(id: string): Promise<void> {
  const k = K();
  const posts = await getMyPosts(k);
  const idx = posts.findIndex(p => p.id === id);
  if (idx >= 0) { posts[idx].isArchived = false; await save(k.posts, posts); notify(); }
}
export async function likePost(id: string): Promise<void> {
  const k = K();
  const posts = await getMyPosts(k);
  const idx = posts.findIndex(p => p.id === id);
  if (idx >= 0) {
    posts[idx].likedByMe = !posts[idx].likedByMe;
    posts[idx].likesCount += posts[idx].likedByMe ? 1 : -1;
    await save(k.posts, posts); notify();
  }
}

// ─── Friend-post engagement (likes persisted independently of K().posts) ─────────

type FriendLikeState = { likedByMe: boolean; likesCount: number };

export async function getFriendPostEngagements(k: SocialKeys = K()): Promise<Record<string, FriendLikeState>> {
  return load<Record<string, FriendLikeState>>(k.friendLikes, {});
}

export async function likeFriendPost(
  postId: string,
  baseLikesCount: number,
  baseLikedByMe: boolean,
): Promise<FriendLikeState> {
  const k = K();
  const all = await getFriendPostEngagements(k);
  const cur = all[postId] ?? { likedByMe: baseLikedByMe, likesCount: baseLikesCount };
  const next: FriendLikeState = {
    likedByMe: !cur.likedByMe,
    likesCount: cur.likedByMe ? cur.likesCount - 1 : cur.likesCount + 1,
  };
  all[postId] = next;
  await save(k.friendLikes, all);
  notify();
  return next;
}
type FriendPostMeta = { authorId: string; authorName: string; authorHandle: string; caption: string };

export async function repostPost(id: string, friendMeta?: FriendPostMeta): Promise<void> {
  const k = K();
  const posts = await getMyPosts(k);
  const idx = posts.findIndex(p => p.id === id);
  const reposts = await load<RepostRecord[]>(k.reposts, []);
  let willRepost = false;

  if (idx >= 0) {
    // Own post — toggle repostedByMe flag in the posts store
    posts[idx].repostedByMe = !posts[idx].repostedByMe;
    willRepost = posts[idx].repostedByMe;
    posts[idx].repostsCount += posts[idx].repostedByMe ? 1 : -1;
    await save(k.posts, posts);
    if (posts[idx].repostedByMe) {
      reposts.unshift({ id: uid(), reposterId: k.userId, originalPostId: id, originalAuthorId: posts[idx].authorId, originalAuthorName: posts[idx].authorName, originalAuthorHandle: posts[idx].authorHandle, originalCaption: posts[idx].caption, feedEligibility: 'profile_only', createdAt: iso() });
    } else {
      const filtered = reposts.filter(r => !(r.originalPostId === id && r.reposterId === k.userId));
      reposts.length = 0; reposts.push(...filtered);
    }
  } else {
    // Friend post — not in myPosts; determine state from existing RepostRecord
    const existing = reposts.findIndex(r => r.originalPostId === id && r.reposterId === k.userId);
    if (existing >= 0) {
      // Currently reposted → unrepost: remove the record
      reposts.splice(existing, 1);
    } else if (friendMeta) {
      // Not yet reposted → repost: create a new record using provided metadata
      reposts.unshift({ id: uid(), reposterId: k.userId, originalPostId: id, originalAuthorId: friendMeta.authorId, originalAuthorName: friendMeta.authorName, originalAuthorHandle: friendMeta.authorHandle, originalCaption: friendMeta.caption, feedEligibility: 'profile_only', createdAt: iso() });
      willRepost = true;
    }
  }
  await save(k.reposts, reposts);
  notify();

  // Fire-and-forget: log repost interaction to DB for real posts
  try {
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    if (isUUID) {
      serviceRequest('/api/posts/' + id + '/interact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'repost', value: willRepost ? undefined : 'remove' }),
      }).catch(() => {});
    }
  } catch {
    // ignore errors so local state is always preserved
  }
}

/** Returns a Set of post IDs that the current user has reposted (persisted). */
export async function getRepostedPostIds(k: SocialKeys = K()): Promise<Set<string>> {
  const reposts = await load<RepostRecord[]>(k.reposts, []);
  return new Set(reposts.filter(r => r.reposterId === k.userId).map(r => r.originalPostId));
}
export async function getMyReposts(k: SocialKeys = K()): Promise<RepostRecord[]> {
  return load<RepostRecord[]>(k.reposts, []);
}

// ─── Comments ────────────────────────────────────────────────────────────────
// Comments live on the server, where they are filtered, block-aware and
// moderated (see /api/posts/:postId/comments). These helpers adapt the server
// thread to the flat Comment shape older screens render.

interface ServerComment {
  id: string; postId: string; parentId: string | null; body: string; createdAt: string;
  author: { userId: string; name: string; handle: string; initials: string };
  likesCount: number; likedByMe: boolean; pendingReview: boolean; replies: ServerComment[];
}

function toLegacyComment(comment: ServerComment, parent?: ServerComment): Comment {
  return {
    id: comment.id,
    postId: comment.postId,
    authorId: comment.author.userId,
    authorName: comment.author.name,
    authorHandle: comment.author.handle,
    authorInitials: comment.author.initials,
    authorColor: '#27272A',
    text: comment.body,
    replyToId: parent?.id,
    replyToAuthorName: parent?.author.name,
    replyToText: parent?.body.slice(0, 60),
    likedByMe: comment.likedByMe,
    likesCount: comment.likesCount,
    createdAt: comment.createdAt,
  };
}

export async function getComments(postId: string): Promise<Comment[]> {
  const thread = await serviceRequest<{ comments: ServerComment[] }>(
    `/api/posts/${encodeURIComponent(postId)}/comments`,
  );
  return (thread.comments ?? []).flatMap((root) => [
    toLegacyComment(root),
    ...(root.replies ?? []).map((reply) => toLegacyComment(reply, root)),
  ]);
}

export async function postComment(params: {
  postId: string;
  text: string;
  replyToId?: string;
}): Promise<Comment> {
  const created = await serviceRequest<{ comment: ServerComment }>(
    `/api/posts/${encodeURIComponent(params.postId)}/comments`,
    { method: 'POST', body: JSON.stringify({ body: params.text, parentId: params.replyToId ?? null }) },
  );
  notify();
  return toLegacyComment(created.comment);
}

export async function likeComment(postId: string, commentId: string, liked: boolean): Promise<void> {
  await serviceRequest(
    `/api/posts/${encodeURIComponent(postId)}/comments/${encodeURIComponent(commentId)}/like`,
    { method: 'POST', body: JSON.stringify({ liked }) },
  );
}

export async function deleteComment(postId: string, commentId: string): Promise<void> {
  await serviceRequest(
    `/api/posts/${encodeURIComponent(postId)}/comments/${encodeURIComponent(commentId)}`,
    { method: 'DELETE' },
  );
  notify();
}

// ─── Seller posts (Thread-eligible) ──────────────────────────────────────────

// Keys are now part of K() — user-scoped — no global constants needed.

export interface SellerPostProductTag {
  productId:   string;
  productName: string;
  priceCents:  number;
  imageUri?:   string;
  variantId?:  string;
  slideIndex?: number;
  timestamp?:  number;
}

export interface SellerPostSound {
  soundId:    string;
  soundTitle: string;
  artist:     string;
  startTime:  number;
  volume:     number;
}

export interface SellerThreadPost {
  id:                string;
  authorId:          string;
  authorAccountType: 'seller';
  authorName:        string;
  authorHandle:      string;
  authorInitials:    string;
  authorColor:       string;
  sellerId:          string;
  brandId:           string;
  feedEligibility:   'thread_eligible';
  caption:           string;
  hashtags:          string[];
  styleTags?:        string[];
  mediaUris:         string[];
  thumbnailUri?:     string;
  aspectRatio:       '9:16' | '3:4' | '1:1';
  contentType:       string;
  postStatus:        'draft' | 'scheduled' | 'published' | 'archived' | 'deleted';
  isDraft:           boolean;
  isArchived:        boolean;
  isDeleted:         boolean;
  sound?:            SellerPostSound;
  productTags:       SellerPostProductTag[];
  visibility:        { isPublic?: boolean; allowComments: boolean; allowReposts: boolean; showLikeCount: boolean };
  scheduledAt:       string | null;
  publishedAt?:      string;
  createdAt:         string;
  updatedAt:         string;
  likesCount:        number;
  commentsCount:     number;
  repostsCount:      number;
  savedCount:        number;
  likedByMe:         boolean;
  savedByMe:         boolean;
  repostedByMe:      boolean;
  /** Server-authorized mutual buyer friends who reposted this post (newest first). */
  friendReposts:     Array<{
    userId: string;
    displayName: string;
    avatarUrl: string | null;
    createdAt: string;
  }>;
  /** Ordered object storage paths for composed slideshow slides (empty for video/photo posts) */
  mediaPaths?:       string[];
  /** Per-slide overlay metadata — used to restore draft editors */
  slideOverlays?:    Array<{
    slideIndex: number;
    overlays: Array<{
      id: string; text: string; x: number; y: number;
      color: string; fontStyle: string; align: string;
      bgStyle: string; fontSize: number;
    }>;
  }>;
}

async function ensureSellerPostsSeed(k: SocialKeys = K()): Promise<void> {
  await AsyncStorage.removeItem(k.sellerPostsSeeded);
}

// ─── CRUD ──────────────────────────────────────────────────────────────────────

function mapOwnedApiPost(p: any, userId: string): SellerThreadPost {
  const now = iso();
  const status = (['draft', 'scheduled', 'published', 'archived', 'deleted'].includes(p.postStatus)
    ? p.postStatus
    : 'published') as SellerThreadPost['postStatus'];
  const authorName = p.seller?.brandName ?? p.seller?.displayName ?? 'Seller';
  // Derive canonical mediaUris: prefer mediaPaths-derived mediaUrls for slideshows, then mediaUrls, then mediaUrl
  const apiMediaUris: string[] = Array.isArray(p.mediaUrls) && p.mediaUrls.length > 0
    ? p.mediaUrls
    : Array.isArray(p.mediaUris) && p.mediaUris.length > 0
      ? p.mediaUris
      : (p.mediaUrl ? [p.mediaUrl] : []);
  return {
    id:              p.id,
    authorId:        p.userId ?? userId,
    authorAccountType: 'seller',
    authorName,
    authorHandle:    '@' + authorName.toLowerCase().replace(/[^a-z0-9]/g, ''),
    authorInitials:  authorName.slice(0, 2).toUpperCase(),
    authorColor:     '#8B5CF6',
    sellerId:        p.userId ?? userId,
    brandId:         p.userId ?? userId,
    feedEligibility: 'thread_eligible',
    caption:         p.caption ?? '',
    hashtags:        Array.isArray(p.hashtags) ? p.hashtags : [],
    styleTags:       Array.isArray(p.styleTags) ? p.styleTags : [],
    mediaUris:       apiMediaUris,
    thumbnailUri:    p.thumbnailUrl ?? p.thumbnailUri ?? undefined,
    aspectRatio:     p.aspectRatio ?? '9:16',
    contentType:     p.mediaType ?? p.contentType ?? 'video',
    postStatus:      status,
    isDraft:         status === 'draft',
    isArchived:      status === 'archived',
    isDeleted:       status === 'deleted',
    sound:           p.sound ?? undefined,
    productTags:     (Array.isArray(p.taggedProducts) ? p.taggedProducts : p.productTags ?? []).map((tag: any) => ({
      productId: tag.productId,
      productName: tag.productName ?? tag.name ?? 'Product',
      priceCents: typeof tag.priceCents === 'number' ? tag.priceCents : 0,
      imageUri: Array.isArray(tag.images) ? tag.images[0] : tag.imageUri,
      variantId: tag.variantId,
      slideIndex: tag.slideIndex,
      timestamp: tag.timestamp,
    })),
    visibility:      p.visibility ?? { allowComments: true, allowReposts: true, showLikeCount: true },
    scheduledAt:     p.scheduledAt ?? null,
    publishedAt:     p.publishedAt ?? (status === 'published' ? p.createdAt ?? now : undefined),
    createdAt:       p.createdAt ?? now,
    updatedAt:       p.updatedAt ?? p.createdAt ?? now,
    likesCount:      p.likesCount ?? 0,
    commentsCount:   p.commentsCount ?? 0,
    repostsCount:    p.repostsCount ?? 0,
    savedCount:      p.savedCount ?? 0,
    likedByMe:       false,
    savedByMe:       false,
    repostedByMe:    false,
    friendReposts:   [],
    // Slideshow persistence fields
    mediaPaths:      Array.isArray(p.mediaPaths) && p.mediaPaths.length > 0 ? p.mediaPaths : undefined,
    slideOverlays:   Array.isArray(p.slideOverlays) && p.slideOverlays.length > 0 ? p.slideOverlays : undefined,
  };
}

export async function createSellerPost(params: {
  contentType: string;
  caption: string;
  hashtags: string[];
  /** Curated style-taxonomy tags (from StyleTagsPicker). Stored separately from freeform hashtags. */
  styleTags?: string[];
  mediaUris?: string[];
  /** Stable composed media URL returned by the video composition endpoint. */
  mediaUrl?: string;
  mediaPath?: string;
  thumbnailPath?: string;
  thumbnailUri?: string;
  aspectRatio?: '9:16' | '3:4' | '1:1';
  productTags?: SellerPostProductTag[];
  /** @deprecated use productTags instead */
  productTagIds?: string[];
  sound?: SellerPostSound | null;
  visibility?: { allowComments: boolean; allowReposts: boolean; showLikeCount: boolean };
  isDraft?: boolean;
  scheduledAt?: string | null;
  /** Ordered object storage paths for slideshow slides */
  mediaPaths?: string[];
  /** Per-slide overlay metadata */
  slideOverlays?: Array<{ slideIndex: number; overlays: any[] }>;
}): Promise<SellerThreadPost> {
  const k = K();
  const created = await serviceRequest<any>('/api/posts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      mediaUrl: params.mediaUrl ?? params.mediaUris?.[0],
      thumbnailUrl: params.thumbnailUri,
      mediaPath: params.mediaPath,
      thumbnailPath: params.thumbnailPath,
      mediaUrls: params.mediaUris ?? [],
      mediaPaths: params.mediaPaths ?? [],
      slideOverlays: params.slideOverlays ?? [],
      mediaType: params.contentType,
      aspectRatio: params.aspectRatio ?? '9:16',
      caption: params.caption,
      hashtags: params.hashtags,
      styleTags: params.styleTags ?? [],
      sound: params.sound ?? null,
      visibility: params.visibility,
      taggedProductIds: (params.productTags ?? [])
        .map(t => t.productId)
        .filter(id => /^[0-9a-f-]{36}$/i.test(id)),
      isDraft: params.isDraft === true,
      scheduledAt: params.isDraft ? null : (params.scheduledAt ?? null),
    }),
  });

  const existing = await load<SellerThreadPost[]>(k.sellerPosts, []);
  const post = {
    ...mapOwnedApiPost(created, k.userId),
    mediaUris: Array.isArray(created.mediaUrls) && created.mediaUrls.length > 0
      ? created.mediaUrls
      : (created.mediaUrl ? [created.mediaUrl] : params.mediaUris ?? []),
    thumbnailUri: created.thumbnailUrl ?? params.thumbnailUri,
    aspectRatio: params.aspectRatio ?? '9:16',
    styleTags: params.styleTags ?? [],
    sound: params.sound ?? undefined,
    productTags: params.productTags ?? [],
    visibility: params.visibility ?? { allowComments: true, allowReposts: true, showLikeCount: true },
    mediaPaths: params.mediaPaths,
    slideOverlays: params.slideOverlays,
  };
  if (_socialUserId === k.userId) await save(k.sellerPosts, [post, ...existing.filter(p => p.id !== post.id)]);
  notify();
  return post;
}

export async function updateSellerPost(
  id: string,
  patch: Partial<Pick<SellerThreadPost,
    'caption' | 'hashtags' | 'styleTags' | 'mediaUris' | 'thumbnailUri' | 'aspectRatio' |
    'contentType' | 'postStatus' | 'isDraft' | 'isArchived' | 'isDeleted' |
    'sound' | 'productTags' | 'visibility' | 'scheduledAt' | 'publishedAt'
  >>,
): Promise<SellerThreadPost> {
  const k = K();
  const updated = await serviceRequest<any>(`/api/posts/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({
      mediaUrl: patch.mediaUris?.[0],
      mediaUrls: patch.mediaUris,
      mediaType: patch.contentType,
      aspectRatio: patch.aspectRatio,
      caption: patch.caption,
      hashtags: patch.hashtags,
      styleTags: patch.styleTags,
      sound: patch.sound,
      visibility: patch.visibility,
      taggedProductIds: patch.productTags?.map(tag => tag.productId),
      isDraft: patch.isDraft,
      postStatus: patch.postStatus,
      scheduledAt: patch.scheduledAt,
    }),
  });
  const canonical = mapOwnedApiPost(updated, k.userId);
  const posts = await load<SellerThreadPost[]>(k.sellerPosts, []);
  const idx = posts.findIndex(p => p.id === id);
  const merged = {
    ...(idx >= 0 ? posts[idx] : canonical),
    ...canonical,
    mediaUris: patch.mediaUris ?? canonical.mediaUris,
    productTags: patch.productTags ?? canonical.productTags,
    aspectRatio: patch.aspectRatio ?? canonical.aspectRatio,
    styleTags: patch.styleTags ?? canonical.styleTags,
    sound: patch.sound ?? (idx >= 0 ? posts[idx].sound : canonical.sound),
    visibility: patch.visibility ?? (idx >= 0 ? posts[idx].visibility : canonical.visibility),
    thumbnailUri: patch.thumbnailUri ?? (idx >= 0 ? posts[idx].thumbnailUri : canonical.thumbnailUri),
  };
  if (idx >= 0) posts[idx] = merged;
  else posts.unshift(merged);
  if (_socialUserId === k.userId) await save(k.sellerPosts, posts);
  notify();
  return merged;
}

export async function archiveSellerPost(id: string): Promise<void> {
  await updateSellerPost(id, { isArchived: true, postStatus: 'archived' });
}

export async function deleteSellerPost(id: string): Promise<void> {
  const k = K();
  await serviceRequest(`/api/posts/${encodeURIComponent(id)}`, { method: 'DELETE' });
  const posts = await load<SellerThreadPost[]>(k.sellerPosts, []);
  if (_socialUserId === k.userId) await save(k.sellerPosts, posts.filter(post => post.id !== id));
  notify();
}

export async function likeSellerPost(id: string): Promise<void> {
  const k = K();
  const posts = await load<SellerThreadPost[]>(k.sellerPosts, []);
  const idx = posts.findIndex(p => p.id === id);
  if (idx < 0) return;
  const liked = !posts[idx].likedByMe;
  posts[idx] = { ...posts[idx], likedByMe: liked, likesCount: posts[idx].likesCount + (liked ? 1 : -1), updatedAt: iso() };
  await save(k.sellerPosts, posts);
  notify();
}

export async function saveSellerPost(id: string): Promise<void> {
  const k = K();
  const posts = await load<SellerThreadPost[]>(k.sellerPosts, []);
  const idx = posts.findIndex(p => p.id === id);
  if (idx < 0) return;
  const saved = !posts[idx].savedByMe;
  posts[idx] = { ...posts[idx], savedByMe: saved, savedCount: posts[idx].savedCount + (saved ? 1 : -1), updatedAt: iso() };
  await save(k.sellerPosts, posts);
  notify();
}

export async function getSellerPosts(): Promise<SellerThreadPost[]> {
  const k = K();
  if (k.userId === 'anon') return [];

  const apiPosts = await serviceRequest<any[]>('/api/posts/mine');
  const mapped = (Array.isArray(apiPosts) ? apiPosts : []).map(post => mapOwnedApiPost(post, k.userId));
  if (_socialUserId === k.userId) await save(k.sellerPosts, mapped);
  return mapped;
}

/** Maps a raw API post object from /api/posts/feed to a SellerThreadPost. */
function mapApiPostToSellerThreadPost(p: any, idx: number): SellerThreadPost {
  const ACCENT_POOL = ['#7C3AED','#0F766E','#BE185D','#B45309','#1D4ED8','#0891B2','#059669'];
  const now = iso();
  const authorName     = p.seller?.brandName ?? p.seller?.displayName ?? 'Seller';
  const authorHandle   = '@' + authorName.toLowerCase().replace(/[^a-z0-9]/g, '');
  const authorInitials = authorName.slice(0, 2).toUpperCase();
  const authorColor    = ACCENT_POOL[idx % ACCENT_POOL.length];
  return {
    id:                p.id,
    authorId:          p.userId,
    authorAccountType: 'seller' as const,
    authorName,
    authorHandle,
    authorInitials,
    authorColor,
    sellerId:          p.userId,
    brandId:           p.userId,
    feedEligibility:   'thread_eligible' as const,
    caption:           p.caption   ?? '',
    hashtags:          p.hashtags ?? [],
    styleTags:         p.styleTags ?? [],
    mediaUris:         Array.isArray(p.mediaUrls) && p.mediaUrls.length > 0 ? p.mediaUrls : (p.mediaUrl ? [p.mediaUrl] : []),
    thumbnailUri:      p.thumbnailUrl ?? p.thumbnailUri ?? undefined,
    aspectRatio:       (p.aspectRatio ?? '9:16') as SellerThreadPost['aspectRatio'],
    contentType:       (p.mediaType ?? 'video') as SellerThreadPost['contentType'],
    postStatus:        'published' as const,
    isDraft:           false,
    isArchived:        false,
    isDeleted:         false,
    sound:             p.sound ?? undefined,
    productTags:       (p.taggedProducts ?? []).map((t: any) => ({
      productId:   t.productId,
      productName: t.name ?? '',
      priceCents: typeof t.priceCents === 'number' ? t.priceCents : 0,
      imageUri: Array.isArray(t.images) ? t.images[0] : t.imageUri,
    })),
    visibility:    p.visibility ?? { allowComments: true, allowReposts: true, showLikeCount: true },
    scheduledAt:   null,
    publishedAt:   p.createdAt ?? now,
    createdAt:     p.createdAt ?? now,
    updatedAt:     p.createdAt ?? now,
    likesCount:    p.likesCount    ?? 0,
    commentsCount: p.commentsCount ?? 0,
    repostsCount:  p.repostsCount  ?? 0,
    savedCount:    0,
    likedByMe:     false,
    savedByMe:     false,
    repostedByMe:  p.repostedByMe === true,
    friendReposts: Array.isArray(p.friendReposts)
      ? p.friendReposts.slice(0, 5).flatMap((reposter: any) => {
          if (!reposter || typeof reposter.userId !== 'string') return [];
          return [{
            userId: reposter.userId,
            displayName: typeof reposter.displayName === 'string' && reposter.displayName.trim()
              ? reposter.displayName.trim()
              : 'Friend',
            avatarUrl: typeof reposter.avatarUrl === 'string' && reposter.avatarUrl.trim()
              ? reposter.avatarUrl
              : null,
            createdAt: typeof reposter.createdAt === 'string'
              ? reposter.createdAt
              : now,
          }];
        })
      : [],
  };
}

export interface ThreadFeedCursor {
  followedOffset: number;
  generalOffset: number;
  followedDone: boolean;
  generalDone: boolean;
  seenPostIds: string[];
}
export type ThreadFeedMode = 'following' | 'for-you' | 'mixed';

export interface SellerFollowState {
  isFollowing: boolean;
  followersCount?: number;
}

export async function getSellerFollowState(sellerId: string): Promise<SellerFollowState> {
  return serviceRequest<SellerFollowState>(
    `/api/social/status/${encodeURIComponent(sellerId)}`,
  );
}

export async function setSellerFollowing(
  sellerId: string,
  following: boolean,
): Promise<SellerFollowState> {
  return serviceRequest<SellerFollowState>(
    following
      ? '/api/social/follow'
      : `/api/social/follow/${encodeURIComponent(sellerId)}`,
    following
      ? { method: 'POST', body: JSON.stringify({ userId: sellerId }) }
      : { method: 'DELETE' },
  );
}

/** Backwards-compatible one-shot page loader for non-paginated callers. */
export async function getThreadPosts(offset = 0, limit = 30): Promise<SellerThreadPost[]> {
  const cursor = createThreadFeedCursor();
  cursor.followedOffset = Number.isFinite(offset) ? Math.max(0, Math.floor(offset)) : 0;
  cursor.generalOffset = cursor.followedOffset;
  return (await getThreadPostsPage(cursor, limit)).posts;
}

// ─── Friendships ──────────────────────────────────────────────────────────────

export async function getFriendships(k: SocialKeys = K()): Promise<Friendship[]> {
  return load<Friendship[]>(k.friendships, []);
}
export async function getAcceptedFriends(k: SocialKeys = K()): Promise<Friendship[]> {
  const all = await getFriendships(k);
  return all.filter(f => f.status === 'accepted');
}
export async function getFriendRequests(k: SocialKeys = K()): Promise<FriendRequest[]> {
  return load<FriendRequest[]>(k.requests, []);
}
export async function getFriendSuggestions(): Promise<FriendSuggestion[]> {
  return Promise.resolve([]);
}
export async function isFriend(userId: string): Promise<boolean> {
  const k = K();
  const friends = await getFriendships(k);
  return friends.some(f => f.userId === userId && f.status === 'accepted');
}
export async function canMessage(userId: string): Promise<boolean> {
  // Buyer-to-buyer requires accepted friendship
  const k = K();
  const friends = await getFriendships(k);
  const entry = friends.find(f => f.userId === userId);
  return entry?.status === 'accepted';
}

/**
 * Returns true if userId is in the current user's Close Friends list.
 * The list is stored locally under bt:close-friends:v1 and managed in
 * the buyer-close-friends screen. Use this to gate Close Friends-only
 * content visibility when displaying posts from other users.
 */
export async function isCloseFriendOf(userId: string): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(K().closeFriends);
    if (!raw) return false;
    const ids: string[] = JSON.parse(raw);
    return Array.isArray(ids) && ids.includes(userId);
  } catch { return false; }
}

/** Load close-friends IDs for the current user (buyer-close-friends screen). */
export async function getCloseFriendIds(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(K().closeFriends);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch { return []; }
}

/** Persist close-friends IDs for the current user (buyer-close-friends screen). */
export async function saveCloseFriendIds(ids: string[]): Promise<void> {
  await AsyncStorage.setItem(K().closeFriends, JSON.stringify(ids));
}
export async function sendFriendRequest(params: { userId: string; name: string; handle: string; initials: string; color: string; }): Promise<{ success: boolean; message: string; request?: FriendRequest }> {
  const k = K();
  if (params.userId === k.userId) return { success: false, message: 'You cannot send a request to yourself.' };
  const blocks = await getBlockedUsers(k);
  if (blocks.some(b => b.blockedUserId === params.userId)) return { success: false, message: 'Cannot send request to this user.' };
  const existing = await getFriendships(k);
  if (existing.some(f => f.userId === params.userId)) return { success: false, message: 'Already connected or pending.' };
  await serviceRequest('/api/social/follow', {
    method: 'POST', body: JSON.stringify({ userId: params.userId }),
  });
  notify();
  return { success: true, message: 'Followed.' };
}
export async function acceptFriendRequest(requestId: string): Promise<void> {
  const k = K();
  const requests = await getFriendRequests(k);
  const req = requests.find(r => r.id === requestId);
  if (!req) return;
  const updated = requests.map(r => r.id === requestId ? { ...r, status: 'accepted' as const } : r);
  await save(k.requests, updated);
  const friendships = await getFriendships(k);
  const existing = friendships.findIndex(f => f.userId === req.fromId);
  if (existing >= 0) {
    friendships[existing] = { ...friendships[existing], status: 'accepted', updatedAt: iso() };
  } else {
    friendships.push({ id: uid(), userId: req.fromId, name: req.fromName, handle: req.fromHandle, initials: req.fromInitials, color: req.fromColor, status: 'accepted', mutualFriendsCount: req.mutualFriends, updatedAt: iso() });
  }
  await save(k.friendships, friendships);
  const p = await getMyProfile(k);
  await updateMyProfile({ friendsCount: p.friendsCount + 1 }, k);
  notify();
}
export async function declineFriendRequest(requestId: string): Promise<void> {
  const k = K();
  const requests = await getFriendRequests(k);
  await save(k.requests, requests.map(r => r.id === requestId ? { ...r, status: 'declined' as const } : r));
  notify();
}
export async function cancelFriendRequest(requestId: string): Promise<void> {
  const k = K();
  const requests = await getFriendRequests(k);
  const req = requests.find(r => r.id === requestId);
  await save(k.requests, requests.filter(r => r.id !== requestId));
  if (req) {
    const friendships = await getFriendships(k);
    await save(k.friendships, friendships.filter(f => f.userId !== req.toId));
  }
  notify();
}
export async function removeFriend(userId: string, k: SocialKeys = K()): Promise<void> {
  const friendships = await getFriendships(k);
  await save(k.friendships, friendships.filter(f => f.userId !== userId));
  const p = await getMyProfile(k);
  await updateMyProfile({ friendsCount: Math.max(0, p.friendsCount - 1) }, k);
  // Disable messaging in existing conversation
  const convs = await getConversations(k);
  const updated = convs.map(c => c.type === 'buyer_to_buyer' && c.participants.some(p => p.userId === userId) ? { ...c, isFriendshipActive: false } : c);
  await save(k.conversations, updated);
  notify();
}

// ─── Conversations ────────────────────────────────────────────────────────────

export async function getConversations(k: SocialKeys = K()): Promise<Conversation[]> {
  const remote = await serviceRequest<Conversation[]>('/api/conversations');
  if (!Array.isArray(remote)) throw new Error('Invalid conversations response');
  // An empty inbox is a valid, authoritative server result.
  if (_socialUserId === k.userId) await save(k.conversations, remote);
  return remote;
}
export async function getConversation(id: string): Promise<Conversation | null> {
  if (!id) return null;
  const k = K();
  const conversation = await serviceRequest<Conversation>(`/api/conversations/${encodeURIComponent(id)}`);
  if (_socialUserId === k.userId) {
    const conversations = await load<Conversation[]>(k.conversations, []);
    await save(k.conversations, [
      ...conversations.filter((conversation) => conversation.id !== id),
      conversation,
    ]);
  }
  return conversation;
}
export async function createOrGetConversation(params: {
  type: ConversationType;
  participant: ConversationParticipant;
  contextOrderId?: string; contextOrderNumber?: string; contextOrderStatus?: string;
  contextProductId?: string; contextProductName?: string; contextSellerName?: string;
}): Promise<Conversation> {
  const k = K();
  const profile = await getMyProfile(k);
  const conv = await serviceRequest<Conversation>('/api/conversations', {
    method: 'POST',
    body: JSON.stringify({
      type: params.type ?? 'buyer_to_seller',
      participant: {
        userId: params.participant.userId, name: params.participant.name,
        handle: params.participant.handle ?? '', initials: params.participant.initials ?? '',
        color: params.participant.color ?? '#8B5CF6', accountType: params.participant.accountType ?? 'seller',
      },
      myInfo: { name: profile.name, handle: `@${profile.username}`, initials: profile.avatarInitials, color: profile.avatarColor, accountType: 'buyer' },
      contextOrderId: params.contextOrderId, contextOrderNumber: params.contextOrderNumber,
      contextOrderStatus: params.contextOrderStatus, contextProductId: params.contextProductId,
      contextProductName: params.contextProductName, contextSellerName: params.contextSellerName,
    }),
  });
  if (_socialUserId === k.userId) {
    const conversations = await load<Conversation[]>(k.conversations, []);
    await save(k.conversations, [...conversations.filter((conversation) => conversation.id !== conv.id), conv]);
  }
  notify();
  return conv;
}
export async function getMessages(conversationId: string, k: SocialKeys = K()): Promise<Message[]> {
  const msgKey = k.messages(conversationId);
  const remote = await serviceRequest<Message[]>(`/api/conversations/${encodeURIComponent(conversationId)}/messages`);
  if (!Array.isArray(remote)) throw new Error('Invalid messages response');
  // An empty conversation is not a signal to substitute seeded messages.
  if (_socialUserId === k.userId) await save(msgKey, remote);
  return remote;
}
export async function sendMessage(conversationId: string, text: string, attachment?: MessageAttachment, replyToId?: string): Promise<Message> {
  const k = K();
  const msgKey = k.messages(conversationId);
  const message = await serviceRequest<Message>(`/api/conversations/${encodeURIComponent(conversationId)}/messages`, {
    method: 'POST',
    body: JSON.stringify({ text, attachment, replyToId }),
  });
  if (_socialUserId === k.userId) {
    const messages = await load<Message[]>(msgKey, []);
    await save(msgKey, [...messages.filter((item) => item.id !== message.id), message]);
    const conversations = await load<Conversation[]>(k.conversations, []);
    const preview = getMessagePreview(message.text, message.attachment);
    await save(k.conversations, conversations.map((conversation) => conversation.id === conversationId
      ? { ...conversation, lastMessage: preview, lastMessageTs: message.ts, updatedAt: iso() }
      : conversation));
    notify();
  }
  return message;
}
export async function retryMessage(conversationId: string, messageId: string): Promise<void> {
  const k = K();
  const msgKey = k.messages(conversationId);
  const msgs = await load<Message[]>(msgKey, []);
  const idx = msgs.findIndex(m => m.id === messageId);
  if (idx < 0) throw new Error('Message not found');
  const message = msgs[idx];
  msgs[idx] = { ...message, status: 'sending' };
  await save(msgKey, msgs);
  notify();
  try {
    const canonical = await serviceRequest<Message>(`/api/conversations/${encodeURIComponent(conversationId)}/messages`, {
      method: 'POST',
      body: JSON.stringify({ text: message.text, attachment: message.attachment, replyToId: message.replyToId }),
    });
    if (_socialUserId === k.userId) {
      const current = await load<Message[]>(msgKey, []);
      await save(msgKey, [...current.filter((item) => item.id !== messageId && item.id !== canonical.id), canonical]);
      notify();
    }
  } catch (error) {
    if (_socialUserId === k.userId) {
      const current = await load<Message[]>(msgKey, []);
      const currentIndex = current.findIndex((item) => item.id === messageId);
      if (currentIndex >= 0) {
        current[currentIndex] = { ...current[currentIndex], status: 'failed' };
        await save(msgKey, current);
        notify();
      }
    }
    throw error;
  }
}
export async function addReaction(conversationId: string, messageId: string, emoji: string): Promise<void> {
  const k = K();
  const msgKey = k.messages(conversationId);
  const msgs = await getMessages(conversationId, k);
  const idx = msgs.findIndex(m => m.id === messageId);
  if (idx < 0) return;
  const existing = msgs[idx].reactions.findIndex(r => r.fromId === MY_USER_ID && r.emoji === emoji);
  if (existing >= 0) { msgs[idx].reactions.splice(existing, 1); }
  else { msgs[idx].reactions = [...msgs[idx].reactions, { emoji, fromId: MY_USER_ID, fromName: MY_NAME }]; }
  await save(msgKey, msgs); notify();
}
export async function deleteMessageForMe(conversationId: string, messageId: string): Promise<void> {
  const k = K();
  const msgKey = k.messages(conversationId);
  const msgs = await getMessages(conversationId, k);
  const idx = msgs.findIndex(m => m.id === messageId);
  if (idx >= 0) { msgs[idx] = { ...msgs[idx], deletedForMe: true }; await save(msgKey, msgs); notify(); }
}
export async function markConversationRead(conversationId: string): Promise<void> {
  const k = K();
  await serviceRequest(`/api/conversations/${encodeURIComponent(conversationId)}/read`, { method: 'PATCH', body: JSON.stringify({}) });
  const convs = await load<Conversation[]>(k.conversations, []);
  const updated = convs.map(c => c.id === conversationId ? { ...c, unreadCount: 0 } : c);
  await save(k.conversations, updated); notify();
}
export async function archiveConversation(conversationId: string): Promise<void> {
  const k = K();
  const convs = await getConversations(k);
  await save(k.conversations, convs.map(c => c.id === conversationId ? { ...c, isArchived: true } : c)); notify();
}

// ─── Stories ─────────────────────────────────────────────────────────────────

async function loadStories(k: SocialKeys = K()): Promise<Story[]> {
  const all = await load<Story[]>(k.stories, []);
  return all.filter(s => s.expiresAt > Date.now()); // prune expired
}
export async function getStories(k: SocialKeys = K()): Promise<Story[]> {
  return loadStories(k);
}
export async function getMyStories(k: SocialKeys = K()): Promise<Story[]> {
  const remote = await serviceRequest<Story[]>('/api/social/stories/me');
  return Array.isArray(remote) ? remote : [];
}
export async function createStory(params: { media: StoryMedia[]; privacy: StoryPrivacySettings; repliesDisabled: boolean; }): Promise<Story> {
  const k = K();
  const profile = await getMyProfile(k);
  const story = await serviceRequest<Story>('/api/social/stories', {
    method: 'POST',
    body: JSON.stringify({
      authorName: profile.name,
      authorHandle: `@${profile.username}`,
      authorInitials: profile.avatarInitials,
      authorColor: profile.avatarColor,
      authorAccountType: 'buyer',
      media: params.media,
      privacy: params.privacy,
      repliesDisabled: params.repliesDisabled,
    }),
  });
  notify();
  return story;
}
export async function trackStoryView(storyId: string): Promise<void> {
  await serviceRequest(`/api/social/stories/${encodeURIComponent(storyId)}/view`, {
    method: 'POST', body: JSON.stringify({}),
  });
}
export async function deleteStory(storyId: string): Promise<void> {
  const k = K();
  const stories = await loadStories(k);
  await save(k.stories, stories.filter(s => s.id !== storyId)); notify();
}

// ─── Notifications ────────────────────────────────────────────────────────────

export async function getNotifications(k: SocialKeys = K()): Promise<Notification[]> {
  const remote = await serviceRequest<Notification[]>('/api/buyer/notifications');
  const authoritative = Array.isArray(remote) ? remote : [];
  if (_socialUserId === k.userId) await save(k.notifications, authoritative);
  return authoritative;
}
export async function markNotificationRead(id: string): Promise<void> {
  const k = K();
  serviceRequest('/api/buyer/notifications/' + encodeURIComponent(id) + '/read', { method: 'PATCH', body: JSON.stringify({}) }).catch(() => {});
  const notifs = await getNotifications(k);
  await save(k.notifications, notifs.map(n => n.id === id ? { ...n, isRead: true } : n)); notify();
}
export async function markNotificationUnread(id: string): Promise<void> {
  const k = K();
  const notifs = await getNotifications(k);
  await save(k.notifications, notifs.map(n => n.id === id ? { ...n, isRead: false } : n)); notify();
}
export async function deleteNotification(id: string): Promise<void> {
  const k = K();
  try {
    await serviceRequest('/api/buyer/notifications/' + encodeURIComponent(id), { method: 'DELETE' });
    const notifs = await getNotifications(k);
    await save(k.notifications, notifs.filter(n => n.id !== id));
    notify(); return;
  } catch { /* fall through to existing local logic */ }
  const notifs = await getNotifications(k);
  await save(k.notifications, notifs.filter(n => n.id !== id)); notify();
}
export async function muteNotificationCategory(category: NotificationCategory): Promise<void> {
  const k = K();
  const notifs = await getNotifications(k);
  await save(k.notifications, notifs.map(n => n.category === category ? { ...n, isMuted: true } : n)); notify();
}
export async function clearAllReadNotifications(): Promise<void> {
  const k = K();
  try {
    await serviceRequest('/api/buyer/notifications/read-all', { method: 'PATCH', body: JSON.stringify({}) });
    const notifs = await getNotifications(k);
    await save(k.notifications, notifs.filter(n => !n.isRead));
    notify(); return;
  } catch { /* fall through to existing local logic */ }
  const notifs = await getNotifications(k);
  await save(k.notifications, notifs.filter(n => !n.isRead)); notify();
}
export async function getNotificationPreferences(k: SocialKeys = K()): Promise<NotificationPreference[]> {
  return load<NotificationPreference[]>(k.notifPrefs, DEFAULT_NOTIFICATION_PREFS);
}
export async function updateNotificationPreference(category: NotificationCategory, updates: Partial<Omit<NotificationPreference, 'category'>>): Promise<void> {
  const k = K();
  const prefs = await getNotificationPreferences(k);
  await save(k.notifPrefs, prefs.map(p => p.category === category ? { ...p, ...updates } : p)); notify();
}
export async function addNotification(n: Omit<Notification, 'id' | 'createdAt'>): Promise<void> {
  const k = K();
  const notifs = await getNotifications(k);
  await save(k.notifications, [{ ...n, id: uid(), createdAt: iso() }, ...notifs]); notify();
}

// ─── Blocking & Muting ────────────────────────────────────────────────────────

export async function getBlockedUsers(k: SocialKeys = K()): Promise<BlockRecord[]> {
  return load<BlockRecord[]>(k.blocks, []);
}
export async function isBlocked(userId: string): Promise<boolean> {
  const k = K();
  const blocks = await getBlockedUsers(k);
  return blocks.some(b => b.blockedUserId === userId);
}
/**
 * Block someone. The server is the source of truth (it hides both people from
 * each other everywhere and stops messages/comments); the local record only
 * keeps this device's lists in sync. Throws if the server rejects the block.
 */
export async function blockUser(params: { userId: string; name: string; handle: string; initials: string; color: string; }): Promise<void> {
  await serviceRequest('/api/social/block', { method: 'POST', body: JSON.stringify({ userId: params.userId }) });
  const k = K();
  const blocks = await getBlockedUsers(k);
  if (blocks.some(b => b.blockedUserId === params.userId)) { notify(); return; }
  blocks.unshift({ id: uid(), blockedUserId: params.userId, blockedUserName: params.name, blockedUserHandle: params.handle, blockedUserInitials: params.initials, blockedUserColor: params.color, createdAt: iso() });
  await save(k.blocks, blocks);
  await removeFriend(params.userId, k);
  notify();
}
export async function unblockUser(userId: string): Promise<void> {
  await serviceRequest(`/api/social/block/${encodeURIComponent(userId)}`, { method: 'DELETE' });
  const k = K();
  const blocks = await getBlockedUsers(k);
  await save(k.blocks, blocks.filter(b => b.blockedUserId !== userId)); notify();
}
export async function getMutedUsers(k: SocialKeys = K()): Promise<MuteRecord[]> {
  return load<MuteRecord[]>(k.mutes, []);
}
export async function muteUser(params: { userId: string; name: string; handle: string; initials: string; color: string; }): Promise<void> {
  const k = K();
  const mutes = await getMutedUsers(k);
  if (mutes.some(m => m.mutedUserId === params.userId)) return;
  mutes.unshift({ id: uid(), mutedUserId: params.userId, mutedUserName: params.name, mutedUserHandle: params.handle, mutedUserInitials: params.initials, mutedUserColor: params.color, createdAt: iso() });
  await save(k.mutes, mutes); notify();
}
export async function unmuteUser(userId: string): Promise<void> {
  const k = K();
  const mutes = await getMutedUsers(k);
  await save(k.mutes, mutes.filter(m => m.mutedUserId !== userId)); notify();
}

// ─── Restriction ─────────────────────────────────────────────────────────────

export async function getRestrictedUsers(k: SocialKeys = K()): Promise<RestrictRecord[]> {
  return load<RestrictRecord[]>(k.restricts, []);
}
export async function restrictUser(params: { userId: string; name: string; handle: string; initials: string; color: string; }): Promise<void> {
  const k = K();
  const restricts = await getRestrictedUsers(k);
  if (restricts.some(r => r.restrictedUserId === params.userId)) return;
  restricts.unshift({ id: uid(), restrictedUserId: params.userId, restrictedUserName: params.name, restrictedUserHandle: params.handle, restrictedUserInitials: params.initials, restrictedUserColor: params.color, createdAt: iso() });
  await save(k.restricts, restricts); notify();
}
export async function unrestrictUser(userId: string): Promise<void> {
  const k = K();
  const restricts = await getRestrictedUsers(k);
  await save(k.restricts, restricts.filter(r => r.restrictedUserId !== userId)); notify();
}

// ─── Saved Content ────────────────────────────────────────────────────────────

export async function getSavedItems(k: SocialKeys = K()): Promise<SavedItem[]> {
  const remote = await serviceRequest<SavedItem[]>('/api/buyer/saved');
  const authoritative = Array.isArray(remote) ? remote : [];
  if (_socialUserId === k.userId) await save(k.saved, authoritative);
  return authoritative;
}
export async function saveItem(
  params: {
    type: SavedItemType; targetId: string; title: string; subtitle?: string; accentColor?: string;
    collectionId?: string | null; priceCents?: number;
  },
  options?: { onRemoteSaved?: () => void },
): Promise<SavedItem> {
  const k = K();
  try {
    const saved = await serviceRequest<SavedItem>('/api/buyer/saved', { method: 'POST', body: JSON.stringify(params) });
    options?.onRemoteSaved?.();
    notify();
    return saved;
  } catch { /* fall through to existing local logic */ }
  const items = await getSavedItems(k);
  const existing = items.find(i => i.targetId === params.targetId);
  if (existing) return existing;
  const item: SavedItem = { id: uid(), savedAt: iso(), ...params, collectionId: params.collectionId ?? undefined };
  await save(k.saved, [item, ...items]);
  const p = await getMyProfile(k);
  await updateMyProfile({ savedCount: p.savedCount + 1 }, k);
  notify();
  return item;
}
export async function removeSavedItem(targetId: string): Promise<void> {
  const k = K();
  try {
    await serviceRequest('/api/buyer/saved/' + encodeURIComponent(targetId), { method: 'DELETE' });
    notify();
    return;
  } catch { /* fall through to existing local logic */ }
  const items = await getSavedItems(k);
  await save(k.saved, items.filter(i => i.targetId !== targetId));
  const p = await getMyProfile(k);
  await updateMyProfile({ savedCount: Math.max(0, p.savedCount - 1) }, k);
  notify();
}
export async function isItemSaved(targetId: string): Promise<boolean> {
  const k = K();
  const items = await getSavedItems(k);
  return items.some(i => i.targetId === targetId);
}
/** Move (or un-file, with `collectionId: null`) an already-saved item between boards. */
export async function moveSavedItemToCollection(targetId: string, collectionId: string | null): Promise<SavedItem> {
  const updated = await serviceRequest<SavedItem>(
    '/api/buyer/saved/' + encodeURIComponent(targetId),
    { method: 'PATCH', body: JSON.stringify({ collectionId }) },
  );
  notify();
  return updated;
}

// ─── Saved Collections (boards) ────────────────────────────────────────────────

export async function getCollections(): Promise<SavedCollection[]> {
  const remote = await serviceRequest<SavedCollection[]>('/api/buyer/collections');
  return Array.isArray(remote) ? remote : [];
}
export async function getCollectionItems(collectionId: string): Promise<{ collection: SavedCollection; items: SavedItem[] }> {
  return serviceRequest(`/api/buyer/collections/${encodeURIComponent(collectionId)}/items`);
}
export async function createCollection(name: string): Promise<SavedCollection> {
  const collection = await serviceRequest<SavedCollection>('/api/buyer/collections', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
  notify();
  return collection;
}
export async function updateCollection(
  collectionId: string,
  updates: { name?: string; coverImageUrl?: string | null; isPublic?: boolean },
): Promise<SavedCollection> {
  const collection = await serviceRequest<SavedCollection>(`/api/buyer/collections/${encodeURIComponent(collectionId)}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
  notify();
  return collection;
}
export async function deleteCollection(collectionId: string): Promise<void> {
  await serviceRequest(`/api/buyer/collections/${encodeURIComponent(collectionId)}`, { method: 'DELETE' });
  notify();
}
export async function reorderCollections(orderedIds: string[]): Promise<void> {
  await serviceRequest('/api/buyer/collections/reorder', {
    method: 'POST',
    body: JSON.stringify({ orderedIds }),
  });
  notify();
}
/** Unauthenticated read for a shared collection deep link — no token required. */
export async function getPublicCollection(collectionId: string): Promise<{
  collection: { id: string; name: string; coverImageUrl: string | null; itemCount: number; ownerName: string };
  items: SavedItem[];
}> {
  return serviceRequest(`/api/public/collections/${encodeURIComponent(collectionId)}`, {}, false);
}

// ─── Privacy ──────────────────────────────────────────────────────────────────

export async function getPrivacySettings(k: SocialKeys = K()): Promise<PrivacySettings> {
  return load<PrivacySettings>(k.privacy, DEFAULT_PRIVACY_SETTINGS);
}
export async function updatePrivacySettings(updates: Partial<PrivacySettings>): Promise<PrivacySettings> {
  const k = K();
  const current = await getPrivacySettings(k);
  const next = { ...current, ...updates };
  await save(k.privacy, next); notify();
  return next;
}

// ─── Search ───────────────────────────────────────────────────────────────────

export async function searchProfiles(query: string): Promise<ProfileSearchResult[]> {
  if (!query.trim()) return [];
  const remote = await serviceRequest<ProfileSearchResult[]>(
    `/api/social/search?q=${encodeURIComponent(query.trim())}`,
  );
  return Array.isArray(remote) ? remote : [];
}

/** Returns one stable page of published seller posts for the buyer Thread feed.
 *  The two source offsets advance independently and followed posts are exhausted
 *  before public posts are appended.
 *
 *  Sources:
 *  - GET /api/posts/feed    — followed sellers' posts (requires buyer Clerk token;
 *                             fails/empty for unauthenticated or new buyers)
 *  - GET /api/public/posts  — general feed of all seller posts, newest-first
 *
 *  Public pages may overlap the followed source, so the cursor carries every ID
 *  already emitted. Raw offsets advance by rows consumed, not rows emitted,
 *  preventing an overlap from making later public posts get skipped.
 */
export async function getThreadPostsPage(
  cursor: ThreadFeedCursor = createThreadFeedCursor(),
  limit = 30,
  mode: ThreadFeedMode = 'mixed',
): Promise<ThreadFeedPage> {
  const pageLimit = Number.isFinite(limit) ? Math.min(50, Math.max(1, Math.floor(limit))) : 30;
  const next: ThreadFeedCursor = {
    followedOffset: Math.max(0, Math.floor(cursor.followedOffset || 0)),
    generalOffset: Math.max(0, Math.floor(cursor.generalOffset || 0)),
    followedDone: Boolean(cursor.followedDone),
    generalDone: Boolean(cursor.generalDone),
    seenPostIds: Array.isArray(cursor.seenPostIds) ? [...cursor.seenPostIds] : [],
  };
  const seen = new Set(next.seenPostIds);
  const rows: any[] = [];

  if (mode === 'following') {
    next.generalDone = true;
  } else if (mode === 'for-you') {
    next.followedDone = true;
  }

  const addUnique = (sourceRows: any[]) => {
    for (const row of sourceRows) {
      if (rows.length >= pageLimit) break;
      if (typeof row?.id !== 'string' || seen.has(row.id)) continue;
      seen.add(row.id);
      rows.push(row);
    }
  };

  while (rows.length < pageLimit && !next.followedDone) {
    let followed: any[];
    try {
      followed = await requestThreadSource(
        '/api/posts/feed',
        next.followedOffset,
        pageLimit,
      );
    } catch (error) {
      if (mode !== 'mixed') throw error;
      next.followedDone = true;
      break;
    }
    next.followedOffset += followed.length;
    addUnique(followed);
    if (followed.length < pageLimit) next.followedDone = true;
  }

  while (rows.length < pageLimit && !next.generalDone) {
    const general = await requestThreadSource(
      '/api/public/posts',
      next.generalOffset,
      pageLimit,
    );
    next.generalOffset += general.length;
    addUnique(general);
    if (general.length < pageLimit) next.generalDone = true;
  }

  let repostContext: Record<string, {
    repostedByMe?: boolean;
    reposters?: Array<{
      userId: string;
      displayName: string | null;
      avatarUrl: string | null;
      createdAt: string;
    }>;
  }> = {};
  const contextPostIds = rows
    .map(row => row?.id)
    .filter((id): id is string => typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id));
  if (contextPostIds.length > 0) {
    try {
      repostContext = await serviceRequest<typeof repostContext>(
        `/api/posts/repost-context?postIds=${encodeURIComponent(contextPostIds.join(','))}`,
      );
    } catch {
      // Repost identity is optional feed context. Never replace a valid feed
      // page with an error or infer identities client-side when it is missing.
      repostContext = {};
    }
  }
  const rowsWithRepostContext = rows.map(row => {
    const context = repostContext[row.id];
    return context ? {
      ...row,
      repostedByMe: context.repostedByMe === true,
      friendReposts: Array.isArray(context.reposters) ? context.reposters : [],
    } : row;
  });

  next.seenPostIds = [...seen];
  return {
    posts: rowsWithRepostContext.map((post, index) => mapApiPostToSellerThreadPost(post, index)),
    cursor: next,
    hasMore: !next.followedDone || !next.generalDone,
  };
}

export function createThreadFeedCursor(): ThreadFeedCursor {
  return {
    followedOffset: 0,
    generalOffset: 0,
    followedDone: false,
    generalDone: false,
    seenPostIds: [],
  };
}

async function requestThreadSource(
  path: '/api/posts/feed' | '/api/public/posts',
  offset: number,
  limit: number,
): Promise<any[]> {
  const query = `?limit=${limit}&offset=${offset}`;
  const response = await serviceRequest(`${path}${query}`);
  if (!Array.isArray(response)) throw new Error('Invalid Thread feed response');
  return response as any[];
}

export interface ThreadFeedPage {
  posts: SellerThreadPost[];
  cursor: ThreadFeedCursor;
  hasMore: boolean;
}
