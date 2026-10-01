/**
 * Pure seed data for the preview buyer inbox (see lib/previewInbox.ts, which
 * wraps this with the real gating + bundled poster/logo image URIs).
 *
 * This file intentionally imports nothing from `react-native`/`expo-*` so it
 * can be imported directly in Vitest (which cannot transform native/asset
 * modules) — every field here is a plain value, keyed by a `posterIndex`
 * (0-9, into the same 10 fashion preview posters lib/previewCatalog.ts uses)
 * or `isBrandMark: true` for the official Brandthread Agent row, which uses
 * the app's own logo instead of a poster photo.
 */

import { pickAvatarColor } from './avatarColors';

export type PreviewMessageAttachmentSeed = {
  type: 'image' | 'video' | 'voice' | 'product' | 'post' | 'order' | 'profile' | 'thread_cash'
    | 'agent_card' | 'quick_replies';
  title?: string;
  subtitle?: string;
  meta?: Record<string, string>;
};

/** One reaction seeded on a preview message — `type` is a `ReactionType`
 *  (kept as a plain string here so this file stays free of any real-code
 *  imports, per its own doc comment above). */
export type PreviewReactionSeed = { type: string; from: 'me' | 'them' };

export type PreviewMessageSeed = {
  id: string;
  fromOfficialOrParticipant: 'me' | 'them';
  text: string;
  attachment?: PreviewMessageAttachmentSeed;
  minutesAgo: number;
  /** Reactions already on this message when the thread first loads — item
   *  68 (chat reactions glass), demoable under ?bt_preview=buyer. */
  reactionSeed?: PreviewReactionSeed[];
};

export type PreviewConversationSeed = {
  id: string;
  participantUserId: string;
  participantName: string;
  participantHandle: string;
  participantInitials: string;
  participantColor: string;
  posterIndex?: number;
  isBrandMark?: boolean;
  isPinned?: boolean;
  isOfficial?: boolean;
  lastMessage: string;
  lastMessageFromMe: boolean;
  lastMessageType?: PreviewMessageAttachmentSeed['type'];
  minutesAgo: number;
  unreadCount: number;
  isRequest: boolean;
  /** Only meaningful when `isRequest` is true: who started it, relative to
   *  the viewer this seed set renders for — `'them'` (the seeded
   *  participant messaged first; the viewer is the recipient who sees the
   *  Accept/Delete/Block panel) or `'me'` (the viewer sent it first; they
   *  see a read-only "Sent as a request" indicator instead). Omitted on
   *  every non-request seed. */
  requestedBy?: 'me' | 'them';
  contextOrderNumber?: string;
  contextProductName?: string;
  /** Marked ONLY on `BRANDTHREAD_AGENT_SEED` — the inbox screen simulates a
   *  transient local "typing…" state for it (preview-only, see
   *  lib/previewInbox.ts's typing-simulation helper). This mirrors the real
   *  `agentTyping` field on Conversation (services/socialTypes.ts), which the
   *  backend also only ever sets for the Brandthread Agent's thread — it is
   *  not a general per-conversation presence signal, so no ordinary
   *  buyer<->seller seed sets this. */
  simulateTyping?: boolean;
  messages?: PreviewMessageSeed[];
  /** Item 144 (seller chat buyer context panel) — SELLER-side seeds only:
   *  this buyer's other real-shaped order history with this seller, for the
   *  panel to demo a populated state under ?bt_preview=seller. Omitted
   *  entirely on a seed (as on preview-seller-conversation-02) to demo the
   *  panel's real empty state instead — never present-but-empty just to
   *  "look complete". */
  buyerOrders?: PreviewBuyerOrderSeed[];
};

/** One row of a SELLER preview seed's `buyerOrders` — same shape the real
 *  GET /api/orders?buyerId= endpoint returns (see api-server's
 *  routes/orders.ts), so the preview panel and the real one render
 *  identically. */
export type PreviewBuyerOrderSeed = {
  id: string; orderNumber: string; status: string; totalCents: number;
  itemCount: number; daysAgo: number;
};

// The official "Brandthread Agent" AI friend account — pinned above every
// other thread. Mirrors the real welcome copy the api-server sends on
// onboarding completion (see api-server/src/lib/brandthreadAgent.ts) so
// preview and production agree on tone/content.
export const BRANDTHREAD_AGENT_SEED: PreviewConversationSeed = {
  id: 'preview-conversation-brandthread',
  participantUserId: 'brandthread-agent',
  participantName: 'Brandthread Agent',
  participantHandle: '@brandthread',
  participantInitials: 'BT',
  participantColor: pickAvatarColor('brandthread-agent'),
  isBrandMark: true,
  isPinned: true,
  isOfficial: true,
  lastMessage: 'want me to show you how Thread Cash works?',
  lastMessageFromMe: false,
  minutesAgo: 3,
  unreadCount: 1,
  isRequest: false,
  // The ONLY seeded thread that simulates "typing…" — this mirrors the real
  // backend, where `agentTyping` (services/socialTypes.ts) is only ever set
  // for the Brandthread Agent's conversation (see agentTypingUntil in
  // api-server's conversations.ts). An ordinary buyer<->seller thread has no
  // real typing signal today, so preview never fakes one there either.
  simulateTyping: true,
  messages: [
    {
      id: 'preview-msg-brandthread-1',
      fromOfficialOrParticipant: 'them',
      text: 'yo, welcome to Brandthread 👋',
      minutesAgo: 4,
    },
    {
      id: 'preview-msg-brandthread-2',
      fromOfficialOrParticipant: 'them',
      text: "I'm the Brandthread Agent, here 24/7 if you wanna talk fits, find brands, or figure anything out",
      minutesAgo: 3.5,
    },
    {
      id: 'preview-msg-brandthread-3',
      fromOfficialOrParticipant: 'them',
      text: 'want me to show you how Thread Cash works?',
      attachment: {
        type: 'agent_card',
        title: 'How Thread Cash works',
        subtitle: 'Check in daily to earn credit, then stack it as a discount at checkout.',
        meta: { cardKind: 'thread_cash', deepLink: '/thread-cash' },
      },
      minutesAgo: 3,
    },
    {
      id: 'preview-msg-brandthread-4',
      fromOfficialOrParticipant: 'them',
      text: '',
      attachment: {
        type: 'quick_replies',
        meta: {
          optionsJson: JSON.stringify([
            { label: 'Show me Thread Cash', value: 'Show me how Thread Cash works' },
            { label: 'Find me brands', value: "Find me some brands I'd like" },
            { label: 'How do I sell?', value: 'How do I start selling on Brandthread?' },
            { label: 'Just vibing', value: 'Just vibing, no questions right now' },
          ]),
        },
      },
      minutesAgo: 3,
    },
  ],
};

export const PREVIEW_CONVERSATION_SEEDS: PreviewConversationSeed[] = [
  {
    id: 'preview-conversation-01',
    participantUserId: 'preview-seller-01',
    participantName: 'Atelier Noire',
    participantHandle: '@atelier_noire',
    participantInitials: 'AN',
    participantColor: pickAvatarColor('preview-seller-01'),
    posterIndex: 0,
    lastMessage: 'Just restocked the Sculpted Wool Coat in your size!',
    lastMessageFromMe: false,
    minutesAgo: 6,
    unreadCount: 2,
    isRequest: false,
    // Two consecutive-and-close messages on each side (items 1-2 "them",
    // 3-4 "me") demonstrate the grouped-corner rendering (item 67); the
    // last "me" message picks up a "Seen" receipt from the seeded readAt
    // set in lib/previewInbox.ts.
    messages: [
      { id: 'preview-msg-01-1', fromOfficialOrParticipant: 'them', text: 'Hey! Thanks for your interest in the coat.', minutesAgo: 41 },
      {
        id: 'preview-msg-01-1b', fromOfficialOrParticipant: 'them', text: 'It just got restocked in a couple sizes.', minutesAgo: 40,
        // I reacted to their message — demonstrates the glass reaction
        // overlay + pill on an incoming bubble.
        reactionSeed: [{ type: 'love', from: 'me' }],
      },
      { id: 'preview-msg-01-2', fromOfficialOrParticipant: 'me', text: 'Do you have it in size M?', minutesAgo: 20 },
      {
        id: 'preview-msg-01-2b', fromOfficialOrParticipant: 'me', text: 'Asking for a friend too — size S?', minutesAgo: 19.5,
        // They reacted to my message — same data path, other direction, for
        // buyer↔seller cohesion.
        reactionSeed: [{ type: 'like', from: 'them' }],
      },
      { id: 'preview-msg-01-3', fromOfficialOrParticipant: 'them', text: 'Just restocked the Sculpted Wool Coat in your size!', minutesAgo: 6 },
    ],
  },
  {
    id: 'preview-conversation-02',
    participantUserId: 'preview-seller-02',
    participantName: 'Maison Vela',
    participantHandle: '@maison_vela',
    participantInitials: 'MV',
    participantColor: pickAvatarColor('preview-seller-02'),
    posterIndex: 1,
    lastMessage: 'Thank you so much — enjoy the dress!',
    lastMessageFromMe: false,
    minutesAgo: 130,
    unreadCount: 0,
    isRequest: false,
    messages: [
      { id: 'preview-msg-02-1', fromOfficialOrParticipant: 'me', text: 'It arrived today, it\'s gorgeous!', minutesAgo: 140 },
      { id: 'preview-msg-02-2', fromOfficialOrParticipant: 'them', text: 'Thank you so much — enjoy the dress!', minutesAgo: 130 },
    ],
  },
  {
    id: 'preview-conversation-03',
    participantUserId: 'preview-seller-03',
    participantName: 'Saint Rue',
    participantHandle: '@saint_rue',
    participantInitials: 'SR',
    participantColor: pickAvatarColor('preview-seller-03'),
    posterIndex: 2,
    lastMessage: 'Hi! Interested in custom sizing for the tuxedo.',
    lastMessageFromMe: false,
    minutesAgo: 1500,
    unreadCount: 1,
    isRequest: true,
    requestedBy: 'them',
    messages: [
      { id: 'preview-msg-03-1', fromOfficialOrParticipant: 'them', text: 'Hi! Interested in custom sizing for the tuxedo.', minutesAgo: 1500 },
    ],
  },
  {
    id: 'preview-conversation-04',
    participantUserId: 'preview-seller-04',
    participantName: 'Orison',
    participantHandle: '@orison',
    participantInitials: 'OR',
    participantColor: pickAvatarColor('preview-seller-04'),
    posterIndex: 3,
    lastMessage: 'Ivory Column Set',
    lastMessageFromMe: false,
    lastMessageType: 'product',
    minutesAgo: 55,
    unreadCount: 0,
    isRequest: false,
    contextProductName: 'Ivory Column Set',
    messages: [
      { id: 'preview-msg-04-1', fromOfficialOrParticipant: 'them', text: 'Here\'s the set we talked about:', minutesAgo: 56 },
      {
        id: 'preview-msg-04-2', fromOfficialOrParticipant: 'them', text: '',
        attachment: { type: 'product', title: 'Ivory Column Set', subtitle: '$410.00 · Sets', meta: { productId: 'preview-product-04' } },
        minutesAgo: 55,
      },
      { id: 'preview-msg-04-3', fromOfficialOrParticipant: 'me', text: 'Also, is this one still around?', minutesAgo: 40 },
      {
        // Demos the deleted/unavailable-product state (item 70) — a product
        // card whose listing is gone by the time this thread is opened, kept
        // fresh honestly instead of showing its last-known price forever.
        id: 'preview-msg-04-4', fromOfficialOrParticipant: 'me', text: '',
        attachment: {
          type: 'product', title: 'Draped Satin Slip', subtitle: '$260.00 · Dresses',
          meta: { productId: 'preview-product-discontinued', unavailable: 'true' },
        },
        minutesAgo: 39,
      },
    ],
  },
  {
    id: 'preview-conversation-05',
    participantUserId: 'preview-seller-05',
    participantName: 'Kuro Line',
    participantHandle: '@kuro_line',
    participantInitials: 'KL',
    participantColor: pickAvatarColor('preview-seller-05'),
    posterIndex: 4,
    lastMessage: 'Order #BT-10234',
    // The order card is sent BY the seller (Kuro Line) — only a seller can
    // attach their linked order to a reply (see attachLinkedOrder() in
    // app/seller-conversation.tsx / the "order" attachment branch in
    // api-server's routes/conversations.ts, which requires order.ownerId to
    // be the sender). A buyer never sends themselves an order card.
    lastMessageFromMe: false,
    lastMessageType: 'order',
    minutesAgo: 200,
    unreadCount: 0,
    isRequest: false,
    contextOrderNumber: 'BT-10234',
    messages: [
      { id: 'preview-msg-05-1', fromOfficialOrParticipant: 'me', text: 'Hi! Just checking on my jacket order 🙂', minutesAgo: 240 },
      {
        // Order status card (item 71) — live status/tracking normally kept
        // fresh server-side by api-server's lib/orderAttachmentInfo.ts; this
        // preview thread has no backend to re-fetch from, so the meta below
        // (same shape the API enriches onto the real attachment) drives the
        // status badge + Track action directly, the same way item 70's
        // meta.unavailable drives the product card's preview state.
        id: 'preview-msg-05-2', fromOfficialOrParticipant: 'them', text: 'Your jacket just shipped!',
        attachment: {
          type: 'order', title: 'Order #BT-10234',
          meta: {
            orderId: 'preview-order-bt-10234', status: 'shipped',
            trackingNumber: '1Z999AA10123456784', carrier: 'UPS',
            trackingStatus: 'in_transit', estimatedDelivery: '2026-10-02',
          },
        },
        minutesAgo: 200,
      },
    ],
  },
  {
    id: 'preview-conversation-06',
    participantUserId: 'preview-seller-06',
    participantName: 'Forme 22',
    participantHandle: '@forme22',
    participantInitials: 'F2',
    participantColor: pickAvatarColor('preview-seller-06'),
    posterIndex: 5,
    lastMessage: 'Sent you Thread Cash',
    lastMessageFromMe: false,
    lastMessageType: 'thread_cash',
    minutesAgo: 90,
    unreadCount: 1,
    isRequest: false,
    messages: [
      { id: 'preview-msg-06-1', fromOfficialOrParticipant: 'them', text: 'Sorry about the delay — here\'s a little something.', minutesAgo: 91 },
      {
        id: 'preview-msg-06-2', fromOfficialOrParticipant: 'them', text: '',
        attachment: { type: 'thread_cash', meta: { transferId: 'preview-transfer-06', senderId: 'preview-seller-06', amountCents: '500', status: 'pending', note: 'Sorry for the wait!' } },
        minutesAgo: 90,
      },
    ],
  },
  {
    id: 'preview-conversation-07',
    participantUserId: 'preview-seller-07',
    participantName: 'Astrae',
    participantHandle: '@astrae',
    participantInitials: 'AS',
    participantColor: pickAvatarColor('preview-seller-07'),
    posterIndex: 6,
    lastMessage: 'Voice message',
    lastMessageFromMe: true,
    lastMessageType: 'voice',
    minutesAgo: 0.5,
    unreadCount: 1,
    isRequest: false,
    messages: [
      { id: 'preview-msg-07-1', fromOfficialOrParticipant: 'me', text: 'Does the mesh top run small?', minutesAgo: 2 },
      { id: 'preview-msg-07-2', fromOfficialOrParticipant: 'them', text: 'Let me check on that for you', minutesAgo: 1 },
      {
        // Item 74 (photo/video upload progress ring): a completed/resting
        // photo message — see toAttachment()'s `type === 'image'` branch in
        // lib/previewInbox.ts, which fills in a real bundled poster photo as
        // the uri. Demonstrates the RESTING state (no ring — that's only
        // shown while an upload is actually in flight, see
        // app/buyer-conversation.tsx's handlePickPhoto).
        id: 'preview-msg-07-2b', fromOfficialOrParticipant: 'them', text: '',
        attachment: { type: 'image' },
        minutesAgo: 0.9,
      },
      {
        // Item 74 — same treatment for a completed video message.
        id: 'preview-msg-07-2c', fromOfficialOrParticipant: 'me', text: '',
        attachment: { type: 'video', meta: { duration: '14' } },
        minutesAgo: 0.7,
      },
      {
        // Item 73 (voice note waveform playback progress): a real, playable
        // seeded voice bubble — see toAttachment()'s `type === 'voice'`
        // branch in lib/previewInbox.ts for the bundled audio URI + waveform
        // it attaches here.
        id: 'preview-msg-07-3', fromOfficialOrParticipant: 'me', text: '',
        attachment: { type: 'voice' },
        minutesAgo: 0.5,
      },
    ],
  },
  {
    id: 'preview-conversation-08',
    participantUserId: 'preview-seller-08',
    participantName: 'Noma Archive',
    participantHandle: '@noma_archive',
    participantInitials: 'NA',
    participantColor: pickAvatarColor('preview-seller-08'),
    posterIndex: 7,
    lastMessage: 'Would love to know more about the trench!',
    lastMessageFromMe: false,
    minutesAgo: 4000,
    unreadCount: 1,
    isRequest: true,
    requestedBy: 'them',
    messages: [
      { id: 'preview-msg-08-1', fromOfficialOrParticipant: 'them', text: 'Would love to know more about the trench!', minutesAgo: 4000 },
    ],
  },
  {
    id: 'preview-conversation-09',
    participantUserId: 'preview-seller-09',
    participantName: 'Echelon',
    participantHandle: '@echelon',
    participantInitials: 'EC',
    participantColor: pickAvatarColor('preview-seller-09'),
    posterIndex: 8,
    lastMessage: 'It\'s on its way to you now.',
    lastMessageFromMe: false,
    minutesAgo: 0,
    unreadCount: 3,
    isRequest: false,
    messages: [
      { id: 'preview-msg-09-1', fromOfficialOrParticipant: 'me', text: 'Any update on shipping?', minutesAgo: 3 },
      { id: 'preview-msg-09-2', fromOfficialOrParticipant: 'them', text: 'It\'s on its way to you now.', minutesAgo: 0 },
    ],
  },
  {
    id: 'preview-conversation-10',
    participantUserId: 'preview-seller-10',
    participantName: 'Vale Studio',
    participantHandle: '@vale_studio',
    participantInitials: 'VS',
    participantColor: pickAvatarColor('preview-seller-10'),
    posterIndex: 9,
    lastMessage: 'Hi! Is the silk gown still available in size S?',
    lastMessageFromMe: false,
    minutesAgo: 2800,
    unreadCount: 1,
    isRequest: true,
    requestedBy: 'them',
    messages: [
      { id: 'preview-msg-10-1', fromOfficialOrParticipant: 'them', text: 'Hi! Is the silk gown still available in size S?', minutesAgo: 2800 },
    ],
  },
];

// A handful of "new follower" seeds for the redesigned inbox's Follows tab —
// reuses the same preview brand identities so the whole buyer preview reads
// as one consistent world (see lib/previewCatalog.ts).
export const PREVIEW_FOLLOWER_SEEDS: Array<{
  id: string;
  actorUserId: string;
  actorName: string;
  actorInitials: string;
  actorColor: string;
  isRead: boolean;
  minutesAgo: number;
}> = [
  { id: 'preview-notif-follow-01', actorUserId: 'preview-seller-01', actorName: 'Atelier Noire', actorInitials: 'AN', actorColor: pickAvatarColor('preview-seller-01'), isRead: false, minutesAgo: 30 },
  { id: 'preview-notif-follow-02', actorUserId: 'preview-seller-04', actorName: 'Orison', actorInitials: 'OR', actorColor: pickAvatarColor('preview-seller-04'), isRead: false, minutesAgo: 90 },
  { id: 'preview-notif-follow-03', actorUserId: 'preview-seller-07', actorName: 'Astrae', actorInitials: 'AS', actorColor: pickAvatarColor('preview-seller-07'), isRead: true, minutesAgo: 300 },
];

// ─── Seller preview inbox (item 71) ────────────────────────────────────────
//
// Same `PreviewConversationSeed`/`PreviewMessageSeed` shapes as the buyer
// seeds above, but read from the SELLER's side: `participant*` names the
// BUYER the seller is talking to, and `fromOfficialOrParticipant: 'me'`
// means the SELLER's own message. Kept as a separate small seed (not a
// generic role-flip of the whole buyer inbox, which has no buyer identity
// data to flip to) — see lib/previewInbox.ts's getSellerPreviewConversation.
//
// This mirrors preview-conversation-05 above one-for-one — same order
// (BT-10234, meta.orderId 'preview-order-bt-10234'), same shipped status and
// UPS tracking number — so the order card in the buyer preview and the
// seller preview describe the identical order, the way the real shared
// `orders` row backing both sides of a real DM would.
export const SELLER_PREVIEW_CONVERSATION_SEEDS: PreviewConversationSeed[] = [
  {
    // Item 72 (Thread Cash send in chat): a real-looking seeded example on
    // the seller side, matching preview-conversation-06 on the buyer side —
    // same attachment shape, opposite direction (a buyer sent the seller
    // Thread Cash here), so both ?bt_preview= routes render an actual
    // pending send bubble instead of only the buyer side having content.
    id: 'preview-seller-conversation-02',
    participantUserId: 'preview-buyer-02',
    participantName: 'Maya Torres',
    participantHandle: '@mayatorres',
    participantInitials: 'MT',
    participantColor: pickAvatarColor('preview-buyer-02'),
    posterIndex: 2,
    lastMessage: 'Sent you Thread Cash',
    lastMessageFromMe: false,
    lastMessageType: 'thread_cash',
    minutesAgo: 40,
    unreadCount: 1,
    isRequest: false,
    messages: [
      { id: 'preview-seller-msg-02-1', fromOfficialOrParticipant: 'them', text: 'Thanks for holding that for me — here you go!', minutesAgo: 41 },
      {
        id: 'preview-seller-msg-02-2', fromOfficialOrParticipant: 'them', text: '',
        attachment: { type: 'thread_cash', meta: { transferId: 'preview-seller-transfer-02', senderId: 'preview-buyer-02', amountCents: '1000', status: 'pending', note: 'Thanks for holding it!' } },
        minutesAgo: 40,
      },
    ],
  },
  {
    id: 'preview-seller-conversation-01',
    participantUserId: 'preview-buyer-01',
    participantName: 'Ava Chen',
    participantHandle: '@ava.chen',
    participantInitials: 'AC',
    participantColor: pickAvatarColor('preview-buyer-01'),
    posterIndex: 4,
    lastMessage: 'Your jacket just shipped!',
    lastMessageFromMe: true,
    lastMessageType: 'order',
    minutesAgo: 200,
    unreadCount: 0,
    isRequest: false,
    contextOrderNumber: 'BT-10234',
    // Item 144 — Ava's order history with this seller: the jacket order
    // this thread is about (shipped, matches the order-card attachment
    // below) plus one earlier delivered order, so the buyer context panel
    // has more than a single row to demo.
    buyerOrders: [
      { id: 'preview-order-bt-10234', orderNumber: 'BT-10234', status: 'shipped', totalCents: 18800, itemCount: 1, daysAgo: 2 },
      { id: 'preview-order-bt-10112', orderNumber: 'BT-10112', status: 'delivered', totalCents: 6400, itemCount: 2, daysAgo: 34 },
    ],
    messages: [
      { id: 'preview-seller-msg-01-1', fromOfficialOrParticipant: 'them', text: 'Hi! Just checking on my jacket order 🙂', minutesAgo: 240 },
      {
        // Item 73 (voice note waveform playback progress), seller-side
        // mirror of preview-msg-03-2 on the buyer side above — same real
        // bundled voice bubble, rendered here as an incoming message from
        // the buyer (Ava Chen) so the seller preview also has a genuinely
        // playable voice note to demo, not only the buyer preview.
        id: 'preview-seller-msg-01-1b', fromOfficialOrParticipant: 'them', text: '',
        attachment: { type: 'voice' },
        minutesAgo: 239,
      },
      {
        // Item 74 (photo/video upload progress ring), seller-side mirror of
        // preview-msg-07-2b/2c on the buyer side — same real bundled photo/
        // video, so the seller preview also has completed media messages to
        // demo the resting state from, not only the buyer preview.
        id: 'preview-seller-msg-01-1c', fromOfficialOrParticipant: 'them', text: '',
        attachment: { type: 'image' },
        minutesAgo: 210,
      },
      {
        id: 'preview-seller-msg-01-1d', fromOfficialOrParticipant: 'me', text: '',
        attachment: { type: 'video', meta: { duration: '14' } },
        minutesAgo: 205,
      },
      {
        id: 'preview-seller-msg-01-2', fromOfficialOrParticipant: 'me', text: 'Your jacket just shipped!',
        attachment: {
          type: 'order', title: 'Order #BT-10234',
          meta: {
            orderId: 'preview-order-bt-10234', status: 'shipped',
            trackingNumber: '1Z999AA10123456784', carrier: 'UPS',
            trackingStatus: 'in_transit', estimatedDelivery: '2026-10-02',
          },
        },
        minutesAgo: 200,
      },
    ],
  },
  {
    // New DM/message-request routing (every role pair, not just buyer<->
    // buyer): a buyer with no real paid order and no follow-back can now
    // land a seller in Requests too. This demos the SELLER-AS-RECIPIENT
    // side — the buyer messaged first, so the seller sees the Accept/
    // Delete/Block panel (see app/seller-conversation.tsx's isRequestMode).
    id: 'preview-seller-conversation-03',
    participantUserId: 'preview-buyer-03',
    participantName: 'Priya Nair',
    participantHandle: '@priyanair',
    participantInitials: 'PN',
    participantColor: pickAvatarColor('preview-buyer-03'),
    posterIndex: 5,
    lastMessage: 'Hi! Do you do rush alterations before a wedding?',
    lastMessageFromMe: false,
    minutesAgo: 90,
    unreadCount: 1,
    isRequest: true,
    requestedBy: 'them',
    messages: [
      { id: 'preview-seller-msg-03-1', fromOfficialOrParticipant: 'them', text: 'Hi! Do you do rush alterations before a wedding?', minutesAgo: 90 },
    ],
  },
  {
    // The SENDER-side mirror of -03 above: the seller messaged this buyer
    // first (e.g. from their profile) with no existing follow-back or real
    // order between them, so it also lands as a request — server-side this
    // is the exact same `isRequest`/`requestedBy` shape, just with the
    // seller as `requestedBy`. Demos app/seller-conversation.tsx's "Sent as
    // a request" indicator (the seller keeps their normal composer; only
    // the buyer sees the Accept/Delete/Block panel).
    id: 'preview-seller-conversation-04',
    participantUserId: 'preview-buyer-04',
    participantName: 'Jonah Kessler',
    participantHandle: '@jonahk',
    participantInitials: 'JK',
    participantColor: pickAvatarColor('preview-buyer-04'),
    posterIndex: 6,
    lastMessage: 'Hi Jonah — following up on the vintage denim you liked!',
    lastMessageFromMe: true,
    minutesAgo: 60,
    unreadCount: 0,
    isRequest: true,
    requestedBy: 'me',
    messages: [
      { id: 'preview-seller-msg-04-1', fromOfficialOrParticipant: 'me', text: 'Hi Jonah — following up on the vintage denim you liked!', minutesAgo: 60 },
    ],
  },
];
