/**
 * Brandthread Social Service
 * All social features backed by AsyncStorage with in-memory caching.
 * Demo data seeded on first load. Pub/sub for UI reactivity.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import type {
  BuyerSocialProfile, BuyerPost, RepostRecord,
  Friendship, FriendshipStatus, FriendRequest, FriendSuggestion,
  Conversation, ConversationType, ConversationParticipant,
  Message, MessageAttachment, MessageReaction,
  Story, StoryMedia, StoryPrivacySettings, StoryViewer,
  Notification, NotificationCategory, NotificationPreference,
  BlockRecord, MuteRecord, Report, ReportReason, ReportTargetType,
  SavedItem, SavedItemType, PrivacySettings, ProfileSearchResult,
} from './socialTypes';
import { DEFAULT_PRIVACY_SETTINGS, DEFAULT_NOTIFICATION_PREFS } from './socialTypes';

// ─── Keys ─────────────────────────────────────────────────────────────────────

const K = {
  profile:       'bt:social:profile:v1',
  posts:         'bt:social:posts:v1',
  reposts:       'bt:social:reposts:v1',
  friendships:   'bt:social:friendships:v1',
  requests:      'bt:social:requests:v1',
  conversations: 'bt:social:convs:v1',
  messages:      (id: string) => `bt:social:msgs:${id}:v1`,
  stories:       'bt:social:stories:v1',
  notifications: 'bt:social:notifs:v1',
  notifPrefs:    'bt:social:notif_prefs:v1',
  blocks:        'bt:social:blocks:v1',
  mutes:         'bt:social:mutes:v1',
  saved:         'bt:social:saved:v1',
  privacy:       'bt:social:privacy:v1',
  seeded:        'bt:social:seeded:v1',
} as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

let _uidCounter = 0;
function uid(): string {
  return `${Date.now()}_${++_uidCounter}_${Math.random().toString(36).slice(2, 7)}`;
}
function iso(): string { return new Date().toISOString(); }

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

// ─── Seed data ────────────────────────────────────────────────────────────────

const DEMO_FRIENDS: Friendship[] = [
  { id: 'fr_maya',   userId: 'u_maya',   name: 'Maya Chen',    handle: '@mayachen',    initials: 'MC', color: '#BE185D', status: 'accepted', mutualFriendsCount: 3, lastSeenAt: new Date(Date.now() - 5 * 60000).toISOString(), updatedAt: iso() },
  { id: 'fr_jordan', userId: 'u_jordan', name: 'Jordan Lee',   handle: '@jordanlee',   initials: 'JL', color: '#1D4ED8', status: 'accepted', mutualFriendsCount: 2, lastSeenAt: new Date(Date.now() - 30 * 60000).toISOString(), updatedAt: iso() },
  { id: 'fr_amir',   userId: 'u_amir',   name: 'Amir Patel',   handle: '@amirpatel',   initials: 'AP', color: '#0F766E', status: 'accepted', mutualFriendsCount: 1, updatedAt: iso() },
  { id: 'fr_sofia',  userId: 'u_sofia',  name: 'Sofia Reyes',  handle: '@sofiareyes',  initials: 'SR', color: '#B45309', status: 'accepted', mutualFriendsCount: 2, updatedAt: iso() },
  { id: 'fr_kai',    userId: 'u_kai',    name: 'Kai Nakamura', handle: '@kainakamura', initials: 'KN', color: '#00C853', status: 'accepted', mutualFriendsCount: 1, lastSeenAt: new Date(Date.now() - 2 * 60000).toISOString(), updatedAt: iso() },
];

const DEMO_REQUESTS: FriendRequest[] = [
  { id: 'req_alex',  fromId: 'u_alex',  fromName: 'Alex Kim',   fromHandle: '@alexkim',   fromInitials: 'AK', fromColor: '#3B82F6', toId: MY_USER_ID, status: 'pending', mutualFriends: 2, createdAt: new Date(Date.now() - 2 * 3600000).toISOString() },
  { id: 'req_zoe',   fromId: 'u_zoe',   fromName: 'Zoe Carter', fromHandle: '@zoecarter', fromInitials: 'ZC', fromColor: '#EC4899', toId: MY_USER_ID, status: 'pending', mutualFriends: 0, createdAt: new Date(Date.now() - 24 * 3600000).toISOString() },
];

const DEMO_SUGGESTIONS: FriendSuggestion[] = [
  { id: 'sug_casey',  userId: 'u_casey',  name: 'Casey Park',   handle: '@caseypark',   initials: 'CP', color: '#7C3AED', reason: '2 mutual friends',    mutualCount: 2 },
  { id: 'sug_riley',  userId: 'u_riley',  name: 'Riley Moss',   handle: '@rileymoss',   initials: 'RM', color: '#0891B2', reason: 'Follows Atlas Goods', mutualCount: 0 },
  { id: 'sug_samara', userId: 'u_samara', name: 'Samara Gold',  handle: '@samaragold',  initials: 'SG', color: '#D97706', reason: '3 mutual friends',    mutualCount: 3 },
  { id: 'sug_dante',  userId: 'u_dante',  name: 'Dante Rivera', handle: '@danterivera', initials: 'DR', color: '#059669', reason: 'Follows Vault Studio', mutualCount: 1 },
];

const DEMO_CONVS: Conversation[] = [
  {
    id: 'conv_maya', type: 'buyer_to_buyer',
    participants: [{ userId: 'u_maya', name: 'Maya Chen', handle: '@mayachen', initials: 'MC', color: '#BE185D', accountType: 'buyer' }],
    lastMessage: 'Adding to cart rn!! Thanks ❤️', lastMessageTs: Date.now() - 53 * 60000,
    unreadCount: 0, isFriendshipActive: true, isArchived: false, isRequest: false, updatedAt: iso(),
  },
  {
    id: 'conv_kai', type: 'buyer_to_buyer',
    participants: [{ userId: 'u_kai', name: 'Kai Nakamura', handle: '@kainakamura', initials: 'KN', color: '#00C853', accountType: 'buyer' }],
    lastMessage: 'Lmao same struggle. The colour is different though', lastMessageTs: Date.now() - 5 * 60000,
    unreadCount: 1, isFriendshipActive: true, isArchived: false, isRequest: false, updatedAt: iso(),
  },
  {
    id: 'conv_vault', type: 'buyer_to_seller',
    participants: [{ userId: 'u_vault', name: 'Vault Studio', handle: '@vaultstudio', initials: 'VS', color: '#00C853', accountType: 'seller' }],
    lastMessage: 'Hi! When does the cargo jacket restock?', lastMessageTs: Date.now() - 3 * 3600000,
    unreadCount: 0, isFriendshipActive: true, isArchived: false, isRequest: false, updatedAt: iso(),
  },
  {
    id: 'conv_order', type: 'buyer_to_seller_order',
    participants: [{ userId: 'u_meridian', name: 'Meridian Co.', handle: '@meridianco', initials: 'MC', color: '#0F766E', accountType: 'seller' }],
    lastMessage: 'Your order has shipped!', lastMessageTs: Date.now() - 24 * 3600000,
    unreadCount: 1, isFriendshipActive: true, isArchived: false, isRequest: false,
    contextOrderId: 'ord_2041', contextOrderNumber: '#2041', contextOrderStatus: 'Shipped',
    contextProductName: 'Essential Relaxed Tee', contextSellerName: 'Meridian Co.',
    updatedAt: iso(),
  },
  {
    id: 'conv_seller_req', type: 'buyer_to_seller',
    participants: [{ userId: 'u_nxgen', name: 'NxGen Drops', handle: '@nxgendrops', initials: 'NX', color: '#B45309', accountType: 'seller' }],
    lastMessage: 'Is the archive hoodie still available in XL?', lastMessageTs: Date.now() - 6 * 3600000,
    unreadCount: 0, isFriendshipActive: true, isArchived: false, isRequest: true, updatedAt: iso(),
  },
];

const now = Date.now();
const DEMO_MESSAGES: Record<string, Message[]> = {
  conv_maya: [
    { id: 'm1', conversationId: 'conv_maya', fromId: 'u_maya', fromName: 'Maya Chen', fromInitials: 'MC', fromColor: '#BE185D', text: 'Omg did you see the Vault Studio drop?? 😭', reactions: [], status: 'delivered', ts: now - 62 * 60000, deletedForMe: false },
    { id: 'm2', conversationId: 'conv_maya', fromId: MY_USER_ID, fromName: MY_NAME, fromInitials: MY_INITIALS, fromColor: MY_COLOR, text: 'I know!! I\'ve been refreshing since 8am lol', reactions: [], status: 'delivered', ts: now - 60 * 60000, deletedForMe: false },
    { id: 'm3', conversationId: 'conv_maya', fromId: 'u_maya', fromName: 'Maya Chen', fromInitials: 'MC', fromColor: '#BE185D', text: 'The cargo jacket is so good. Are you getting it?', reactions: [], status: 'delivered', ts: now - 58 * 60000, deletedForMe: false },
    { id: 'm4', conversationId: 'conv_maya', fromId: MY_USER_ID, fromName: MY_NAME, fromInitials: MY_INITIALS, fromColor: MY_COLOR, text: 'Already in my cart 👀 you should grab it before it sells out', reactions: [], status: 'delivered', ts: now - 55 * 60000, deletedForMe: false },
    { id: 'm5', conversationId: 'conv_maya', fromId: 'u_maya', fromName: 'Maya Chen', fromInitials: 'MC', fromColor: '#BE185D', text: 'Adding to cart rn!! Thanks ❤️', reactions: [{ emoji: '❤️', fromId: MY_USER_ID, fromName: MY_NAME }], status: 'delivered', ts: now - 53 * 60000, deletedForMe: false },
  ],
  conv_kai: [
    { id: 'k1', conversationId: 'conv_kai', fromId: 'u_kai', fromName: 'Kai Nakamura', fromInitials: 'KN', fromColor: '#00C853', text: 'You see that Meridian drop? The sage tee is so clean', reactions: [], status: 'delivered', ts: now - 30 * 60000, deletedForMe: false },
    { id: 'k2', conversationId: 'conv_kai', fromId: MY_USER_ID, fromName: MY_NAME, fromInitials: MY_INITIALS, fromColor: MY_COLOR, text: 'Yeah I nearly copped! Held off because I already have like 6 tees lol', reactions: [], status: 'delivered', ts: now - 28 * 60000, deletedForMe: false },
    { id: 'k3', conversationId: 'conv_kai', fromId: 'u_kai', fromName: 'Kai Nakamura', fromInitials: 'KN', fromColor: '#00C853', text: 'Lmao same struggle. The colour is different though', reactions: [], status: 'delivered', ts: now - 5 * 60000, deletedForMe: false },
  ],
  conv_vault: [
    { id: 'v1', conversationId: 'conv_vault', fromId: MY_USER_ID, fromName: MY_NAME, fromInitials: MY_INITIALS, fromColor: MY_COLOR, text: 'Hi! When does the cargo jacket restock?', reactions: [], status: 'delivered', ts: now - 3 * 3600000, deletedForMe: false },
    { id: 'v2', conversationId: 'conv_vault', fromId: 'u_vault', fromName: 'Vault Studio', fromInitials: 'VS', fromColor: '#00C853', text: 'Hey! We\'re restocking next Friday — follow our page to get notified 🙌', reactions: [], status: 'delivered', ts: now - 2.5 * 3600000, deletedForMe: false },
  ],
  conv_order: [
    { id: 'o1', conversationId: 'conv_order', fromId: 'u_meridian', fromName: 'Meridian Co.', fromInitials: 'MC', fromColor: '#0F766E', text: 'Your order has shipped! Tracking number: TRK-884921', reactions: [], status: 'delivered', ts: now - 24 * 3600000, deletedForMe: false },
  ],
  conv_seller_req: [
    { id: 'sr1', conversationId: 'conv_seller_req', fromId: MY_USER_ID, fromName: MY_NAME, fromInitials: MY_INITIALS, fromColor: MY_COLOR, text: 'Is the archive hoodie still available in XL?', attachment: { type: 'product', title: 'Archive Hoodie Vol.3', subtitle: '$135 · NxGen Drops', accentColor: '#B45309' }, reactions: [], status: 'delivered', ts: now - 6 * 3600000, deletedForMe: false },
  ],
};

const H24 = 24 * 3600 * 1000;
const DEMO_STORIES: Story[] = [
  {
    id: 'story_vault', authorId: 'u_vault', authorName: 'Vault Studio', authorHandle: '@vaultstudio',
    authorInitials: 'VS', authorColor: '#00C853', authorAccountType: 'seller',
    media: [
      { id: 'sm1', type: 'photo', backgroundColor: '#0A2B18', duration: 5, productTagId: 'prod_canvas_cargo', productTagName: 'Canvas Cargo Jacket' },
      { id: 'sm2', type: 'text', backgroundColor: '#003311', textContent: 'DROPPING NOW 🔥\nOnly 50 units', textColor: '#39FF88', duration: 4 },
    ],
    privacy: { visibility: 'public', replyPermission: 'everyone', hiddenFromUserIds: [], closeFriendsOnly: false },
    viewers: [], repliesDisabled: false, createdAt: now - 2 * 3600000, expiresAt: now - 2 * 3600000 + H24,
  },
  {
    id: 'story_maya', authorId: 'u_maya', authorName: 'Maya Chen', authorHandle: '@mayachen',
    authorInitials: 'MC', authorColor: '#BE185D', authorAccountType: 'buyer',
    media: [
      { id: 'sm3', type: 'text', backgroundColor: '#3A1530', textContent: 'Waiting for this drop 😭', textColor: '#FFFFFF', duration: 4 },
    ],
    privacy: { visibility: 'friends', replyPermission: 'friends', hiddenFromUserIds: [], closeFriendsOnly: false },
    viewers: [{ userId: MY_USER_ID, name: MY_NAME, handle: MY_HANDLE, viewedAt: now - 30 * 60000 }],
    repliesDisabled: false, createdAt: now - 4 * 3600000, expiresAt: now - 4 * 3600000 + H24,
  },
  {
    id: 'story_nxgen', authorId: 'u_nxgen', authorName: 'NxGen Drops', authorHandle: '@nxgendrops',
    authorInitials: 'NX', authorColor: '#B45309', authorAccountType: 'seller',
    media: [
      { id: 'sm4', type: 'photo', backgroundColor: '#2B1607', duration: 5 },
      { id: 'sm5', type: 'text', backgroundColor: '#1A0D04', textContent: 'Archive Hoodie Vol.3\nRestocking Friday', textColor: '#F59E0B', duration: 4 },
    ],
    privacy: { visibility: 'public', replyPermission: 'everyone', hiddenFromUserIds: [], closeFriendsOnly: false },
    viewers: [], repliesDisabled: false, createdAt: now - 6 * 3600000, expiresAt: now - 6 * 3600000 + H24,
  },
];

const DEMO_NOTIFS: Notification[] = [
  { id: 'n1',  category: 'social',   type: 'friend_request',   title: 'New friend request', body: 'Alex Kim wants to be friends.',              isRead: false, isMuted: false, actorName: 'Alex Kim',   actorHandle: '@alexkim',   actorInitials: 'AK', actorColor: '#3B82F6', targetId: 'req_alex', cta: 'Respond', createdAt: new Date(now - 2 * 3600000).toISOString() },
  { id: 'n2',  category: 'social',   type: 'friend_request',   title: 'New friend request', body: 'Zoe Carter wants to be friends.',             isRead: false, isMuted: false, actorName: 'Zoe Carter', actorHandle: '@zoecarter', actorInitials: 'ZC', actorColor: '#EC4899', targetId: 'req_zoe', cta: 'Respond', createdAt: new Date(now - 24 * 3600000).toISOString() },
  { id: 'n3',  category: 'social',   type: 'post_like',        title: 'Maya liked your post', body: 'Maya Chen liked your photo.',              isRead: false, isMuted: false, actorName: 'Maya Chen',  actorHandle: '@mayachen',  actorInitials: 'MC', actorColor: '#BE185D', createdAt: new Date(now - 45 * 60000).toISOString() },
  { id: 'n4',  category: 'social',   type: 'post_comment',     title: 'New comment',          body: 'Kai commented: "That\'s fire 🔥"',        isRead: true,  isMuted: false, actorName: 'Kai Nakamura', actorHandle: '@kainakamura', actorInitials: 'KN', actorColor: '#00C853', createdAt: new Date(now - 2 * 3600000).toISOString() },
  { id: 'n5',  category: 'orders',   type: 'order_shipped',    title: 'Order shipped',        body: 'Your Essential Relaxed Tee is on its way.', isRead: false, isMuted: false, targetId: 'ord_2041', cta: 'Track order', createdAt: new Date(now - 24 * 3600000).toISOString() },
  { id: 'n6',  category: 'orders',   type: 'order_confirmed',  title: 'Order confirmed',      body: '#2041 Canvas Cargo Jacket — $189.',         isRead: true,  isMuted: false, targetId: 'ord_2041', cta: 'View order', createdAt: new Date(now - 48 * 3600000).toISOString() },
  { id: 'n7',  category: 'products', type: 'drop_live',        title: 'Drop is live',         body: 'Vault Studio: Canvas Cargo Jacket — 50 units.', isRead: false, isMuted: false, targetId: 'prod_canvas_cargo', cta: 'Shop now', createdAt: new Date(now - 3 * 3600000).toISOString() },
  { id: 'n8',  category: 'products', type: 'product_restocked', title: 'Back in stock',       body: 'Archive Hoodie Vol.3 — 8 units remaining.', isRead: true,  isMuted: false, targetId: 'prod_archive_hoodie', cta: 'Buy now', createdAt: new Date(now - 6 * 3600000).toISOString() },
  { id: 'n9',  category: 'messages', type: 'new_friend_message', title: 'Message from Kai', body: 'Lmao same struggle. The colour is different though', isRead: false, isMuted: false, actorName: 'Kai Nakamura', actorInitials: 'KN', actorColor: '#00C853', targetId: 'conv_kai', cta: 'Reply', createdAt: new Date(now - 5 * 60000).toISOString() },
  { id: 'n10', category: 'social',   type: 'story_reaction',   title: 'Story reaction',       body: 'Maya reacted 🔥 to your story.',             isRead: true,  isMuted: false, actorName: 'Maya Chen', actorInitials: 'MC', actorColor: '#BE185D', createdAt: new Date(now - 20 * 60000).toISOString() },
  { id: 'n11', category: 'orders',   type: 'return_update',    title: 'Return update',        body: 'Your return for Archive Hoodie was approved.', isRead: true,  isMuted: false, createdAt: new Date(now - 72 * 3600000).toISOString() },
  { id: 'n12', category: 'products', type: 'price_drop',       title: 'Price drop alert',     body: 'Raw Denim Jacket by Coldform dropped to $280.', isRead: false, isMuted: false, cta: 'Shop now', createdAt: new Date(now - 1 * 3600000).toISOString() },
  { id: 'n13', category: 'social',   type: 'friend_accepted',  title: 'Friend request accepted', body: 'Sofia Reyes accepted your friend request.', isRead: true, isMuted: false, actorName: 'Sofia Reyes', actorInitials: 'SR', actorColor: '#B45309', createdAt: new Date(now - 5 * 24 * 3600000).toISOString() },
  { id: 'n14', category: 'messages', type: 'new_order_message', title: 'Message from Meridian Co.', body: 'Your order has shipped! Tracking: TRK-884921', isRead: false, isMuted: false, targetId: 'conv_order', cta: 'View', createdAt: new Date(now - 24 * 3600000).toISOString() },
  { id: 'n15', category: 'system',   type: 'system',           title: 'Welcome to Brandthread', body: 'Your buyer account is set up. Start following brands!', isRead: true, isMuted: false, createdAt: new Date(now - 30 * 24 * 3600000).toISOString() },
];

const DEMO_SAVED: SavedItem[] = [
  { id: 'sav1', type: 'post',       targetId: 'post_maya_1', title: 'Maya\'s wishlist post',     subtitle: '@mayachen · June 28',         accentColor: '#BE185D', savedAt: new Date(now - 2 * 24 * 3600000).toISOString() },
  { id: 'sav2', type: 'product',    targetId: 'prod_canvas_cargo', title: 'Canvas Cargo Jacket', subtitle: '$189 · Vault Studio',         accentColor: '#00C853', savedAt: new Date(now - 3 * 24 * 3600000).toISOString() },
  { id: 'sav3', type: 'store',      targetId: 'store_vault', title: 'Vault Studio Store',        subtitle: 'vaultstudio.brandthread.app', accentColor: '#00C853', savedAt: new Date(now - 7 * 24 * 3600000).toISOString() },
  { id: 'sav4', type: 'collection', targetId: 'coll_summer', title: 'Summer Drops 2026',         subtitle: '12 products',                 accentColor: '#F59E0B', savedAt: new Date(now - 10 * 24 * 3600000).toISOString() },
];

const DEMO_POSTS: BuyerPost[] = [
  {
    id: 'post_me_1', authorId: MY_USER_ID, authorName: MY_NAME, authorHandle: MY_HANDLE, authorInitials: MY_INITIALS, authorColor: MY_COLOR,
    authorAccountType: 'buyer', feedEligibility: 'profile_only', profileVisibility: 'public',
    type: 'photo', caption: 'Finally copped the cargo jacket 🙌 been wanting this since the last drop.', hashtags: ['#brandthread', '#vault', '#streetwear'],
    mediaColors: ['#1A1A2E', '#16213E'], likesCount: 47, commentsCount: 8, repostsCount: 3, likedByMe: false, savedByMe: false, repostedByMe: false, isArchived: false, isDraft: false,
    createdAt: new Date(now - 3 * 24 * 3600000).toISOString(), updatedAt: new Date(now - 3 * 24 * 3600000).toISOString(),
  },
  {
    id: 'post_me_2', authorId: MY_USER_ID, authorName: MY_NAME, authorHandle: MY_HANDLE, authorInitials: MY_INITIALS, authorColor: MY_COLOR,
    authorAccountType: 'buyer', feedEligibility: 'profile_only', profileVisibility: 'friends_only',
    type: 'video', caption: 'Unboxing the archive hoodie vol.3 — this colourway is insane', hashtags: ['#nxgendrops', '#unboxing'],
    mediaColors: ['#0B1B33', '#0A0E14'], likesCount: 92, commentsCount: 14, repostsCount: 7, likedByMe: false, savedByMe: false, repostedByMe: false, isArchived: false, isDraft: false,
    createdAt: new Date(now - 10 * 24 * 3600000).toISOString(), updatedAt: new Date(now - 10 * 24 * 3600000).toISOString(),
  },
  {
    id: 'post_me_3', authorId: MY_USER_ID, authorName: MY_NAME, authorHandle: MY_HANDLE, authorInitials: MY_INITIALS, authorColor: MY_COLOR,
    authorAccountType: 'buyer', feedEligibility: 'profile_only', profileVisibility: 'public',
    type: 'slideshow', caption: 'Current wishlist — rate it 👇', hashtags: ['#wishlist', '#fits'],
    mediaColors: ['#2B1607', '#120C08'], likesCount: 118, commentsCount: 22, repostsCount: 11, likedByMe: false, savedByMe: false, repostedByMe: false, isArchived: false, isDraft: false,
    createdAt: new Date(now - 20 * 24 * 3600000).toISOString(), updatedAt: new Date(now - 20 * 24 * 3600000).toISOString(),
  },
];

// ─── Seed ─────────────────────────────────────────────────────────────────────

async function seedIfNeeded(): Promise<void> {
  const done = await AsyncStorage.getItem(K.seeded);
  if (done === 'true') return;
  await Promise.all([
    save(K.friendships, DEMO_FRIENDS),
    save(K.requests, DEMO_REQUESTS),
    save(K.conversations, DEMO_CONVS),
    save(K.stories, DEMO_STORIES),
    save(K.notifications, DEMO_NOTIFS),
    save(K.saved, DEMO_SAVED),
    save(K.posts, DEMO_POSTS),
    save(K.reposts, []),
    save(K.blocks, []),
    save(K.mutes, []),
    save(K.privacy, DEFAULT_PRIVACY_SETTINGS),
    save(K.notifPrefs, DEFAULT_NOTIFICATION_PREFS),
    ...Object.entries(DEMO_MESSAGES).map(([id, msgs]) => save(K.messages(id), msgs)),
  ]);
  await AsyncStorage.setItem(K.seeded, 'true');
}

// Trigger seed immediately
seedIfNeeded();

// ─── Profile ──────────────────────────────────────────────────────────────────

const DEFAULT_PROFILE: BuyerSocialProfile = {
  id: MY_USER_ID, userId: MY_USER_ID, accountType: 'buyer',
  name: 'Jordan', username: 'jordan', pronouns: '', bio: '', website: '', location: '',
  avatarColor: MY_COLOR, avatarInitials: MY_INITIALS,
  profileVisibility: 'public', postsCount: 3, friendsCount: 5, savedCount: 4,
  followingBrandsCount: 5, createdAt: new Date(now - 30 * 24 * 3600000).toISOString(),
};

export async function getMyProfile(): Promise<BuyerSocialProfile> {
  return load(K.profile, DEFAULT_PROFILE);
}
export async function updateMyProfile(updates: Partial<BuyerSocialProfile>): Promise<BuyerSocialProfile> {
  const current = await getMyProfile();
  const next = { ...current, ...updates };
  await save(K.profile, next);
  notify();
  return next;
}

// ─── Posts ────────────────────────────────────────────────────────────────────

export async function getMyPosts(): Promise<BuyerPost[]> {
  return load<BuyerPost[]>(K.posts, DEMO_POSTS);
}
export async function createPost(params: {
  type: BuyerPost['type'];
  caption: string;
  hashtags: string[];
  mediaColors: string[];
  profileVisibility: BuyerPost['profileVisibility'];
  isDraft?: boolean;
}): Promise<BuyerPost> {
  const profile = await getMyProfile();
  const post: BuyerPost = {
    id: uid(), authorId: MY_USER_ID, authorName: profile.name, authorHandle: '@' + profile.username,
    authorInitials: profile.avatarInitials, authorColor: profile.avatarColor,
    authorAccountType: 'buyer', feedEligibility: 'profile_only',  // ENFORCED at write time
    profileVisibility: params.profileVisibility,
    type: params.type, caption: params.caption, hashtags: params.hashtags,
    mediaColors: params.mediaColors, likesCount: 0, commentsCount: 0, repostsCount: 0,
    likedByMe: false, savedByMe: false, repostedByMe: false, isArchived: false,
    isDraft: params.isDraft ?? false, createdAt: iso(), updatedAt: iso(),
  };
  const posts = await getMyPosts();
  await save(K.posts, [post, ...posts]);
  const p = await getMyProfile();
  await updateMyProfile({ postsCount: p.postsCount + 1 });
  notify();
  return post;
}
export async function updatePost(id: string, updates: Partial<Pick<BuyerPost, 'caption' | 'hashtags' | 'profileVisibility' | 'isDraft'>>): Promise<BuyerPost | null> {
  const posts = await getMyPosts();
  const idx = posts.findIndex(p => p.id === id);
  if (idx < 0) return null;
  const updated = { ...posts[idx], ...updates, updatedAt: iso() };
  posts[idx] = updated;
  await save(K.posts, posts);
  notify();
  return updated;
}
export async function deletePost(id: string): Promise<void> {
  const posts = await getMyPosts();
  await save(K.posts, posts.filter(p => p.id !== id));
  const p = await getMyProfile();
  await updateMyProfile({ postsCount: Math.max(0, p.postsCount - 1) });
  notify();
}
export async function archivePost(id: string): Promise<void> {
  await updatePost(id, {});
  const posts = await getMyPosts();
  const idx = posts.findIndex(p => p.id === id);
  if (idx >= 0) { posts[idx].isArchived = true; await save(K.posts, posts); notify(); }
}
export async function likePost(id: string): Promise<void> {
  const posts = await getMyPosts();
  const idx = posts.findIndex(p => p.id === id);
  if (idx >= 0) {
    posts[idx].likedByMe = !posts[idx].likedByMe;
    posts[idx].likesCount += posts[idx].likedByMe ? 1 : -1;
    await save(K.posts, posts); notify();
  }
}
export async function repostPost(id: string): Promise<void> {
  const posts = await getMyPosts();
  const idx = posts.findIndex(p => p.id === id);
  if (idx < 0) return;
  posts[idx].repostedByMe = !posts[idx].repostedByMe;
  posts[idx].repostsCount += posts[idx].repostedByMe ? 1 : -1;
  await save(K.posts, posts);
  if (posts[idx].repostedByMe) {
    const reposts = await load<RepostRecord[]>(K.reposts, []);
    reposts.unshift({ id: uid(), reposterId: MY_USER_ID, originalPostId: id, originalAuthorId: posts[idx].authorId, originalAuthorName: posts[idx].authorName, originalAuthorHandle: posts[idx].authorHandle, originalCaption: posts[idx].caption, feedEligibility: 'profile_only', createdAt: iso() });
    await save(K.reposts, reposts);
  }
  notify();
}
export async function getMyReposts(): Promise<RepostRecord[]> {
  return load<RepostRecord[]>(K.reposts, []);
}

// ─── Friendships ──────────────────────────────────────────────────────────────

export async function getFriendships(): Promise<Friendship[]> {
  return load<Friendship[]>(K.friendships, DEMO_FRIENDS);
}
export async function getAcceptedFriends(): Promise<Friendship[]> {
  const all = await getFriendships();
  return all.filter(f => f.status === 'accepted');
}
export async function getFriendRequests(): Promise<FriendRequest[]> {
  return load<FriendRequest[]>(K.requests, DEMO_REQUESTS);
}
export async function getFriendSuggestions(): Promise<FriendSuggestion[]> {
  return Promise.resolve([...DEMO_SUGGESTIONS]);
}
export async function isFriend(userId: string): Promise<boolean> {
  const friends = await getFriendships();
  return friends.some(f => f.userId === userId && f.status === 'accepted');
}
export async function canMessage(userId: string): Promise<boolean> {
  // Buyer-to-buyer requires accepted friendship
  const friends = await getFriendships();
  const entry = friends.find(f => f.userId === userId);
  return entry?.status === 'accepted';
}
export async function sendFriendRequest(params: { userId: string; name: string; handle: string; initials: string; color: string; }): Promise<{ success: boolean; message: string; request?: FriendRequest }> {
  if (params.userId === MY_USER_ID) return { success: false, message: 'You cannot send a request to yourself.' };
  const blocks = await getBlockedUsers();
  if (blocks.some(b => b.blockedUserId === params.userId)) return { success: false, message: 'Cannot send request to this user.' };
  const existing = await getFriendships();
  if (existing.some(f => f.userId === params.userId)) return { success: false, message: 'Already connected or pending.' };
  const req: FriendRequest = { id: uid(), fromId: MY_USER_ID, fromName: MY_NAME, fromHandle: MY_HANDLE, fromInitials: MY_INITIALS, fromColor: MY_COLOR, toId: params.userId, status: 'pending', mutualFriends: 0, createdAt: iso() };
  const requests = await getFriendRequests();
  await save(K.requests, [...requests, req]);
  const friendships = await getFriendships();
  await save(K.friendships, [...friendships, { id: uid(), userId: params.userId, name: params.name, handle: params.handle, initials: params.initials, color: params.color, status: 'pending_sent' as FriendshipStatus, mutualFriendsCount: 0, updatedAt: iso() }]);
  notify();
  return { success: true, message: 'Friend request sent.', request: req };
}
export async function acceptFriendRequest(requestId: string): Promise<void> {
  const requests = await getFriendRequests();
  const req = requests.find(r => r.id === requestId);
  if (!req) return;
  const updated = requests.map(r => r.id === requestId ? { ...r, status: 'accepted' as const } : r);
  await save(K.requests, updated);
  const friendships = await getFriendships();
  const existing = friendships.findIndex(f => f.userId === req.fromId);
  if (existing >= 0) {
    friendships[existing] = { ...friendships[existing], status: 'accepted', updatedAt: iso() };
  } else {
    friendships.push({ id: uid(), userId: req.fromId, name: req.fromName, handle: req.fromHandle, initials: req.fromInitials, color: req.fromColor, status: 'accepted', mutualFriendsCount: req.mutualFriends, updatedAt: iso() });
  }
  await save(K.friendships, friendships);
  const p = await getMyProfile();
  await updateMyProfile({ friendsCount: p.friendsCount + 1 });
  notify();
}
export async function declineFriendRequest(requestId: string): Promise<void> {
  const requests = await getFriendRequests();
  await save(K.requests, requests.map(r => r.id === requestId ? { ...r, status: 'declined' as const } : r));
  notify();
}
export async function cancelFriendRequest(requestId: string): Promise<void> {
  const requests = await getFriendRequests();
  const req = requests.find(r => r.id === requestId);
  await save(K.requests, requests.filter(r => r.id !== requestId));
  if (req) {
    const friendships = await getFriendships();
    await save(K.friendships, friendships.filter(f => f.userId !== req.toId));
  }
  notify();
}
export async function removeFriend(userId: string): Promise<void> {
  const friendships = await getFriendships();
  await save(K.friendships, friendships.filter(f => f.userId !== userId));
  const p = await getMyProfile();
  await updateMyProfile({ friendsCount: Math.max(0, p.friendsCount - 1) });
  // Disable messaging in existing conversation
  const convs = await getConversations();
  const updated = convs.map(c => c.type === 'buyer_to_buyer' && c.participants.some(p => p.userId === userId) ? { ...c, isFriendshipActive: false } : c);
  await save(K.conversations, updated);
  notify();
}

// ─── Conversations ────────────────────────────────────────────────────────────

export async function getConversations(): Promise<Conversation[]> {
  return load<Conversation[]>(K.conversations, DEMO_CONVS);
}
export async function getConversation(id: string): Promise<Conversation | null> {
  const convs = await getConversations();
  return convs.find(c => c.id === id) ?? null;
}
export async function createOrGetConversation(params: {
  type: ConversationType;
  participant: ConversationParticipant;
  contextOrderId?: string; contextOrderNumber?: string; contextOrderStatus?: string;
  contextProductId?: string; contextProductName?: string; contextSellerName?: string;
}): Promise<Conversation> {
  const convs = await getConversations();
  // For order threads, match by orderId
  if (params.contextOrderId) {
    const existing = convs.find(c => c.contextOrderId === params.contextOrderId);
    if (existing) return existing;
  } else {
    const existing = convs.find(c => c.type === params.type && c.participants.some(p => p.userId === params.participant.userId) && !c.contextOrderId);
    if (existing) return existing;
  }
  const conv: Conversation = {
    id: uid(), type: params.type, participants: [params.participant],
    unreadCount: 0, isFriendshipActive: true, isArchived: false, isRequest: params.type !== 'buyer_to_buyer',
    contextOrderId: params.contextOrderId, contextOrderNumber: params.contextOrderNumber,
    contextOrderStatus: params.contextOrderStatus, contextProductId: params.contextProductId,
    contextProductName: params.contextProductName, contextSellerName: params.contextSellerName,
    updatedAt: iso(),
  };
  await save(K.conversations, [...convs, conv]);
  notify();
  return conv;
}
export async function getMessages(conversationId: string): Promise<Message[]> {
  return load<Message[]>(K.messages(conversationId), DEMO_MESSAGES[conversationId] ?? []);
}
export async function sendMessage(conversationId: string, text: string, attachment?: MessageAttachment): Promise<Message> {
  const msg: Message = {
    id: uid(), conversationId, fromId: MY_USER_ID, fromName: MY_NAME, fromInitials: MY_INITIALS, fromColor: MY_COLOR,
    text, attachment, reactions: [], status: 'sending', ts: Date.now(), deletedForMe: false,
  };
  const msgs = await getMessages(conversationId);
  const updated = [...msgs, msg];
  await save(K.messages(conversationId), updated);
  // Update conversation last message
  const convs = await getConversations();
  const idx = convs.findIndex(c => c.id === conversationId);
  if (idx >= 0) { convs[idx] = { ...convs[idx], lastMessage: text, lastMessageTs: msg.ts, updatedAt: iso() }; await save(K.conversations, convs); }
  notify();
  // Simulate sent after 400ms
  setTimeout(async () => {
    const m2 = await getMessages(conversationId);
    const mi = m2.findIndex(m => m.id === msg.id);
    if (mi >= 0) { m2[mi] = { ...m2[mi], status: 'sent' }; await save(K.messages(conversationId), m2); notify(); }
  }, 400);
  return msg;
}
export async function retryMessage(conversationId: string, messageId: string): Promise<void> {
  const msgs = await getMessages(conversationId);
  const idx = msgs.findIndex(m => m.id === messageId);
  if (idx >= 0) { msgs[idx] = { ...msgs[idx], status: 'sending' }; await save(K.messages(conversationId), msgs); notify(); }
  setTimeout(async () => {
    const m2 = await getMessages(conversationId);
    const mi = m2.findIndex(m => m.id === messageId);
    if (mi >= 0) { m2[mi] = { ...m2[mi], status: 'sent' }; await save(K.messages(conversationId), m2); notify(); }
  }, 800);
}
export async function addReaction(conversationId: string, messageId: string, emoji: string): Promise<void> {
  const msgs = await getMessages(conversationId);
  const idx = msgs.findIndex(m => m.id === messageId);
  if (idx < 0) return;
  const existing = msgs[idx].reactions.findIndex(r => r.fromId === MY_USER_ID && r.emoji === emoji);
  if (existing >= 0) { msgs[idx].reactions.splice(existing, 1); }
  else { msgs[idx].reactions = [...msgs[idx].reactions, { emoji, fromId: MY_USER_ID, fromName: MY_NAME }]; }
  await save(K.messages(conversationId), msgs); notify();
}
export async function deleteMessageForMe(conversationId: string, messageId: string): Promise<void> {
  const msgs = await getMessages(conversationId);
  const idx = msgs.findIndex(m => m.id === messageId);
  if (idx >= 0) { msgs[idx] = { ...msgs[idx], deletedForMe: true }; await save(K.messages(conversationId), msgs); notify(); }
}
export async function markConversationRead(conversationId: string): Promise<void> {
  const convs = await getConversations();
  const updated = convs.map(c => c.id === conversationId ? { ...c, unreadCount: 0 } : c);
  await save(K.conversations, updated); notify();
}
export async function archiveConversation(conversationId: string): Promise<void> {
  const convs = await getConversations();
  await save(K.conversations, convs.map(c => c.id === conversationId ? { ...c, isArchived: true } : c)); notify();
}

// ─── Stories ─────────────────────────────────────────────────────────────────

async function loadStories(): Promise<Story[]> {
  const all = await load<Story[]>(K.stories, DEMO_STORIES);
  return all.filter(s => s.expiresAt > Date.now()); // prune expired
}
export async function getStories(): Promise<Story[]> {
  return loadStories();
}
export async function getMyStories(): Promise<Story[]> {
  const all = await loadStories();
  return all.filter(s => s.authorId === MY_USER_ID);
}
export async function createStory(params: { media: StoryMedia[]; privacy: StoryPrivacySettings; repliesDisabled: boolean; }): Promise<Story> {
  const profile = await getMyProfile();
  const ts = Date.now();
  const story: Story = {
    id: uid(), authorId: MY_USER_ID, authorName: profile.name, authorHandle: '@' + profile.username,
    authorInitials: profile.avatarInitials, authorColor: profile.avatarColor,
    authorAccountType: 'buyer', media: params.media, privacy: params.privacy,
    viewers: [], repliesDisabled: params.repliesDisabled, createdAt: ts, expiresAt: ts + H24,
  };
  const stories = await loadStories();
  await save(K.stories, [...stories, story]); notify();
  return story;
}
export async function trackStoryView(storyId: string): Promise<void> {
  const stories = await loadStories();
  const idx = stories.findIndex(s => s.id === storyId);
  if (idx < 0) return;
  const alreadyViewed = stories[idx].viewers.some(v => v.userId === MY_USER_ID);
  if (!alreadyViewed) {
    stories[idx].viewers = [...stories[idx].viewers, { userId: MY_USER_ID, name: MY_NAME, handle: MY_HANDLE, viewedAt: Date.now() }];
    await save(K.stories, stories); notify();
  }
}
export async function deleteStory(storyId: string): Promise<void> {
  const stories = await loadStories();
  await save(K.stories, stories.filter(s => s.id !== storyId)); notify();
}

// ─── Notifications ────────────────────────────────────────────────────────────

export async function getNotifications(): Promise<Notification[]> {
  return load<Notification[]>(K.notifications, DEMO_NOTIFS);
}
export async function markNotificationRead(id: string): Promise<void> {
  const notifs = await getNotifications();
  await save(K.notifications, notifs.map(n => n.id === id ? { ...n, isRead: true } : n)); notify();
}
export async function markNotificationUnread(id: string): Promise<void> {
  const notifs = await getNotifications();
  await save(K.notifications, notifs.map(n => n.id === id ? { ...n, isRead: false } : n)); notify();
}
export async function deleteNotification(id: string): Promise<void> {
  const notifs = await getNotifications();
  await save(K.notifications, notifs.filter(n => n.id !== id)); notify();
}
export async function muteNotificationCategory(category: NotificationCategory): Promise<void> {
  const notifs = await getNotifications();
  await save(K.notifications, notifs.map(n => n.category === category ? { ...n, isMuted: true } : n)); notify();
}
export async function clearAllReadNotifications(): Promise<void> {
  const notifs = await getNotifications();
  await save(K.notifications, notifs.filter(n => !n.isRead)); notify();
}
export async function getNotificationPreferences(): Promise<NotificationPreference[]> {
  return load<NotificationPreference[]>(K.notifPrefs, DEFAULT_NOTIFICATION_PREFS);
}
export async function updateNotificationPreference(category: NotificationCategory, updates: Partial<Omit<NotificationPreference, 'category'>>): Promise<void> {
  const prefs = await getNotificationPreferences();
  await save(K.notifPrefs, prefs.map(p => p.category === category ? { ...p, ...updates } : p)); notify();
}
export async function addNotification(n: Omit<Notification, 'id' | 'createdAt'>): Promise<void> {
  const notifs = await getNotifications();
  await save(K.notifications, [{ ...n, id: uid(), createdAt: iso() }, ...notifs]); notify();
}

// ─── Blocking & Muting ────────────────────────────────────────────────────────

export async function getBlockedUsers(): Promise<BlockRecord[]> {
  return load<BlockRecord[]>(K.blocks, []);
}
export async function isBlocked(userId: string): Promise<boolean> {
  const blocks = await getBlockedUsers();
  return blocks.some(b => b.blockedUserId === userId);
}
export async function blockUser(params: { userId: string; name: string; handle: string; initials: string; color: string; }): Promise<void> {
  const blocks = await getBlockedUsers();
  if (blocks.some(b => b.blockedUserId === params.userId)) return;
  blocks.unshift({ id: uid(), blockedUserId: params.userId, blockedUserName: params.name, blockedUserHandle: params.handle, blockedUserInitials: params.initials, blockedUserColor: params.color, createdAt: iso() });
  await save(K.blocks, blocks);
  await removeFriend(params.userId);
  notify();
}
export async function unblockUser(userId: string): Promise<void> {
  const blocks = await getBlockedUsers();
  await save(K.blocks, blocks.filter(b => b.blockedUserId !== userId)); notify();
}
export async function getMutedUsers(): Promise<MuteRecord[]> {
  return load<MuteRecord[]>(K.mutes, []);
}
export async function muteUser(params: { userId: string; name: string; handle: string; initials: string; color: string; }): Promise<void> {
  const mutes = await getMutedUsers();
  if (mutes.some(m => m.mutedUserId === params.userId)) return;
  mutes.unshift({ id: uid(), mutedUserId: params.userId, mutedUserName: params.name, mutedUserHandle: params.handle, mutedUserInitials: params.initials, mutedUserColor: params.color, createdAt: iso() });
  await save(K.mutes, mutes); notify();
}
export async function unmuteUser(userId: string): Promise<void> {
  const mutes = await getMutedUsers();
  await save(K.mutes, mutes.filter(m => m.mutedUserId !== userId)); notify();
}

// ─── Reports ─────────────────────────────────────────────────────────────────

export async function submitReport(params: { targetType: ReportTargetType; targetId: string; targetLabel?: string; reason: ReportReason; description: string; blockAfterReport: boolean; blockParams?: { userId: string; name: string; handle: string; initials: string; color: string }; }): Promise<Report> {
  const report: Report = { id: uid(), targetType: params.targetType, targetId: params.targetId, targetLabel: params.targetLabel, reason: params.reason, description: params.description, blockAfterReport: params.blockAfterReport, submittedAt: iso() };
  if (params.blockAfterReport && params.blockParams) await blockUser(params.blockParams);
  return report;
}

// ─── Saved Content ────────────────────────────────────────────────────────────

export async function getSavedItems(): Promise<SavedItem[]> {
  return load<SavedItem[]>(K.saved, DEMO_SAVED);
}
export async function saveItem(params: { type: SavedItemType; targetId: string; title: string; subtitle?: string; accentColor?: string; }): Promise<SavedItem> {
  const items = await getSavedItems();
  const existing = items.find(i => i.targetId === params.targetId);
  if (existing) return existing;
  const item: SavedItem = { id: uid(), savedAt: iso(), ...params };
  await save(K.saved, [item, ...items]);
  const p = await getMyProfile();
  await updateMyProfile({ savedCount: p.savedCount + 1 });
  notify();
  return item;
}
export async function removeSavedItem(targetId: string): Promise<void> {
  const items = await getSavedItems();
  await save(K.saved, items.filter(i => i.targetId !== targetId));
  const p = await getMyProfile();
  await updateMyProfile({ savedCount: Math.max(0, p.savedCount - 1) });
  notify();
}
export async function isItemSaved(targetId: string): Promise<boolean> {
  const items = await getSavedItems();
  return items.some(i => i.targetId === targetId);
}

// ─── Privacy ──────────────────────────────────────────────────────────────────

export async function getPrivacySettings(): Promise<PrivacySettings> {
  return load<PrivacySettings>(K.privacy, DEFAULT_PRIVACY_SETTINGS);
}
export async function updatePrivacySettings(updates: Partial<PrivacySettings>): Promise<PrivacySettings> {
  const current = await getPrivacySettings();
  const next = { ...current, ...updates };
  await save(K.privacy, next); notify();
  return next;
}

// ─── Search ───────────────────────────────────────────────────────────────────

const SEARCH_POOL: ProfileSearchResult[] = [
  { id: 'sr_maya',   userId: 'u_maya',   name: 'Maya Chen',    handle: '@mayachen',    initials: 'MC', color: '#BE185D', accountType: 'buyer',  profileVisibility: 'public',  mutualFriendsCount: 3, isBlocked: false, friendshipStatus: 'accepted' },
  { id: 'sr_jordan', userId: 'u_jordan', name: 'Jordan Lee',   handle: '@jordanlee',   initials: 'JL', color: '#1D4ED8', accountType: 'buyer',  profileVisibility: 'public',  mutualFriendsCount: 2, isBlocked: false, friendshipStatus: 'accepted' },
  { id: 'sr_amir',   userId: 'u_amir',   name: 'Amir Patel',   handle: '@amirpatel',   initials: 'AP', color: '#0F766E', accountType: 'buyer',  profileVisibility: 'public',  mutualFriendsCount: 1, isBlocked: false, friendshipStatus: 'accepted' },
  { id: 'sr_sofia',  userId: 'u_sofia',  name: 'Sofia Reyes',  handle: '@sofiareyes',  initials: 'SR', color: '#B45309', accountType: 'buyer',  profileVisibility: 'private', mutualFriendsCount: 2, isBlocked: false, friendshipStatus: 'accepted' },
  { id: 'sr_kai',    userId: 'u_kai',    name: 'Kai Nakamura', handle: '@kainakamura', initials: 'KN', color: '#00C853', accountType: 'buyer',  profileVisibility: 'public',  mutualFriendsCount: 1, isBlocked: false, friendshipStatus: 'accepted' },
  { id: 'sr_casey',  userId: 'u_casey',  name: 'Casey Park',   handle: '@caseypark',   initials: 'CP', color: '#7C3AED', accountType: 'buyer',  profileVisibility: 'public',  mutualFriendsCount: 2, isBlocked: false },
  { id: 'sr_riley',  userId: 'u_riley',  name: 'Riley Moss',   handle: '@rileymoss',   initials: 'RM', color: '#0891B2', accountType: 'buyer',  profileVisibility: 'public',  mutualFriendsCount: 0, isBlocked: false },
  { id: 'sr_vault',  userId: 'u_vault',  name: 'Vault Studio', handle: '@vaultstudio', initials: 'VS', color: '#00C853', accountType: 'seller', profileVisibility: 'public',  mutualFriendsCount: 0, isBlocked: false },
  { id: 'sr_nxgen',  userId: 'u_nxgen',  name: 'NxGen Drops',  handle: '@nxgendrops',  initials: 'NX', color: '#B45309', accountType: 'seller', profileVisibility: 'public',  mutualFriendsCount: 0, isBlocked: false },
];

export async function searchProfiles(query: string): Promise<ProfileSearchResult[]> {
  if (!query.trim()) return [];
  const q = query.toLowerCase();
  const blocks = await getBlockedUsers();
  const blockedIds = new Set(blocks.map(b => b.blockedUserId));
  return SEARCH_POOL.filter(r =>
    !blockedIds.has(r.userId) &&
    (r.name.toLowerCase().includes(q) || r.handle.toLowerCase().includes(q))
  );
}
