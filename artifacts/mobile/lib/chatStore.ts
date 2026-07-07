/**
 * chatStore — lightweight module-level chat state.
 * No external deps; uses a pub/sub listener set so any component
 * subscribed via useChatMessages() re-renders when messages change.
 */

export type Message = {
  id: string;
  text: string;
  fromMe: boolean;
  ts: number;        // Unix ms
  status: 'sent' | 'delivered' | 'read';
};

export type Friend = {
  id: string;
  name: string;
  handle: string;
  initials: string;
  color: string;
  online: boolean;
};

// ─── Friend directory ─────────────────────────────────────────────────────────

export const FRIENDS: Record<string, Friend> = {
  maya:   { id: 'maya',   name: 'Maya Chen',    handle: '@mayachen',    initials: 'MC', color: '#BE185D', online: true  },
  jordan: { id: 'jordan', name: 'Jordan Lee',   handle: '@jordanlee',   initials: 'JL', color: '#1D4ED8', online: true  },
  amir:   { id: 'amir',   name: 'Amir Patel',   handle: '@amirpatel',   initials: 'AP', color: '#0F766E', online: false },
  sofia:  { id: 'sofia',  name: 'Sofia Reyes',  handle: '@sofiareyes',  initials: 'SR', color: '#B45309', online: false },
  kai:    { id: 'kai',    name: 'Kai Nakamura', handle: '@kainakamura', initials: 'KN', color: '#7C3AED', online: true  },
};

// ─── Seed conversation data ───────────────────────────────────────────────────

const now = Date.now();
const m = (offset: number) => now - offset * 60_000; // offset in minutes ago

const SEED: Record<string, Message[]> = {
  maya: [
    { id: 'm1', text: 'Omg did you see the Vault Studio drop?? 😭', fromMe: false, ts: m(62), status: 'read' },
    { id: 'm2', text: 'I know!! I\'ve been refreshing since 8am lol', fromMe: true,  ts: m(60), status: 'read' },
    { id: 'm3', text: 'The cargo jacket is so good. Are you getting it?', fromMe: false, ts: m(58), status: 'read' },
    { id: 'm4', text: 'Already in my cart 👀 you should grab it before it sells out', fromMe: true, ts: m(55), status: 'read' },
    { id: 'm5', text: 'Adding to cart rn!! Thanks for the heads up ❤️', fromMe: false, ts: m(53), status: 'read' },
  ],
  jordan: [
    { id: 'j1', text: 'Bro the NxGen archive hoodie is insane', fromMe: false, ts: m(200), status: 'read' },
    { id: 'j2', text: 'Which colorway?', fromMe: true, ts: m(198), status: 'read' },
    { id: 'j3', text: 'The washed black. Just copped it', fromMe: false, ts: m(196), status: 'read' },
    { id: 'j4', text: 'Clean. You\'re definitely gonna get compliments on that', fromMe: true, ts: m(194), status: 'read' },
  ],
  amir: [
    { id: 'a1', text: 'Hey! You into vintage workwear at all?', fromMe: false, ts: m(1440), status: 'read' },
    { id: 'a2', text: 'Yeah big time, why?', fromMe: true, ts: m(1430), status: 'read' },
    { id: 'a3', text: 'Found this amazing brand called Coldform. Check their raw denim jacket', fromMe: false, ts: m(1428), status: 'read' },
    { id: 'a4', text: 'Oh wow that\'s fire. On my wishlist now 🔥', fromMe: true, ts: m(1420), status: 'read' },
  ],
  sofia: [
    { id: 's1', text: 'Rate my wishlist? Just shared it on friends feed', fromMe: false, ts: m(320), status: 'read' },
    { id: 's2', text: 'Saw it! The utility vest is a grail fr', fromMe: true, ts: m(315), status: 'read' },
    { id: 's3', text: 'Right?! Atlas Goods always goes so hard', fromMe: false, ts: m(312), status: 'read' },
  ],
  kai: [
    { id: 'k1', text: 'You see that Meridian drop? The sage tee is so clean', fromMe: false, ts: m(30), status: 'read' },
    { id: 'k2', text: 'Yeah I nearly copped! Held off because I already have like 6 tees lol', fromMe: true, ts: m(28), status: 'read' },
    { id: 'k3', text: 'Lmao same struggle. The colour is different though', fromMe: false, ts: m(5), status: 'delivered' },
  ],
};

// ─── Auto-reply pool ──────────────────────────────────────────────────────────

const REPLIES: Record<string, string[]> = {
  maya: [
    'Okay that\'s actually so good 👀',
    'I\'m literally adding it to my cart right now',
    'You have the best taste I swear',
    'Okay yes let\'s both cop and twin 😂',
    'How\'s the sizing on that one?',
  ],
  jordan: [
    'No way that\'s so clean',
    'Bro I need that in my life',
    'Which colourway are you going for?',
    'Okay you\'re making me want to buy things I don\'t need lol',
    'Is it selling out fast?',
  ],
  amir: [
    'That\'s lowkey fire though',
    'Good call, I\'ve been eyeing that for a while',
    'Is it worth the price?',
    'Okay you\'re a terrible influence haha',
    'Sent you a link to something similar btw',
  ],
  sofia: [
    'YESSS finally someone who gets it',
    'Okay that\'s going straight to my wishlist',
    'I saw that brand at a pop-up last month too!',
    'We should go shopping when the next drop hits',
    'Your fits have been so good lately btw',
  ],
  kai: [
    'Yeah you\'re probably right tbh',
    'Okay that actually convinced me lol',
    'Let me know when you cop!',
    'Solid. I\'m gonna think about it',
    'Have you worn yours yet?',
  ],
};

const replyIndex: Record<string, number> = {};

// ─── Store ────────────────────────────────────────────────────────────────────

const conversations: Record<string, Message[]> = Object.fromEntries(
  Object.entries(SEED).map(([k, v]) => [k, [...v]]),
);
const unread: Record<string, number> = { kai: 1 };
const typing: Set<string> = new Set();
const listeners: Set<() => void> = new Set();

function notify() {
  listeners.forEach(fn => fn());
}

export function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getMessages(friendId: string): Message[] {
  return conversations[friendId] ?? [];
}

export function getLastMessage(friendId: string): Message | null {
  const msgs = conversations[friendId];
  return msgs?.length ? msgs[msgs.length - 1] : null;
}

export function getUnread(friendId: string): number {
  return unread[friendId] ?? 0;
}

export function markRead(friendId: string) {
  unread[friendId] = 0;
  notify();
}

export function isTyping(friendId: string): boolean {
  return typing.has(friendId);
}

export function sendMessage(friendId: string, text: string) {
  if (!conversations[friendId]) conversations[friendId] = [];
  const msg: Message = {
    id: `${Date.now()}_me`,
    text: text.trim(),
    fromMe: true,
    ts: Date.now(),
    status: 'sent',
  };
  conversations[friendId].push(msg);
  notify();

  // Simulate "delivered" after 400ms
  setTimeout(() => {
    msg.status = 'delivered';
    notify();
  }, 400);

  // Simulate typing indicator then auto-reply
  const delay = 1000 + Math.random() * 1400;
  setTimeout(() => {
    typing.add(friendId);
    notify();
    setTimeout(() => {
      typing.delete(friendId);
      const pool = REPLIES[friendId] ?? ['👍'];
      const idx = (replyIndex[friendId] ?? 0) % pool.length;
      replyIndex[friendId] = idx + 1;
      conversations[friendId].push({
        id: `${Date.now()}_reply`,
        text: pool[idx],
        fromMe: false,
        ts: Date.now(),
        status: 'read',
      });
      notify();
    }, 800 + Math.random() * 600);
  }, delay);
}
