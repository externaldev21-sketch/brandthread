/**
 * Preview-only Brandthread AI responses — no network call, no real AI
 * provider, no auth token.
 *
 * Dev's explicit requirement: the AI Brain screen must never show a
 * sign-in wall in the dev/web preview (real sellers are already signed in;
 * the wall only ever fires for the preview's synthetic, session-less
 * account). But the real `/api/v1/ai/chat` endpoint is a paid, auth-gated
 * API — it must stay auth-protected for real use, and this module exists
 * so the preview path never has a reason to call it: it answers entirely
 * client-side, from the same seeded preview data every other dev-preview
 * screen already uses (lib/previewSellerProducts.ts et al.), so there is
 * no unauthenticated AI surface for anonymous/production traffic to reach
 * in the first place — "gating" it is not exposing it.
 *
 * Callers must additionally gate on isSellerDevPreview()/isBuyerDevPreview()
 * (which already layer __DEV__ + non-production-host checks — see
 * lib/devPreview.ts) before using this, so a real signed-out production
 * user never gets a fabricated answer instead of the real sign-in flow.
 *
 * Template-matched, not an LLM — a small set of common store questions get
 * a specific, on-brand answer; everything else gets an honest, generic
 * reply that still demonstrates the UI (streaming, markdown, suggested
 * follow-ups) without pretending to be a full assistant.
 */
import { isPreviewDemoMode } from './devPreview';

/** The demo catalog's standout item — matches lib/previewSellerProducts.ts's "Silver Sculpted Gown" (highest-priced, featured across other preview surfaces this session, e.g. Boost's demo target). */
const DEMO_BEST_SELLER = 'Silver Sculpted Gown';
const DEMO_BEST_SELLER_PRICE = '$78.00';

function matches(text: string, ...patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(text));
}

/**
 * Returns a plausible assistant reply for the dev/web preview — using the
 * populated demo dataset under `&demo=1`, or the honest empty-store state
 * otherwise. Never throws, never calls the network.
 */
export function getPreviewAiReply(userText: string): string {
  const q = userText.toLowerCase();
  const demo = isPreviewDemoMode();

  if (!demo) {
    // Fresh, brand-new preview store — zero orders, zero revenue.
    if (matches(q, /best.?sell|top.?sell|what.*(sell|selling)|which product/)) {
      return "You have no sales yet — once orders start coming in, I'll be able to tell you what's selling best.";
    }
    if (matches(q, /sales|revenue|orders?|performance|how.*(doing|performing)/)) {
      return "Your store hasn't made any sales yet, so there's nothing to report this week. Once you publish products and get your first orders, ask me again and I'll have real numbers.";
    }
    if (matches(q, /restock|inventory|stock/)) {
      return "You don't have any products yet, so there's nothing to restock. Add your first product and I can help you plan inventory from there.";
    }
    return "Your store is brand new — no products or orders yet. Once you've published something and started getting sales, I'll be able to answer with real numbers.";
  }

  // Populated demo store.
  if (matches(q, /best.?sell|top.?sell|what.*(sell|selling)|which product/)) {
    return `Your best seller this week is the **${DEMO_BEST_SELLER}** (${DEMO_BEST_SELLER_PRICE}) — it's outpacing the rest of your catalog. Want me to suggest a restock or a quick promo to keep the momentum going?`;
  }
  if (matches(q, /sales|revenue|performance|how.*(doing|performing)/)) {
    return `This week's been solid, led by the **${DEMO_BEST_SELLER}**. Ask me about a specific product, order, or time range and I can go deeper.`;
  }
  if (matches(q, /restock|inventory|stock/)) {
    return `Based on recent demand, the **${DEMO_BEST_SELLER}** is the one to watch for restocking first. Want a draft restock reminder?`;
  }
  return `I can see your demo store's products and orders right now. Try asking about your best seller, recent orders, or what needs restocking.`;
}
