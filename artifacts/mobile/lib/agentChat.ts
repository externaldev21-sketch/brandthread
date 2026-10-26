/**
 * Brandthread Agent — shared client-side helpers used by both the real
 * conversation screen and the preview inbox: the quick-reply chip set, a
 * canned-reply fallback (matching the real system prompt's tone — see
 * artifacts/api-server/src/routes/brandthread-agent.ts), and the "has this
 * welcome already played once" persistence so the typing-in animation only
 * ever runs the first time a thread is opened.
 *
 * Pure logic only — no react-native imports besides AsyncStorage, so this is
 * safe to unit test directly.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

export type AgentQuickReply = { label: string; value: string };

export const BUYER_QUICK_REPLIES: AgentQuickReply[] = [
  { label: 'Show me Thread Cash', value: 'Show me how Thread Cash works' },
  { label: 'Find me brands', value: "Find me some brands I'd like" },
  { label: 'How do I sell?', value: 'How do I start selling on Brandthread?' },
  { label: 'Just browsing', value: 'Just browsing for now' },
];

/** Parses the `optionsJson` meta string the server sends on a `quick_replies`
 *  attachment. Falls back to the buyer defaults if it's missing/malformed —
 *  the chips should never silently disappear. */
export function parseQuickReplies(optionsJson: string | undefined | null): AgentQuickReply[] {
  if (!optionsJson) return BUYER_QUICK_REPLIES;
  try {
    const parsed = JSON.parse(optionsJson);
    if (Array.isArray(parsed) && parsed.every(p => typeof p?.label === 'string' && typeof p?.value === 'string')) {
      return parsed;
    }
  } catch {
    // fall through to defaults
  }
  return BUYER_QUICK_REPLIES;
}

/** A canned reply used when the real AI endpoint can't be reached (preview
 *  mode with no backend, or a network failure) — matches the real system
 *  prompt's professional, concierge tone and covers the same topics. */
export function cannedAgentReply(userText: string): { text: string; cardKind?: 'thread_cash' | 'discover' } {
  const lower = userText.toLowerCase();
  if (lower.includes('thread cash')) {
    return {
      text: "Check in daily to earn credit, then turn it on at checkout as a discount — your card covers the rest. You can send it to people you mutually follow, and credit someone sends you can't be re-sent onward.",
      cardKind: 'thread_cash',
    };
  }
  if (lower.includes('sell') || lower.includes('listing') || lower.includes('go live') || lower.includes('payout') || lower.includes('shopify')) {
    return { text: "Start from the Seller Hub — list a product in a couple of minutes, or import your catalog from Shopify. Go live when you're ready to sell in real time; payouts arrive once orders ship." };
  }
  if (lower.includes('brand') || lower.includes('discover') || lower.includes('find')) {
    return { text: "Open Discover — new drops and brands picked for you. The more you browse, the better it gets.", cardKind: 'discover' };
  }
  if (lower.includes('browsing') || lower.includes('vibing') || lower.includes('just')) {
    return { text: "Sounds good. I'm here whenever you need anything." };
  }
  return { text: "I can help with brands, orders, Thread Cash, or anything else in the app. What do you need?" };
}

const WELCOME_PLAYED_PREFIX = 'brandthread_agent_welcome_played:';

// In-memory mirror of the persisted flag, so a second open in the same
// session never waits on (or races) AsyncStorage before deciding.
const welcomeClaimed = new Set<string>();

/** True once the welcome typing-in animation has played for this seed
 *  conversation before — persisted so re-opening the thread doesn't replay
 *  it every time. */
export async function hasWelcomePlayed(conversationId: string): Promise<boolean> {
  if (welcomeClaimed.has(conversationId)) return true;
  try {
    return (await AsyncStorage.getItem(WELCOME_PLAYED_PREFIX + conversationId)) === 'true';
  } catch {
    return false;
  }
}

export async function markWelcomePlayed(conversationId: string): Promise<void> {
  welcomeClaimed.add(conversationId);
  try {
    await AsyncStorage.setItem(WELCOME_PLAYED_PREFIX + conversationId, 'true');
  } catch {
    // Best-effort — the in-memory flag still stops a replay this session.
  }
}

/** The single gate for the welcome type-in: resolves true for exactly one
 *  caller per conversation per device, and marks it played BEFORE the caller
 *  starts animating — so leaving mid-animation, re-focusing the screen, or a
 *  second concurrent load never replays it. Every later call resolves false. */
export async function claimWelcomePlayback(conversationId: string): Promise<boolean> {
  if (welcomeClaimed.has(conversationId)) return false;
  welcomeClaimed.add(conversationId);
  let played = false;
  try {
    played = (await AsyncStorage.getItem(WELCOME_PLAYED_PREFIX + conversationId)) === 'true';
  } catch {
    // Unreadable storage: treat as not played, but the in-memory claim above
    // still limits it to once this session.
  }
  if (played) return false;
  await markWelcomePlayed(conversationId);
  return true;
}

/** Test-only: forget the in-memory claims (AsyncStorage is mocked separately). */
export function resetWelcomeClaimsForTests(): void {
  welcomeClaimed.clear();
}
