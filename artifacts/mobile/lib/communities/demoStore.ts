/**
 * Lively demo community data — ONLY ever used when the dev web preview is
 * opened with `&demo=1` (see useCommunityClient: `isPreviewDemoMode()`). It
 * never runs for a real account and never in the default fresh preview.
 *
 * It is a tiny in-memory store with the same shape the API returns, so the
 * exact same screens render it: join/leave/mute work locally, messages you
 * send appear, and a scripted "people are talking" loop posts new messages
 * into open chats so the realtime path is visible in screenshots.
 */
import type {
  Community, CommunityEvent, CommunityMember, CommunityMessage, CommunityReaction,
} from './types';

const NOW = Date.now();
const MIN = 60_000;

type Person = { id: string; name: string; handle: string; accountType: 'seller' | 'buyer'; role?: 'owner' | 'admin' | 'member' };
const PEOPLE: Person[] = [
  { id: 'demo-mara', name: 'Mara Okafor', handle: '@maradesigns', accountType: 'seller', role: 'admin' },
  { id: 'demo-theo', name: 'Theo Lindqvist', handle: '@theo.studio', accountType: 'buyer' },
  { id: 'demo-jules', name: 'Jules Ferreira', handle: '@julesmakes', accountType: 'seller' },
  { id: 'demo-priya', name: 'Priya Nair', handle: '@priyanair', accountType: 'buyer' },
  { id: 'demo-kofi', name: 'Kofi Mensah', handle: '@kofi.threads', accountType: 'seller', role: 'admin' },
  { id: 'demo-luca', name: 'Luca Bianchi', handle: '@lucab', accountType: 'buyer' },
];
export const DEMO_ME_ID = 'demo-me';

const initials = (name: string) => name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
const GRAYS = ['#3A3A3C', '#48484A', '#636366', '#8E8E93', '#AEAEB2'];
const gray = (id: string) => GRAYS[[...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 0) % GRAYS.length];

function community(partial: Partial<Community> & Pick<Community, 'id' | 'name' | 'slug' | 'description' | 'memberCount'>): Community {
  return {
    kind: 'official', verified: true, visibility: 'public', requireApproval: false, joined: false, role: null,
    muted: false, unreadCount: 0, createdAt: new Date(NOW - 90 * 24 * 60 * MIN).toISOString(), ...partial,
  };
}

const COMMUNITIES: Community[] = [
  community({ id: 'demo-c-graphic', name: 'Graphic Design Community', slug: 'graphic-design', iconKey: 'pen-tool', memberCount: 12480, description: 'Logos, type, layouts and print-ready files. Share work, get feedback.' }),
  community({ id: 'demo-c-photo', name: 'Photography & Content', slug: 'photography-content', iconKey: 'camera', memberCount: 8915, description: 'Product shots, lookbooks, reels and everything content.' }),
  community({ id: 'demo-c-ads', name: 'Ads & Marketing', slug: 'ads-marketing', iconKey: 'trending-up', memberCount: 10342, description: "What's converting, what's not, and the tactics behind it." }),
  community({ id: 'demo-c-creative', name: 'Creative Direction', slug: 'creative-direction', iconKey: 'compass', memberCount: 5207, description: 'Concepts, moodboards and building a brand people remember.' }),
  community({ id: 'demo-c-founders', name: 'Streetwear Founders', slug: 'streetwear-founders', iconKey: 'shopping-bag', memberCount: 9861, description: 'Founders talking drops, pricing and growing a label.' }),
  community({ id: 'demo-c-sourcing', name: 'Sourcing & Manufacturing', slug: 'sourcing-manufacturing', iconKey: 'package', memberCount: 6733, description: 'Factories, fabrics, samples and getting production right.' }),
  community({ id: 'demo-c-denim', name: 'Raw Denim Heads', slug: 'raw-denim-heads', kind: 'user', verified: false, iconKey: 'scissors', memberCount: 1842, description: 'Fades, washes, and selvedge talk.' }),
  community({ id: 'demo-c-embroidery', name: 'Embroidery & Patches', slug: 'embroidery-patches', kind: 'user', verified: false, iconKey: 'feather', memberCount: 764, description: 'Digitizing, thread choices and patch suppliers.' }),
];

const say = (id: string, seq: number, p: Person, minsAgo: number, text: string, extra: Partial<CommunityMessage> = {}): CommunityMessage => ({
  id, communityId: '', seq, fromId: p.id, fromName: p.name, fromHandle: p.handle, fromInitials: initials(p.name),
  fromColor: gray(p.id), fromAccountType: p.accountType, fromMemberRole: p.role ?? 'member',
  text, attachments: [], reactions: [], ts: NOW - minsAgo * MIN, ...extra,
});

const [MARA, THEO, JULES, PRIYA, KOFI, LUCA] = PEOPLE;

const SCRIPTS: Record<string, CommunityMessage[]> = {
  'demo-c-graphic': [
    say('g1', 1, MARA, 190, 'Reminder: export print files at 300dpi with 0.125" bleed. Screen-res art is the #1 reason tees come back blurry.'),
    say('g2', 2, THEO, 171, 'Anyone using Figma variables for colorways? Trying to ship 6 tee colors from one master file'),
    say('g3', 3, JULES, 168, 'Yes — one frame per garment color, variables for ink colors. Saves me hours', { replyToId: 'g2', replyToAuthorName: 'Theo Lindqvist', replyPreview: 'Anyone using Figma variables for colorways? Trying to ship 6 tee colors…' }),
    say('g4', 4, PRIYA, 120, 'Dropping a gem: vectorize your logo BEFORE you send it to a manufacturer. Screen printers charge extra to clean it up 💎'),
    say('g5', 5, KOFI, 64, 'Type tip — pair one loud display face with a boring grotesk. Never two loud ones'),
    say('g6', 6, LUCA, 12, 'Just finished my first puff-print mockup, will share tomorrow 🔥'),
  ],
  'demo-c-photo': [
    say('p1', 1, KOFI, 240, 'Natural light from a north-facing window beats any ring light for fabric texture'),
    say('p2', 2, PRIYA, 93, 'Flat-lay on a $6 foam board from the craft store. Zero glare, infinite backgrounds'),
    say('p3', 3, MARA, 30, 'Reels under 12s are outperforming everything else on my last 3 drops'),
  ],
  'demo-c-ads': [
    say('a1', 1, JULES, 300, 'Our best-performing creative this month was a raw iPhone unboxing. Zero polish.'),
    say('a2', 2, THEO, 210, 'CPMs are brutal right now. Retargeting 3-day viewers still converts 4x for us'),
    say('a3', 3, KOFI, 58, 'Test 5 hooks, 1 offer. Not the other way around.'),
  ],
  'demo-c-creative': [say('cr1', 1, MARA, 600, 'Moodboard first, logo last. Always.')],
  'demo-c-founders': [
    say('f1', 1, LUCA, 400, 'Raised prices 15% before our last drop. Sold out faster.'),
    say('f2', 2, JULES, 380, 'Scarcity + story. Numbered pieces changed everything for us'),
  ],
  'demo-c-sourcing': [say('s1', 1, KOFI, 500, 'Always order a pre-production sample. Always. Ask me how I know.')],
  'demo-c-denim': [say('d1', 1, PRIYA, 75, 'Six months in, no wash — honeycombs are finally showing 🔥')],
};

/** Lines the scripted "room" posts while a chat is open, so realtime is visible. */
const LIVE_LINES: { person: Person; text: string }[] = [
  { person: PRIYA, text: 'okay this thread is gold, saving it' },
  { person: THEO, text: 'Anyone here tried DTG vs screen print for under 50 units?' },
  { person: JULES, text: 'DTG for small runs, screen print past ~100. The math flips fast' },
  { person: KOFI, text: 'Dropping a link to my sample checklist in a sec 💎' },
  { person: LUCA, text: '🔥🔥🔥' },
];

// ─── Store ────────────────────────────────────────────────────────────────────

type Listener = (event: CommunityEvent) => void;
const listeners = new Map<string, Set<Listener>>();
const changeListeners = new Set<() => void>();

let state: {
  communities: Community[];
  messages: Map<string, CommunityMessage[]>;
  members: Map<string, CommunityMember[]>;
  seq: Map<string, number>;
} | null = null;

function init() {
  if (state) return state;
  const messages = new Map<string, CommunityMessage[]>();
  const seq = new Map<string, number>();
  const communities = COMMUNITIES.map((c) => ({ ...c }));
  for (const c of communities) {
    const msgs = (SCRIPTS[c.id] ?? []).map((m) => ({ ...m, id: `${c.id}:${m.id}`, communityId: c.id, replyToId: m.replyToId ? `${c.id}:${m.replyToId}` : undefined }));
    messages.set(c.id, msgs);
    seq.set(c.id, msgs.length);
    const last = msgs[msgs.length - 1];
    if (last) { c.lastMessage = last.text; c.lastMessageSenderName = last.fromName.split(' ')[0]; c.lastMessageTs = last.ts; }
  }
  const members = new Map<string, CommunityMember[]>();
  for (const c of communities) {
    members.set(c.id, PEOPLE.map((p, i) => ({
      userId: p.id, name: p.name, handle: p.handle, initials: initials(p.name), accountType: p.accountType,
      role: c.kind === 'user' && i === 0 ? 'owner' : p.role ?? 'member', joinedAt: new Date(NOW - (30 + i) * 24 * 60 * MIN).toISOString(),
    })));
  }
  state = { communities, messages, members, seq };
  return state;
}

function emitChange() { changeListeners.forEach((l) => l()); }
function emit(communityId: string, event: CommunityEvent) { listeners.get(communityId)?.forEach((l) => l(event)); }
const find = (id: string) => init().communities.find((c) => c.id === id);

export const demoStore = {
  onChange(listener: () => void): () => void {
    changeListeners.add(listener);
    return () => { changeListeners.delete(listener); };
  },
  list(q = ''): Community[] {
    const needle = q.trim().toLowerCase();
    return init().communities
      .filter((c) => c.visibility === 'public' && (!needle || c.name.toLowerCase().includes(needle) || c.description.toLowerCase().includes(needle)))
      .map((c) => ({ ...c }));
  },
  mine(): Community[] {
    return init().communities.filter((c) => c.joined).map((c) => ({ ...c }))
      .sort((a, b) => (b.lastMessageTs ?? 0) - (a.lastMessageTs ?? 0));
  },
  get(id: string): Community | undefined { const c = find(id); return c ? { ...c } : undefined; },
  join(id: string): Community | undefined {
    const c = find(id);
    if (!c) return undefined;
    if (!c.joined) {
      c.joined = true; c.role = 'member'; c.memberCount += 1; c.unreadCount = Math.min(init().messages.get(id)?.length ?? 0, 3);
      emitChange();
    }
    return { ...c };
  },
  leave(id: string) {
    const c = find(id);
    if (c && c.joined) { c.joined = false; c.role = null; c.memberCount = Math.max(0, c.memberCount - 1); c.unreadCount = 0; c.muted = false; emitChange(); }
  },
  setMuted(id: string, muted: boolean) { const c = find(id); if (c) { c.muted = muted; emitChange(); } },
  markRead(id: string) { const c = find(id); if (c && c.unreadCount) { c.unreadCount = 0; emitChange(); } },
  create(input: { name: string; description?: string; visibility: 'public' | 'private'; requireApproval?: boolean; iconUrl?: string | null; coverUrl?: string | null }): Community {
    const s = init();
    const id = `demo-c-${Date.now()}`;
    const c = community({
      id, name: input.name, slug: input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), description: input.description ?? '', memberCount: 1,
      kind: 'user', verified: false, visibility: input.visibility, requireApproval: !!input.requireApproval, joined: true, role: 'owner',
      iconUrl: input.iconUrl ?? undefined, coverUrl: input.coverUrl ?? undefined, createdAt: new Date().toISOString(),
    });
    s.communities.unshift(c); s.messages.set(id, []); s.seq.set(id, 0);
    s.members.set(id, [{ userId: DEMO_ME_ID, name: 'You', handle: '', initials: 'YO', role: 'owner', joinedAt: new Date().toISOString() }]);
    emitChange();
    return { ...c };
  },
  messages(id: string): CommunityMessage[] { return [...(init().messages.get(id) ?? [])]; },
  members(id: string): CommunityMember[] { return [...(init().members.get(id) ?? [])]; },
  send(id: string, text: string, attachments: CommunityMessage['attachments'] = [], replyToId?: string): CommunityMessage {
    const s = init();
    const n = (s.seq.get(id) ?? 0) + 1;
    s.seq.set(id, n);
    const list = s.messages.get(id) ?? [];
    const reply = replyToId ? list.find((m) => m.id === replyToId) : undefined;
    const msg: CommunityMessage = {
      id: `${id}:me-${n}`, communityId: id, seq: n, fromId: DEMO_ME_ID, fromName: 'You', fromHandle: '', fromInitials: 'YO', fromColor: '#636366',
      text, attachments, reactions: [], ts: Date.now(),
      replyToId: reply?.id, replyPreview: reply?.text, replyToAuthorName: reply?.fromName,
    };
    list.push(msg); s.messages.set(id, list);
    const c = find(id);
    if (c) { c.lastMessage = text || 'Photo'; c.lastMessageSenderName = 'You'; c.lastMessageTs = msg.ts; }
    emit(id, { type: 'message.created', message: msg });
    emitChange();
    return msg;
  },
  deleteMessage(id: string, messageId: string) {
    const s = init();
    s.messages.set(id, (s.messages.get(id) ?? []).filter((m) => m.id !== messageId));
    emit(id, { type: 'message.deleted', messageId });
  },
  react(id: string, messageId: string, reactionType: string | null): CommunityReaction[] {
    const m = init().messages.get(id)?.find((x) => x.id === messageId);
    if (!m) return [];
    m.reactions = m.reactions.filter((r) => r.userId !== DEMO_ME_ID);
    if (reactionType) m.reactions.push({ userId: DEMO_ME_ID, reactionType, createdAt: new Date().toISOString() });
    emit(id, { type: 'reaction.updated', messageId, reactions: m.reactions });
    return [...m.reactions];
  },
  subscribe(id: string, listener: Listener): () => void {
    let set = listeners.get(id);
    if (!set) { set = new Set(); listeners.set(id, set); }
    set.add(listener);
    // Scripted chatter while a chat is open → visible realtime.
    let i = 0;
    const timer = setInterval(() => {
      const line = LIVE_LINES[i % LIVE_LINES.length]; i += 1;
      const s = init();
      const n = (s.seq.get(id) ?? 0) + 1;
      s.seq.set(id, n);
      const msg = say(`${id}:live-${n}`, n, line.person, 0, line.text, { communityId: id });
      const list = s.messages.get(id) ?? [];
      list.push(msg); s.messages.set(id, list);
      const c = find(id);
      if (c) { c.lastMessage = msg.text; c.lastMessageSenderName = line.person.name.split(' ')[0]; c.lastMessageTs = msg.ts; }
      emit(id, { type: 'message.created', message: msg });
    }, 9000);
    return () => { set!.delete(listener); clearInterval(timer); };
  },
};
