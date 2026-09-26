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
  { label: 'Just vibing', value: 'Just vibing, no questions right now' },
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
 *  prompt's casual, friend-like tone and covers the same topics. */
export function cannedAgentReply(userText: string): { text: string; cardKind?: 'thread_cash' | 'discover' } {
  const lower = userText.toLowerCase();
  if (lower.includes('thread cash')) {
    return {
      text: "it's easy — check in daily to earn credit, then toggle it on at checkout as a discount. your card still covers the rest. you can only send it to people you mutually follow, and cash someone sends you can't be re-sent onward.",
      cardKind: 'thread_cash',
    };
  }
  if (lower.includes('sell') || lower.includes('listing') || lower.includes('go live') || lower.includes('payout') || lower.includes('shopify')) {
    return { text: "start from the Seller Hub — list a product in a couple minutes, or pull your whole catalog in from Shopify. Go Live when you're ready to sell in real time, and payouts land once orders ship." };
  }
  if (lower.includes('brand') || lower.includes('discover') || lower.includes('find')) {
    return { text: "Discover's the move — fresh drops and brands picked for you. tap in and I'll keep learning what you like.", cardKind: 'discover' };
  }
  if (lower.includes('vibing') || lower.includes('just')) {
    return { text: "bet, I'm right here whenever 🤙" };
  }
  return { text: "hear you — I'm here 24/7 for fits, brands, Thread Cash, or anything else. what's up?" };
}

const WELCOME_PLAYED_PREFIX = 'brandthread_agent_welcome_played:';

/** True once the welcome typing-in animation has played for this seed
 *  conversation before — persisted so re-opening the thread doesn't replay
 *  it every time. */
export async function hasWelcomePlayed(conversationId: string): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(WELCOME_PLAYED_PREFIX + conversationId)) === 'true';
  } catch {
    return false;
  }
}

export async function markWelcomePlayed(conversationId: string): Promise<void> {
  try {
    await AsyncStorage.setItem(WELCOME_PLAYED_PREFIX + conversationId, 'true');
  } catch {
    // Best-effort — worst case the animation replays once more.
  }
}
