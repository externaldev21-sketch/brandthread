/**
 * Brandthread Social Service
 * All social features backed by AsyncStorage with in-memory caching.
 * Demo data seeded on first load. Pub/sub for UI reactivity.
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
  BlockRecord, MuteRecord, RestrictRecord, Report, ReportReason, ReportTargetType,
  SavedItem, SavedItemType, PrivacySettings, ProfileSearchResult,
  Comment,
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
  comments:      (postId: string) => `bt:social:comments:${postId}:v1`,
  stories:       'bt:social:stories:v1',
  notifications: 'bt:social:notifs:v1',
  notifPrefs:    'bt:social:notif_prefs:v1',
  blocks:        'bt:social:blocks:v1',
  mutes:         'bt:social:mutes:v1',
  restricts:     'bt:social:restricts:v1',
  saved:         'bt:social:saved:v1',
  privacy:       'bt:social:privacy:v1',
  seeded:        'bt:social:seeded:v1',
  friendLikes:   'bt:social:friend-likes:v1',
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

const DEMO_COMMENTS: Record<string, Comment[]> = {
  post_me_1: [
    { id: 'c1', postId: 'post_me_1', authorId: 'u_maya', authorName: 'Maya Chen', authorHandle: '@mayachen', authorInitials: 'MC', authorColor: '#BE185D', text: 'This fits so well on you!! 😍', likedByMe: false, likesCount: 3, createdAt: new Date(Date.now() - 2 * 3600000).toISOString() },
    { id: 'c2', postId: 'post_me_1', authorId: 'u_kai', authorName: 'Kai Nakamura', authorHandle: '@kainakamura', authorInitials: 'KN', authorColor: '#00C853', text: 'The colorway is everything 🔥', likedByMe: false, likesCount: 1, createdAt: new Date(Date.now() - 90 * 60000).toISOString() },
    { id: 'c3', postId: 'post_me_1', authorId: MY_USER_ID, authorName: MY_NAME, authorHandle: MY_HANDLE, authorInitials: MY_INITIALS, authorColor: MY_COLOR, text: 'Thanks!! Vault really went off with this drop', likedByMe: false, likesCount: 0, replyToId: 'c1', replyToAuthorName: 'Maya Chen', replyToText: 'This fits so well on you!! 😍', createdAt: new Date(Date.now() - 80 * 60000).toISOString() },
    { id: 'c4', postId: 'post_me_1', authorId: 'u_sofia', authorName: 'Sofia Reyes', authorHandle: '@sofiareyes', authorInitials: 'SR', authorColor: '#B45309', text: 'Where did you get it? I cannot find it on the app', likedByMe: false, likesCount: 0, createdAt: new Date(Date.now() - 60 * 60000).toISOString() },
    { id: 'c5', postId: 'post_me_1', authorId: MY_USER_ID, authorName: MY_NAME, authorHandle: MY_HANDLE, authorInitials: MY_INITIALS, authorColor: MY_COLOR, text: 'Search "Canvas Cargo" on Discover — it was a limited drop!', likedByMe: false, likesCount: 2, replyToId: 'c4', replyToAuthorName: 'Sofia Reyes', replyToText: 'Where did you get it? I cannot find it on the app', createdAt: new Date(Date.now() - 45 * 60000).toISOString() },
  ],
  post_me_2: [
    { id: 'd1', postId: 'post_me_2', authorId: 'u_amir', authorName: 'Amir Patel', authorHandle: '@amirpatel', authorInitials: 'AP', authorColor: '#0F766E', text: 'Great review! Did the sizing run true?', likedByMe: false, likesCount: 2, createdAt: new Date(Date.now() - 8 * 3600000).toISOString() },
    { id: 'd2', postId: 'post_me_2', authorId: MY_USER_ID, authorName: MY_NAME, authorHandle: MY_HANDLE, authorInitials: MY_INITIALS, authorColor: MY_COLOR, text: 'Yeah, I went true to size — fits perfectly', likedByMe: false, likesCount: 1, replyToId: 'd1', replyToAuthorName: 'Amir Patel', replyToText: 'Great review! Did the sizing run true?', createdAt: new Date(Date.now() - 7.5 * 3600000).toISOString() },
    { id: 'd3', postId: 'post_me_2', authorId: 'u_kai', authorName: 'Kai Nakamura', authorHandle: '@kainakamura', authorInitials: 'KN', authorColor: '#00C853', text: 'NxGen never misses 🙌', likedByMe: false, likesCount: 5, createdAt: new Date(Date.now() - 6 * 3600000).toISOString() },
  ],
  post_me_3: [
    { id: 'e1', postId: 'post_me_3', authorId: 'u_maya', authorName: 'Maya Chen', authorHandle: '@mayachen', authorInitials: 'MC', authorColor: '#BE185D', text: 'The first one is a 10/10 no debate', likedByMe: false, likesCount: 7, createdAt: new Date(Date.now() - 15 * 3600000).toISOString() },
    { id: 'e2', postId: 'post_me_3', authorId: 'u_sofia', authorName: 'Sofia Reyes', authorHandle: '@sofiareyes', authorInitials: 'SR', authorColor: '#B45309', text: '3rd one lowkey fire too', likedByMe: false, likesCount: 4, createdAt: new Date(Date.now() - 14 * 3600000).toISOString() },
    { id: 'e3', postId: 'post_me_3', authorId: 'u_amir', authorName: 'Amir Patel', authorHandle: '@amirpatel', authorInitials: 'AP', authorColor: '#0F766E', text: 'Add the Vault cargo to this list!', likedByMe: false, likesCount: 2, createdAt: new Date(Date.now() - 12 * 3600000).toISOString() },
    { id: 'e4', postId: 'post_me_3', authorId: MY_USER_ID, authorName: MY_NAME, authorHandle: MY_HANDLE, authorInitials: MY_INITIALS, authorColor: MY_COLOR, text: 'Already on the list 👀', likedByMe: false, likesCount: 3, replyToId: 'e3', replyToAuthorName: 'Amir Patel', replyToText: 'Add the Vault cargo to this list!', createdAt: new Date(Date.now() - 11 * 3600000).toISOString() },
  ],
  // Friend posts on the Friends feed
  fp1: [
    { id: 'f1', postId: 'fp1', authorId: MY_USER_ID, authorName: MY_NAME, authorHandle: MY_HANDLE, authorInitials: MY_INITIALS, authorColor: MY_COLOR, text: 'That colourway is 🔥', likedByMe: false, likesCount: 0, createdAt: new Date(Date.now() - 1.5 * 3600000).toISOString() },
    { id: 'f2', postId: 'fp1', authorId: 'u_kai', authorName: 'Kai Nakamura', authorHandle: '@kainakamura', authorInitials: 'KN', authorColor: '#00C853', text: 'Vault dropping heat this season!', likedByMe: false, likesCount: 2, createdAt: new Date(Date.now() - 60 * 60000).toISOString() },
  ],
  fp2: [
    { id: 'g1', postId: 'fp2', authorId: 'u_sofia', authorName: 'Sofia Reyes', authorHandle: '@sofiareyes', authorInitials: 'SR', authorColor: '#B45309', text: 'Convinced me — ordering tonight', likedByMe: false, likesCount: 3, createdAt: new Date(Date.now() - 4 * 3600000).toISOString() },
    { id: 'g2', postId: 'fp2', authorId: MY_USER_ID, authorName: MY_NAME, authorHandle: MY_HANDLE, authorInitials: MY_INITIALS, authorColor: MY_COLOR, text: "Do it, you won't regret it!", likedByMe: false, likesCount: 1, replyToId: 'g1', replyToAuthorName: 'Sofia Reyes', replyToText: 'Convinced me — ordering tonight', createdAt: new Date(Date.now() - 3.5 * 3600000).toISOString() },
  ],
  fp3: [
    { id: 'h1', postId: 'fp3', authorId: MY_USER_ID, authorName: MY_NAME, authorHandle: MY_HANDLE, authorInitials: MY_INITIALS, authorColor: MY_COLOR, text: '1. 10/10  2. 9/10  3. 8/10  4. 7/10  5. 10/10', likedByMe: false, likesCount: 4, createdAt: new Date(Date.now() - 22 * 3600000).toISOString() },
    { id: 'h2', postId: 'fp3', authorId: 'u_amir', authorName: 'Amir Patel', authorHandle: '@amirpatel', authorInitials: 'AP', authorColor: '#0F766E', text: '#2 is slept on', likedByMe: false, likesCount: 1, createdAt: new Date(Date.now() - 20 * 3600000).toISOString() },
    { id: 'h3', postId: 'fp3', authorId: 'u_maya', authorName: 'Maya Chen', authorHandle: '@mayachen', authorInitials: 'MC', authorColor: '#BE185D', text: 'Agreed, #2 is so underrated', likedByMe: false, likesCount: 2, replyToId: 'h2', replyToAuthorName: 'Amir Patel', replyToText: '#2 is slept on', createdAt: new Date(Date.now() - 19 * 3600000).toISOString() },
  ],
};

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
    ...Object.entries(DEMO_COMMENTS).map(([postId, comments]) => save(K.comments(postId), comments)),
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
export async function unarchivePost(id: string): Promise<void> {
  const posts = await getMyPosts();
  const idx = posts.findIndex(p => p.id === id);
  if (idx >= 0) { posts[idx].isArchived = false; await save(K.posts, posts); notify(); }
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

// ─── Friend-post engagement (likes persisted independently of K.posts) ─────────

type FriendLikeState = { likedByMe: boolean; likesCount: number };

export async function getFriendPostEngagements(): Promise<Record<string, FriendLikeState>> {
  return load<Record<string, FriendLikeState>>(K.friendLikes, {});
}

export async function likeFriendPost(
  postId: string,
  baseLikesCount: number,
  baseLikedByMe: boolean,
): Promise<FriendLikeState> {
  const all = await getFriendPostEngagements();
  const cur = all[postId] ?? { likedByMe: baseLikedByMe, likesCount: baseLikesCount };
  const next: FriendLikeState = {
    likedByMe: !cur.likedByMe,
    likesCount: cur.likedByMe ? cur.likesCount - 1 : cur.likesCount + 1,
  };
  all[postId] = next;
  await save(K.friendLikes, all);
  notify();
  return next;
}
type FriendPostMeta = { authorId: string; authorName: string; authorHandle: string; caption: string };

export async function repostPost(id: string, friendMeta?: FriendPostMeta): Promise<void> {
  const posts = await getMyPosts();
  const idx = posts.findIndex(p => p.id === id);
  const reposts = await load<RepostRecord[]>(K.reposts, []);

  if (idx >= 0) {
    // Own post — toggle repostedByMe flag in the posts store
    posts[idx].repostedByMe = !posts[idx].repostedByMe;
    posts[idx].repostsCount += posts[idx].repostedByMe ? 1 : -1;
    await save(K.posts, posts);
    if (posts[idx].repostedByMe) {
      reposts.unshift({ id: uid(), reposterId: MY_USER_ID, originalPostId: id, originalAuthorId: posts[idx].authorId, originalAuthorName: posts[idx].authorName, originalAuthorHandle: posts[idx].authorHandle, originalCaption: posts[idx].caption, feedEligibility: 'profile_only', createdAt: iso() });
    } else {
      const filtered = reposts.filter(r => !(r.originalPostId === id && r.reposterId === MY_USER_ID));
      reposts.length = 0; reposts.push(...filtered);
    }
  } else {
    // Friend post — not in myPosts; determine state from existing RepostRecord
    const existing = reposts.findIndex(r => r.originalPostId === id && r.reposterId === MY_USER_ID);
    if (existing >= 0) {
      // Currently reposted → unrepost: remove the record
      reposts.splice(existing, 1);
    } else if (friendMeta) {
      // Not yet reposted → repost: create a new record using provided metadata
      reposts.unshift({ id: uid(), reposterId: MY_USER_ID, originalPostId: id, originalAuthorId: friendMeta.authorId, originalAuthorName: friendMeta.authorName, originalAuthorHandle: friendMeta.authorHandle, originalCaption: friendMeta.caption, feedEligibility: 'profile_only', createdAt: iso() });
    }
  }
  await save(K.reposts, reposts);
  notify();

  // Fire-and-forget: log repost interaction to DB for real posts
  try {
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    if (isUUID) {
      serviceRequest('/api/posts/' + id + '/interact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'repost' }),
      }).catch(() => {});
    }
  } catch {
    // ignore errors so local state is always preserved
  }
}

/** Returns a Set of post IDs that the current user has reposted (persisted). */
export async function getRepostedPostIds(): Promise<Set<string>> {
  const reposts = await load<RepostRecord[]>(K.reposts, []);
  return new Set(reposts.filter(r => r.reposterId === MY_USER_ID).map(r => r.originalPostId));
}
export async function getMyReposts(): Promise<RepostRecord[]> {
  return load<RepostRecord[]>(K.reposts, []);
}

// ─── Comments ────────────────────────────────────────────────────────────────

export async function getComments(postId: string): Promise<Comment[]> {
  return load<Comment[]>(K.comments(postId), DEMO_COMMENTS[postId] ?? []);
}

export async function postComment(params: {
  postId: string;
  text: string;
  replyToId?: string;
  replyToAuthorName?: string;
  replyToText?: string;
}): Promise<Comment> {
  const comment: Comment = {
    id: uid(),
    postId: params.postId,
    authorId: MY_USER_ID,
    authorName: MY_NAME,
    authorHandle: MY_HANDLE,
    authorInitials: MY_INITIALS,
    authorColor: MY_COLOR,
    text: params.text.trim(),
    replyToId: params.replyToId,
    replyToAuthorName: params.replyToAuthorName,
    replyToText: params.replyToText,
    likedByMe: false,
    likesCount: 0,
    createdAt: iso(),
  };
  const existing = await getComments(params.postId);
  await save(K.comments(params.postId), [...existing, comment]);
  // Bump commentsCount on the parent post
  const posts = await getMyPosts();
  const idx = posts.findIndex(p => p.id === params.postId);
  if (idx >= 0) {
    posts[idx].commentsCount += 1;
    await save(K.posts, posts);
  }
  notify();
  return comment;
}

export async function likeComment(postId: string, commentId: string): Promise<void> {
  const comments = await getComments(postId);
  const idx = comments.findIndex(c => c.id === commentId);
  if (idx < 0) return;
  comments[idx].likedByMe = !comments[idx].likedByMe;
  comments[idx].likesCount += comments[idx].likedByMe ? 1 : -1;
  await save(K.comments(postId), comments);
  notify();
}

export async function deleteComment(postId: string, commentId: string): Promise<void> {
  const comments = await getComments(postId);
  const next = comments.filter(c => c.id !== commentId);
  await save(K.comments(postId), next);
  const posts = await getMyPosts();
  const idx = posts.findIndex(p => p.id === postId);
  if (idx >= 0) {
    posts[idx].commentsCount = Math.max(0, posts[idx].commentsCount - 1);
    await save(K.posts, posts);
  }
  notify();
}

// ─── Seller posts (Thread-eligible) ──────────────────────────────────────────

const SELLER_POSTS_KEY = 'bt:social:seller-posts:v1';
const SELLER_SEED_KEY  = 'bt:social:seller-posts:seeded:v1';

export interface SellerPostProductTag {
  productId:   string;
  productName: string;
  price:       number;
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
  visibility:        { allowComments: boolean; allowReposts: boolean; showLikeCount: boolean };
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
}

// ─── Seed data ─────────────────────────────────────────────────────────────────

const SELLER_POSTS_SEED: SellerThreadPost[] = [
  {
    id: 'sp_seed_001', authorId: 'u_dropsociety', authorAccountType: 'seller',
    authorName: 'Drop Society', authorHandle: '@dropsociety', authorInitials: 'DS', authorColor: '#7C3AED',
    sellerId: 'seller_dropsociety', brandId: 'brand_dropsociety', feedEligibility: 'thread_eligible',
    caption: 'Limited-run canvas jacket just dropped. 50 units. First come, first served. Tap the bag to shop.',
    hashtags: ['#streetwear', '#newdrop', '#limitededition', '#brandthread'],
    mediaUris: ['https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/720/Big_Buck_Bunny_720_10s_1MB.mp4'],
    aspectRatio: '9:16', contentType: 'video', postStatus: 'published',
    isDraft: false, isArchived: false, isDeleted: false,
    productTags: [{ productId: 'prod_canvas_jacket', productName: 'Canvas Cargo Jacket', price: 189 }],
    visibility: { allowComments: true, allowReposts: true, showLikeCount: true },
    scheduledAt: null, publishedAt: '2026-07-10T15:00:00Z',
    createdAt: '2026-07-10T14:22:00Z', updatedAt: '2026-07-10T15:00:00Z',
    likesCount: 1240, commentsCount: 48, repostsCount: 118, savedCount: 230,
    likedByMe: false, savedByMe: false, repostedByMe: false,
  },
  {
    id: 'sp_seed_002', authorId: 'u_formstudio', authorAccountType: 'seller',
    authorName: 'FORM Studio', authorHandle: '@formstudio', authorInitials: 'FS', authorColor: '#0F766E',
    sellerId: 'seller_formstudio', brandId: 'brand_formstudio', feedEligibility: 'thread_eligible',
    caption: 'Minimalist tees. Eight colorways. Basics done right — tap to shop.',
    hashtags: ['#minimalist', '#essentials', '#tees', '#brandthread'],
    mediaUris: ['https://test-videos.co.uk/vids/sintel/mp4/h264/720/Sintel_720_10s_1MB.mp4'],
    aspectRatio: '9:16', contentType: 'video', postStatus: 'published',
    isDraft: false, isArchived: false, isDeleted: false,
    productTags: [{ productId: 'prod_essential_tee', productName: 'Essential Relaxed Tee', price: 48 }],
    visibility: { allowComments: true, allowReposts: true, showLikeCount: true },
    scheduledAt: null, publishedAt: '2026-07-09T12:00:00Z',
    createdAt: '2026-07-09T11:30:00Z', updatedAt: '2026-07-09T12:00:00Z',
    likesCount: 892, commentsCount: 22, repostsCount: 44, savedCount: 160,
    likedByMe: false, savedByMe: false, repostedByMe: false,
  },
  {
    id: 'sp_seed_003', authorId: 'u_midnight', authorAccountType: 'seller',
    authorName: 'Midnight Thread', authorHandle: '@midnightthread', authorInitials: 'MT', authorColor: '#B45309',
    sellerId: 'seller_midnight', brandId: 'brand_midnight', feedEligibility: 'thread_eligible',
    caption: 'The cargo trousers everyone asked about. Back in stock. Limited sizes remaining.',
    hashtags: ['#cargo', '#restock', '#streetwear', '#brandthread'],
    mediaUris: ['https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4'],
    aspectRatio: '9:16', contentType: 'video', postStatus: 'published',
    isDraft: false, isArchived: false, isDeleted: false,
    productTags: [{ productId: 'prod_ripstop_cargo', productName: 'Ripstop Cargo Trousers', price: 134 }],
    visibility: { allowComments: true, allowReposts: true, showLikeCount: true },
    scheduledAt: null, publishedAt: '2026-07-08T18:00:00Z',
    createdAt: '2026-07-08T17:00:00Z', updatedAt: '2026-07-08T18:00:00Z',
    likesCount: 3410, commentsCount: 91, repostsCount: 215, savedCount: 540,
    likedByMe: false, savedByMe: false, repostedByMe: false,
  },
];

async function ensureSellerPostsSeed(): Promise<void> {
  const done = await load<boolean>(SELLER_SEED_KEY, false);
  if (done) return;
  const existing = await load<SellerThreadPost[]>(SELLER_POSTS_KEY, []);
  if (existing.length === 0) {
    await save(SELLER_POSTS_KEY, SELLER_POSTS_SEED);
  }
  await save(SELLER_SEED_KEY, true);
}

// ─── CRUD ──────────────────────────────────────────────────────────────────────

export async function createSellerPost(params: {
  contentType: string;
  caption: string;
  hashtags: string[];
  /** Curated style-taxonomy tags (from StyleTagsPicker). Stored separately from freeform hashtags. */
  styleTags?: string[];
  mediaUris?: string[];
  thumbnailUri?: string;
  aspectRatio?: '9:16' | '3:4' | '1:1';
  productTags?: SellerPostProductTag[];
  /** @deprecated use productTags instead */
  productTagIds?: string[];
  sound?: SellerPostSound | null;
  visibility?: { allowComments: boolean; allowReposts: boolean; showLikeCount: boolean };
  isDraft?: boolean;
  scheduledAt?: string | null;
}): Promise<SellerThreadPost> {
  await ensureSellerPostsSeed();
  const profile = await getMyProfile();
  const existing = await load<SellerThreadPost[]>(SELLER_POSTS_KEY, []);
  const isDraft = params.isDraft ?? false;
  const now = iso();
  const post: SellerThreadPost = {
    id: uid(),
    authorId: MY_USER_ID,
    authorAccountType: 'seller',
    authorName: profile.name,
    authorHandle: '@' + profile.username,
    authorInitials: profile.avatarInitials,
    authorColor: profile.avatarColor,
    sellerId: MY_USER_ID,
    brandId: MY_USER_ID,
    feedEligibility: 'thread_eligible',
    caption: params.caption,
    hashtags: params.hashtags,
    mediaUris: params.mediaUris ?? [],
    thumbnailUri: params.thumbnailUri,
    aspectRatio: params.aspectRatio ?? '9:16',
    contentType: params.contentType,
    postStatus: isDraft ? 'draft' : (params.scheduledAt ? 'scheduled' : 'published'),
    isDraft,
    isArchived: false,
    isDeleted: false,
    sound: params.sound ?? undefined,
    productTags: params.productTags ?? [],
    visibility: params.visibility ?? { allowComments: true, allowReposts: true, showLikeCount: true },
    scheduledAt: params.scheduledAt ?? null,
    publishedAt: !isDraft ? now : undefined,
    createdAt: now,
    updatedAt: now,
    likesCount: 0, commentsCount: 0, repostsCount: 0, savedCount: 0,
    likedByMe: false, savedByMe: false, repostedByMe: false,
  };
  await save(SELLER_POSTS_KEY, [post, ...existing]);
  notify();
  // Fire-and-forget to real API
  serviceRequest('/api/posts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      mediaUrl: params.mediaUris?.[0],
      mediaType: params.contentType,
      caption: params.caption,
      styleTags: params.styleTags ?? [],
      taggedProductIds: (params.productTags ?? []).map(t => t.productId).filter(id => /^[0-9a-f-]{36}$/i.test(id)),
    }),
  }).catch(() => {});
  return post;
}

export async function updateSellerPost(
  id: string,
  patch: Partial<Pick<SellerThreadPost,
    'caption' | 'hashtags' | 'mediaUris' | 'thumbnailUri' | 'aspectRatio' |
    'contentType' | 'postStatus' | 'isDraft' | 'isArchived' | 'isDeleted' |
    'sound' | 'productTags' | 'visibility' | 'scheduledAt' | 'publishedAt'
  >>,
): Promise<void> {
  await ensureSellerPostsSeed();
  const posts = await load<SellerThreadPost[]>(SELLER_POSTS_KEY, []);
  const idx = posts.findIndex(p => p.id === id);
  if (idx < 0) return;
  posts[idx] = { ...posts[idx], ...patch, updatedAt: iso() };
  await save(SELLER_POSTS_KEY, posts);
  notify();
}

export async function archiveSellerPost(id: string): Promise<void> {
  await updateSellerPost(id, { isArchived: true, postStatus: 'archived' });
}

export async function deleteSellerPost(id: string): Promise<void> {
  await updateSellerPost(id, { isDeleted: true, postStatus: 'deleted' });
}

export async function likeSellerPost(id: string): Promise<void> {
  const posts = await load<SellerThreadPost[]>(SELLER_POSTS_KEY, []);
  const idx = posts.findIndex(p => p.id === id);
  if (idx < 0) return;
  const liked = !posts[idx].likedByMe;
  posts[idx] = { ...posts[idx], likedByMe: liked, likesCount: posts[idx].likesCount + (liked ? 1 : -1), updatedAt: iso() };
  await save(SELLER_POSTS_KEY, posts);
  notify();
}

export async function saveSellerPost(id: string): Promise<void> {
  const posts = await load<SellerThreadPost[]>(SELLER_POSTS_KEY, []);
  const idx = posts.findIndex(p => p.id === id);
  if (idx < 0) return;
  const saved = !posts[idx].savedByMe;
  posts[idx] = { ...posts[idx], savedByMe: saved, savedCount: posts[idx].savedCount + (saved ? 1 : -1), updatedAt: iso() };
  await save(SELLER_POSTS_KEY, posts);
  notify();
}

export async function getSellerPosts(): Promise<SellerThreadPost[]> {
  // Try real API first so sellers see their actual published posts
  try {
    const apiPosts = await serviceRequest('/api/posts') as any[];
    if (Array.isArray(apiPosts) && apiPosts.length > 0) {
      const now = iso();
      const mapped: SellerThreadPost[] = apiPosts.map(p => ({
        id:              p.id,
        sellerId:        p.ownerId        ?? MY_USER_ID,
        brandId:         p.ownerId        ?? MY_USER_ID,
        feedEligibility: 'thread_eligible' as const,
        caption:         p.caption        ?? '',
        hashtags:        p.hashtags       ?? [],
        mediaUris:       p.mediaUrl       ? [p.mediaUrl] : (p.mediaUris ?? []),
        thumbnailUri:    p.thumbnailUrl   ?? p.thumbnailUri ?? undefined,
        aspectRatio:     (p.aspectRatio   ?? '9:16') as SellerThreadPost['aspectRatio'],
        contentType:     (p.mediaType     ?? 'video') as SellerThreadPost['contentType'],
        postStatus:      'published'      as const,
        isDraft:         false,
        isArchived:      false,
        isDeleted:       false,
        sound:           undefined,
        productTags:     p.taggedProducts ?? [],
        visibility:      { allowComments: true, allowReposts: true, showLikeCount: true },
        scheduledAt:     null,
        publishedAt:     p.createdAt      ?? now,
        createdAt:       p.createdAt      ?? now,
        updatedAt:       p.updatedAt      ?? now,
        likesCount:      p.likesCount     ?? 0,
        commentsCount:   p.commentsCount  ?? 0,
        repostsCount:    p.repostsCount   ?? 0,
        savedCount:      0,
        likedByMe:       p.likedByMe      ?? false,
        savedByMe:       false,
        repostedByMe:    false,
      }));
      await save(SELLER_POSTS_KEY, mapped);
      return mapped;
    }
  } catch {
    // Fall through to local cache
  }
  // Fall back to AsyncStorage (cached real data or demo seeds on first run)
  await ensureSellerPostsSeed();
  return load<SellerThreadPost[]>(SELLER_POSTS_KEY, []);
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
    hashtags:          p.styleTags ?? [],
    mediaUris:         p.mediaUrl  ? [p.mediaUrl] : [],
    thumbnailUri:      undefined,
    aspectRatio:       '9:16' as SellerThreadPost['aspectRatio'],
    contentType:       (p.mediaType ?? 'video') as SellerThreadPost['contentType'],
    postStatus:        'published' as const,
    isDraft:           false,
    isArchived:        false,
    isDeleted:         false,
    sound:             undefined,
    productTags:       (p.taggedProducts ?? []).map((t: any) => ({
      productId:   t.productId,
      productName: t.name ?? '',
      price:       0,
    })),
    visibility:    { allowComments: true, allowReposts: true, showLikeCount: true },
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
    repostedByMe:  false,
  };
}

/** Returns published posts from sellers the buyer follows, for the buyer Thread feed.
 *  Primary source: GET /api/posts/feed (requires auth — buyer Clerk token).
 *  Returns an empty array when the buyer follows no sellers with posts, or when
 *  the API is unavailable. Never falls back to demo data.
 */
export async function getThreadPosts(): Promise<SellerThreadPost[]> {
  try {
    const apiPosts = await serviceRequest('/api/posts/feed') as any[];
    if (Array.isArray(apiPosts)) {
      // Map all results (empty array = buyer follows no sellers that have posted)
      return apiPosts.map((p, idx) => mapApiPostToSellerThreadPost(p, idx));
    }
  } catch {
    // API unreachable — return empty rather than surfacing demo content
  }
  return [];
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

/**
 * Returns true if userId is in the current user's Close Friends list.
 * The list is stored locally under bt:close-friends:v1 and managed in
 * the buyer-close-friends screen. Use this to gate Close Friends-only
 * content visibility when displaying posts from other users.
 */
export async function isCloseFriendOf(userId: string): Promise<boolean> {
  try {
    const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
    const raw = await AsyncStorage.getItem('bt:close-friends:v1');
    if (!raw) return false;
    const ids: string[] = JSON.parse(raw);
    return Array.isArray(ids) && ids.includes(userId);
  } catch { return false; }
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
  try {
    const remote = await serviceRequest<Conversation[]>('/api/conversations');
    // Only use API result if it has data — empty means first-login DB (fall back to local demo data)
    if (Array.isArray(remote) && remote.length > 0) {
      await save(K.conversations, remote); // cache for offline / next-launch use
      return remote;
    }
  } catch { /* fall through to local */ }
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
  try {
    const conv = await serviceRequest<Conversation>('/api/conversations', {
      method: 'POST',
      body: JSON.stringify({
        type: params.type ?? 'buyer_to_seller',
        participant: {
          userId: params.participant.userId, name: params.participant.name,
          handle: params.participant.handle ?? '', initials: params.participant.initials ?? '',
          color: params.participant.color ?? '#8B5CF6', accountType: params.participant.accountType ?? 'seller',
        },
        myInfo: { name: MY_NAME, handle: MY_HANDLE, initials: MY_INITIALS, color: MY_COLOR, accountType: 'buyer' },
        contextOrderId: params.contextOrderId, contextOrderNumber: params.contextOrderNumber,
        contextOrderStatus: params.contextOrderStatus, contextProductId: params.contextProductId,
        contextProductName: params.contextProductName, contextSellerName: params.contextSellerName,
      }),
    });
    notify();
    return conv;
  } catch { /* fall through to existing local logic */ }
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
  try {
    const remote = await serviceRequest<Message[]>(`/api/conversations/${conversationId}/messages`);
    // Only use API result if it has data — empty means conversation not yet in DB (use local demo/cached)
    if (Array.isArray(remote) && remote.length > 0) {
      await save(K.messages(conversationId), remote); // cache for offline use
      return remote;
    }
  } catch { /* fall through to local */ }
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
  // Send to API in background; update status on success or failure
  serviceRequest(`/api/conversations/${conversationId}/messages`, { method: 'POST', body: JSON.stringify({ text, attachment }) })
    .then(async (apiMsg: any) => {
      const m2 = await load<Message[]>(K.messages(conversationId), []);
      const mi = m2.findIndex(m => m.id === msg.id);
      if (mi >= 0) { m2[mi] = { ...m2[mi], id: apiMsg?.id ?? m2[mi].id, status: 'delivered' }; await save(K.messages(conversationId), m2); notify(); }
    })
    .catch(async () => {
      const m2 = await load<Message[]>(K.messages(conversationId), []);
      const mi = m2.findIndex(m => m.id === msg.id);
      if (mi >= 0) { m2[mi] = { ...m2[mi], status: 'failed' }; await save(K.messages(conversationId), m2); notify(); }
    });
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
  serviceRequest(`/api/conversations/${conversationId}/read`, { method: 'PATCH', body: JSON.stringify({}) }).catch(() => {});
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
  try {
    const remote = await serviceRequest<Notification[]>('/api/buyer/notifications');
    // Only use API result if it has data — empty means first-login DB (fall back to local demo data)
    if (Array.isArray(remote) && remote.length > 0) {
      await save(K.notifications, remote); // cache for offline / next-launch use
      return remote;
    }
  } catch { /* fall through to local */ }
  return load<Notification[]>(K.notifications, DEMO_NOTIFS);
}
export async function markNotificationRead(id: string): Promise<void> {
  serviceRequest('/api/buyer/notifications/' + encodeURIComponent(id) + '/read', { method: 'PATCH', body: JSON.stringify({}) }).catch(() => {});
  const notifs = await getNotifications();
  await save(K.notifications, notifs.map(n => n.id === id ? { ...n, isRead: true } : n)); notify();
}
export async function markNotificationUnread(id: string): Promise<void> {
  const notifs = await getNotifications();
  await save(K.notifications, notifs.map(n => n.id === id ? { ...n, isRead: false } : n)); notify();
}
export async function deleteNotification(id: string): Promise<void> {
  try {
    await serviceRequest('/api/buyer/notifications/' + encodeURIComponent(id), { method: 'DELETE' });
    const notifs = await getNotifications();
    await save(K.notifications, notifs.filter(n => n.id !== id));
    notify(); return;
  } catch { /* fall through to existing local logic */ }
  const notifs = await getNotifications();
  await save(K.notifications, notifs.filter(n => n.id !== id)); notify();
}
export async function muteNotificationCategory(category: NotificationCategory): Promise<void> {
  const notifs = await getNotifications();
  await save(K.notifications, notifs.map(n => n.category === category ? { ...n, isMuted: true } : n)); notify();
}
export async function clearAllReadNotifications(): Promise<void> {
  try {
    await serviceRequest('/api/buyer/notifications/read-all', { method: 'PATCH', body: JSON.stringify({}) });
    const notifs = await getNotifications();
    await save(K.notifications, notifs.filter(n => !n.isRead));
    notify(); return;
  } catch { /* fall through to existing local logic */ }
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

// ─── Restriction ─────────────────────────────────────────────────────────────

export async function getRestrictedUsers(): Promise<RestrictRecord[]> {
  return load<RestrictRecord[]>(K.restricts, []);
}
export async function restrictUser(params: { userId: string; name: string; handle: string; initials: string; color: string; }): Promise<void> {
  const restricts = await getRestrictedUsers();
  if (restricts.some(r => r.restrictedUserId === params.userId)) return;
  restricts.unshift({ id: uid(), restrictedUserId: params.userId, restrictedUserName: params.name, restrictedUserHandle: params.handle, restrictedUserInitials: params.initials, restrictedUserColor: params.color, createdAt: iso() });
  await save(K.restricts, restricts); notify();
}
export async function unrestrictUser(userId: string): Promise<void> {
  const restricts = await getRestrictedUsers();
  await save(K.restricts, restricts.filter(r => r.restrictedUserId !== userId)); notify();
}

// ─── Reports ─────────────────────────────────────────────────────────────────

export async function submitReport(params: { targetType: ReportTargetType; targetId: string; targetLabel?: string; reason: ReportReason; description: string; blockAfterReport: boolean; blockParams?: { userId: string; name: string; handle: string; initials: string; color: string }; }): Promise<Report> {
  const report: Report = { id: uid(), targetType: params.targetType, targetId: params.targetId, targetLabel: params.targetLabel, reason: params.reason, description: params.description, blockAfterReport: params.blockAfterReport, submittedAt: iso() };
  if (params.blockAfterReport && params.blockParams) await blockUser(params.blockParams);
  return report;
}

// ─── Saved Content ────────────────────────────────────────────────────────────

export async function getSavedItems(): Promise<SavedItem[]> {
  try {
    const remote = await serviceRequest<SavedItem[]>('/api/buyer/saved');
    // Only use API result if it has data — empty means first-login DB (fall back to local demo data)
    if (Array.isArray(remote) && remote.length > 0) {
      await save(K.saved, remote); // cache for offline / next-launch use
      return remote;
    }
  } catch { /* fall through to local */ }
  return load<SavedItem[]>(K.saved, DEMO_SAVED);
}
export async function saveItem(params: { type: SavedItemType; targetId: string; title: string; subtitle?: string; accentColor?: string; }): Promise<SavedItem> {
  try {
    const saved = await serviceRequest<SavedItem>('/api/buyer/saved', { method: 'POST', body: JSON.stringify(params) });
    notify();
    return saved;
  } catch { /* fall through to existing local logic */ }
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
  try {
    await serviceRequest('/api/buyer/saved/' + encodeURIComponent(targetId), { method: 'DELETE' });
    notify();
    return;
  } catch { /* fall through to existing local logic */ }
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
