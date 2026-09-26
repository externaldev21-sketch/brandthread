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

export type PreviewMessageAttachmentSeed = {
  type: 'image' | 'video' | 'voice' | 'product' | 'post' | 'order' | 'profile' | 'thread_cash'
    | 'agent_card' | 'quick_replies';
  title?: string;
  subtitle?: string;
  meta?: Record<string, string>;
};

export type PreviewMessageSeed = {
  id: string;
  fromOfficialOrParticipant: 'me' | 'them';
  text: string;
  attachment?: PreviewMessageAttachmentSeed;
  minutesAgo: number;
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
  contextOrderNumber?: string;
  contextProductName?: string;
  /** Marked on exactly one seeded thread — the inbox screen simulates a
   *  transient local "typing…" state for it (preview-only, see
   *  lib/previewInbox.ts's typing-simulation helper). Not a real presence
   *  signal — see the `ConversationParticipant.isOnline` comment in
   *  services/socialTypes.ts. */
  simulateTyping?: boolean;
  messages?: PreviewMessageSeed[];
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
  participantColor: '#0A0A0B',
  isBrandMark: true,
  isPinned: true,
  isOfficial: true,
  lastMessage: 'want me to show you how Thread Cash works?',
  lastMessageFromMe: false,
  minutesAgo: 3,
  unreadCount: 1,
  isRequest: false,
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
    participantColor: '#2E2A26',
    posterIndex: 0,
    lastMessage: 'Just restocked the Sculpted Wool Coat in your size!',
    lastMessageFromMe: false,
    minutesAgo: 6,
    unreadCount: 2,
    isRequest: false,
    messages: [
      { id: 'preview-msg-01-1', fromOfficialOrParticipant: 'them', text: 'Hey! Thanks for your interest in the coat.', minutesAgo: 40 },
      { id: 'preview-msg-01-2', fromOfficialOrParticipant: 'me', text: 'Do you have it in size M?', minutesAgo: 20 },
      { id: 'preview-msg-01-3', fromOfficialOrParticipant: 'them', text: 'Just restocked the Sculpted Wool Coat in your size!', minutesAgo: 6 },
    ],
  },
  {
    id: 'preview-conversation-02',
    participantUserId: 'preview-seller-02',
    participantName: 'Maison Vela',
    participantHandle: '@maison_vela',
    participantInitials: 'MV',
    participantColor: '#8B5CF6',
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
    participantColor: '#111827',
    posterIndex: 2,
    lastMessage: 'Hi! Interested in custom sizing for the tuxedo.',
    lastMessageFromMe: false,
    minutesAgo: 1500,
    unreadCount: 1,
    isRequest: true,
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
    participantColor: '#D6D3D1',
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
    ],
  },
  {
    id: 'preview-conversation-05',
    participantUserId: 'preview-seller-05',
    participantName: 'Kuro Line',
    participantHandle: '@kuro_line',
    participantInitials: 'KL',
    participantColor: '#1F2933',
    posterIndex: 4,
    lastMessage: 'Order #BT-10234',
    lastMessageFromMe: true,
    lastMessageType: 'order',
    minutesAgo: 200,
    unreadCount: 0,
    isRequest: false,
    contextOrderNumber: 'BT-10234',
    messages: [
      { id: 'preview-msg-05-1', fromOfficialOrParticipant: 'them', text: 'Your jacket just shipped!', minutesAgo: 220 },
      {
        id: 'preview-msg-05-2', fromOfficialOrParticipant: 'me', text: '',
        attachment: { type: 'order', title: 'Order #BT-10234', subtitle: 'Shipped · Asymmetric Layer Jacket' },
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
    participantColor: '#6D28D9',
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
    participantColor: '#0EA5E9',
    posterIndex: 6,
    lastMessage: 'Let me check on that for you',
    lastMessageFromMe: false,
    minutesAgo: 1,
    unreadCount: 1,
    isRequest: false,
    simulateTyping: true,
    messages: [
      { id: 'preview-msg-07-1', fromOfficialOrParticipant: 'me', text: 'Does the mesh top run small?', minutesAgo: 2 },
      { id: 'preview-msg-07-2', fromOfficialOrParticipant: 'them', text: 'Let me check on that for you', minutesAgo: 1 },
    ],
  },
  {
    id: 'preview-conversation-08',
    participantUserId: 'preview-seller-08',
    participantName: 'Noma Archive',
    participantHandle: '@noma_archive',
    participantInitials: 'NA',
    participantColor: '#78716C',
    posterIndex: 7,
    lastMessage: 'Would love to know more about the trench!',
    lastMessageFromMe: false,
    minutesAgo: 4000,
    unreadCount: 1,
    isRequest: true,
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
    participantColor: '#0F172A',
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
    participantColor: '#44403C',
    posterIndex: 9,
    lastMessage: 'Hi! Is the silk gown still available in size S?',
    lastMessageFromMe: false,
    minutesAgo: 2800,
    unreadCount: 1,
    isRequest: true,
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
  { id: 'preview-notif-follow-01', actorUserId: 'preview-seller-01', actorName: 'Atelier Noire', actorInitials: 'AN', actorColor: '#2E2A26', isRead: false, minutesAgo: 30 },
  { id: 'preview-notif-follow-02', actorUserId: 'preview-seller-04', actorName: 'Orison', actorInitials: 'OR', actorColor: '#D6D3D1', isRead: false, minutesAgo: 90 },
  { id: 'preview-notif-follow-03', actorUserId: 'preview-seller-07', actorName: 'Astrae', actorInitials: 'AS', actorColor: '#0EA5E9', isRead: true, minutesAgo: 300 },
];
