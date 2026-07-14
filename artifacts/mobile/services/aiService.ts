/**
 * Brandthread AI Brain — Service Layer
 *
 * Handles message sending, session management, context building,
 * home suggestions, and next best actions. Falls back to mock
 * responses when the API is unreachable.
 *
 * API keys NEVER appear in this file. All AI calls go through
 * the secure API server.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
function nanoid(): string {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}
import {
  AIMessage, AISession, AIScreenContext, AIChatRequest,
  AIChatResponse, AIActionCard, AISettings, AISuggestion,
  NextBestAction, DEFAULT_AI_SETTINGS, contextLabel,
} from './aiTypes';
import { getEnabledMemorySummary } from './aiBrandMemory';
import { addAuditEntry } from './aiAuditLog';

// ─── AsyncStorage keys ────────────────────────────────────────────────────────

const SETTINGS_KEY = 'bt:ai:settings:v1';
const SESSION_KEY  = 'bt:ai:session:v1';
const MAX_STORED   = 50; // max messages kept in AsyncStorage

// ─── In-memory state ──────────────────────────────────────────────────────────

let _activeController: AbortController | null = null;
let _currentSession: AISession | null = null;

// ─── Settings ─────────────────────────────────────────────────────────────────

export async function getAISettings(): Promise<AISettings> {
  try {
    const raw = await AsyncStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_AI_SETTINGS };
    return { ...DEFAULT_AI_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_AI_SETTINGS };
  }
}

export async function saveAISettings(settings: AISettings): Promise<void> {
  await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

// ─── Session management ───────────────────────────────────────────────────────

export async function loadSession(context: AIScreenContext): Promise<AISession> {
  if (_currentSession) return _currentSession;
  try {
    const settings = await getAISettings();
    if (settings.sessionMemoryEnabled) {
      const raw = await AsyncStorage.getItem(SESSION_KEY);
      if (raw) {
        _currentSession = JSON.parse(raw) as AISession;
        // Update context to current screen
        _currentSession.context = context;
        return _currentSession;
      }
    }
  } catch {}
  return _newSession(context);
}

function _newSession(context: AIScreenContext): AISession {
  const session: AISession = {
    id: nanoid(),
    messages: [],
    context,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  _currentSession = session;
  return session;
}

export function startNewSession(context: AIScreenContext): AISession {
  _currentSession = null;
  return _newSession(context);
}

async function _persistSession(session: AISession): Promise<void> {
  try {
    const settings = await getAISettings();
    if (!settings.sessionMemoryEnabled) return;
    const toSave: AISession = {
      ...session,
      messages: session.messages.slice(-MAX_STORED),
    };
    await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(toSave));
  } catch {}
}

export async function clearSession(): Promise<void> {
  _currentSession = null;
  await AsyncStorage.removeItem(SESSION_KEY);
}

// ─── API call ─────────────────────────────────────────────────────────────────

const API_BASE = process.env.EXPO_PUBLIC_API_BASE_URL ?? '';

async function callAI(
  request: AIChatRequest,
  authToken: string | null,
  signal: AbortSignal,
): Promise<AIChatResponse> {
  if (!API_BASE) return _mockResponse(request);

  try {
    const res = await fetch(`${API_BASE}/ai/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      },
      body: JSON.stringify(request),
      signal,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as { error?: string };
      if (res.status === 429) return { content: '', error: 'Rate limit reached — please wait a moment.' };
      if (res.status === 503) return { content: '', error: 'AI service is temporarily unavailable.' };
      return _mockResponse(request); // fall back silently on server errors
    }

    return await res.json() as AIChatResponse;
  } catch (err: unknown) {
    if ((err as Error)?.name === 'AbortError') throw err;
    return _mockResponse(request);
  }
}

// ─── Mock responses ───────────────────────────────────────────────────────────

function _mockResponse(req: AIChatRequest): AIChatResponse {
  const lastMsg = req.messages.filter(m => m.role === 'user').pop()?.content?.toLowerCase() ?? '';
  const ctx = req.context;

  // Context-aware canned responses
  if (ctx.screen === 'product_detail') {
    if (lastMsg.includes('copy') || lastMsg.includes('description') || lastMsg.includes('write')) {
      const name = (ctx as { productName?: string }).productName ?? 'this product';
      return {
        content: `**${name}**\n\nEngineered for those who refuse to compromise. Built from 320gsm heavyweight French terry, each piece arrives pre-washed for instant softness and a relaxed-but-structured silhouette that holds its shape. A barely-there tonal logo, dropped shoulders, and reinforced seams — because the details that matter are the ones you feel, not just see.\n\n• 320gsm 100% combed cotton French terry\n• Pre-washed & preshrunk\n• Dropped shoulder construction\n• Tonal embroidery logo\n• True-to-size`,
        actionCard: {
          type: 'edit',
          title: 'Apply description',
          description: `Update the product description for ${name}`,
          requiresConfirmation: false,
          isDestructive: false,
          canUndo: true,
          payload: { field: 'description' },
        },
        isDemo: true,
      };
    }
    if (lastMsg.includes('price') || lastMsg.includes('pricing')) {
      return {
        content: `Based on your current margin structure and comparable products in the premium streetwear segment, here's my pricing analysis:\n\n**Current:** Unknown\n**Recommended test:** $119 – $139\n**Rationale:** Premium basics in this category command 2.8–3.5× cost-of-goods. Your brand positioning supports the upper range.\n\n⚠️ *This is an estimate based on typical category benchmarks, not your actual cost data. Confirm your production cost before applying.*\n\n**Expected impact:** +12–18% margin if cost allows. A/B test at $119 first.`,
        isDemo: true,
      };
    }
    if (lastMsg.includes('convert') || lastMsg.includes('perform')) {
      return {
        content: `Looking at this product's profile, a few common conversion killers to check:\n\n1. **Photos** — Is the first image shot on a model at the correct size? Generic flat-lay openings drop conversion ~23%.\n2. **Variant gap** — Missing popular size/color combinations push buyers to competitors.\n3. **Description** — Generic copy signals low quality. Premium copy increases dwell time significantly.\n4. **Price anchoring** — No compare-at price means buyers can't perceive a deal.\n\nStart with the product photo and copy — those are highest-leverage, lowest-cost fixes.`,
        isDemo: true,
      };
    }
  }

  if (ctx.screen === 'analytics') {
    return {
      content: `Looking at your performance data, here's what the numbers are telling you:\n\n**Revenue:** $23,840 this week (+8.2% vs. last week)\n**Conversion rate:** 3.1% (down from 3.6% last week)\n\nThe conversion dip is the most interesting signal. Your traffic is up but fewer people are completing purchases. Most likely causes:\n\n1. A top product went out of stock mid-week (check your Oversized Hoodie — typically your #1 driver)\n2. The new checkout flow may have introduced friction for returning customers\n\n**Recommended action:** Check stock levels on your top 5 SKUs, then run a quick 3-item flash sale this weekend to recover conversion rate.\n\n*Note: This analysis uses demo data and benchmarks. Connect your live store data for precise insights.*`,
      isDemo: true,
    };
  }

  if (ctx.screen === 'order_detail') {
    if (lastMsg.includes('draft') || lastMsg.includes('response') || lastMsg.includes('customer')) {
      return {
        content: `Here's a draft response you can review and personalise:\n\n---\nHi [Customer name],\n\nThank you for your order — we appreciate your support. Your order is currently being prepared and you'll receive a shipping notification with tracking details shortly.\n\nIf you have any questions in the meantime, please don't hesitate to reach out.\n\nBest,\nThe [Brand] Team\n---`,
        actionCard: {
          type: 'create_draft',
          title: 'Save as draft reply',
          description: 'This message will be saved as a draft — you control when it sends.',
          requiresConfirmation: false,
          isDestructive: false,
          canUndo: true,
          payload: { type: 'customer_reply' },
        },
        isDemo: true,
      };
    }
  }

  if (ctx.screen === 'manufacturer_hub') {
    if (lastMsg.includes('quote') || lastMsg.includes('compare') || lastMsg.includes('best')) {
      return {
        content: `Based on the quotes in your hub, here's a side-by-side breakdown:\n\n| Manufacturer | Unit cost | MOQ | Lead time | Quality score |\n|---|---|---|---|---|\n| Apex Garment Co. | $18.50 | 100 | 28 days | ⭐⭐⭐⭐⭐ |\n| Pacific Thread | $15.20 | 200 | 35 days | ⭐⭐⭐⭐ |\n| Meridian Goods | $22.00 | 50 | 21 days | ⭐⭐⭐⭐⭐ |\n\n**Recommendation:** Apex Garment Co. offers the best balance of quality, speed, and cost at your current order volumes. If you can commit to 200 units, Pacific Thread saves ~$660 per run.\n\n*Confirm specs and sample quality before committing to any manufacturer.*`,
        isDemo: true,
      };
    }
  }

  if (ctx.screen === 'content') {
    if (lastMsg.includes('hook') || lastMsg.includes('caption') || lastMsg.includes('copy')) {
      return {
        content: `Here are 5 hooks for your next post:\n\n1. "We almost didn't release this one."\n2. "The hoodie your wardrobe has been missing — without you knowing it."\n3. "320 grams. Zero compromises."\n4. "Limited. And we mean it this time."\n5. "Quality that outlasts the trend."\n\n**Caption option:**\nDesigned to be worn for years, not seasons. Every stitch is intentional. Every weight is tested. This isn't fast fashion — it's the opposite.\n\nLink in bio.\n\n**Suggested hashtags:** #streetwear #premiumbasics #qualityclothing #slowfashion #limiteddrop`,
        actionCard: {
          type: 'create_draft',
          title: 'Create post draft',
          description: 'Saves these hooks and caption as a content draft',
          requiresConfirmation: false,
          isDestructive: false,
          canUndo: true,
          payload: { type: 'content_draft' },
        },
        isDemo: true,
      };
    }
  }

  if (ctx.screen === 'inventory') {
    return {
      content: `Based on your current inventory levels and sales velocity, here are my restock recommendations:\n\n🔴 **Urgent (< 5 units):**\n• Essential Hoodie — Black M (2 units remaining, ~6-day supply)\n• Classic Tee — White XL (4 units remaining, ~9-day supply)\n\n🟡 **Watch (< 15 units):**\n• Cargo Jogger — Olive S (11 units)\n• Essential Hoodie — Navy L (13 units)\n\n**Suggested order quantity:** 150 units per critical SKU (based on your typical 6-week lead time from Apex Garment Co.)\n\n⚠️ *Stockout estimates are based on your 30-day sales average. Actual sell-through may vary with marketing activity.*`,
      isDemo: true,
    };
  }

  if (ctx.screen === 'marketing') {
    return {
      content: `Here's a campaign concept for your next drop:\n\n**Subject line options:**\n1. "This one's been in the vault."\n2. "Limited stock. No restock."\n3. "Your next essential — available now."\n\n**Email body:**\nThis drop is different. We spent 8 months perfecting the weight, the wash, the fit. The result is something we're genuinely proud of — and something we won't be making again in these exact colours.\n\n[Shop the drop →]\n\n**Segment recommendation:** Target your VIP buyers first (24-hour early access), then open to your full list.\n**Estimated open rate:** 34–42% for VIP segment based on your historical data.\n\n⚠️ *This campaign will not be scheduled or sent without your explicit approval.*`,
      actionCard: {
        type: 'create_draft',
        title: 'Save campaign draft',
        description: 'Creates an email campaign draft — not scheduled or sent.',
        requiresConfirmation: false,
        isDestructive: false,
        canUndo: true,
        payload: { type: 'email_campaign' },
      },
      isDemo: true,
    };
  }

  if (ctx.screen === 'store_builder') {
    return {
      content: `Here's my recommendation for improving conversion on your homepage:\n\n**Suggested changes:**\n1. Move "Best Sellers" section above the brand story — buyers scan for products first\n2. Increase hero height by 20% — more visual impact on first scroll\n3. Add a "Low stock" badge to your top 3 fastest-moving items — creates urgency without discounting\n4. Simplify navigation to 4 items: Shop, About, Journal, Contact\n\nEach of these can be previewed before applying. Which would you like to start with?`,
      isDemo: true,
    };
  }

  if (ctx.screen === 'customers') {
    return {
      content: `Here's a breakdown of your customer landscape:\n\n**VIP (5+ orders or $500+ LTV):** 12 customers — account for 41% of revenue\n**Returning (2–4 orders):** 34 customers — healthy repeat rate\n**At-Risk (no purchase in 60+ days):** 18 customers — prime for a win-back\n\n**Win-back recommendation:** Send a personalised re-engagement email to your at-risk segment with an exclusive early-access offer on your next drop. Estimated recovery rate: 15–25% based on your niche.\n\n*Customer data shown uses demo figures. Connect your live data for precise segmentation.*`,
      isDemo: true,
    };
  }

  // Home / default
  if (ctx.screen === 'home') {
    return {
      content: `Good day! Here's what I'd prioritize right now:\n\n**1. 3 orders are ready to ship** — fulfil before end of day to hit your delivery window.\n**2. Black medium hoodies at ~8-day supply** — consider placing a reorder today.\n**3. Your last Seller video is outperforming average by 3×** — a great time to create a follow-up with the same product.\n\nWant me to draft a reorder message to your manufacturer, or help you plan the follow-up content?`,
      isDemo: true,
    };
  }

  return {
    content: `I'm here to help with your Brandthread business. Ask me about your products, orders, inventory, content, analytics, or store — and I'll give you clear, data-grounded guidance.\n\n*Note: Running in demo mode. Connect your live data for personalised insights.*`,
    isDemo: true,
  };
}

// ─── Send message ─────────────────────────────────────────────────────────────

export interface SendMessageParams {
  userText: string;
  session: AISession;
  authToken: string | null;
  onToken?: (partial: string) => void; // future: streaming
}

export interface SendMessageResult {
  session: AISession;
  response: AIMessage;
}

export async function sendMessage(params: SendMessageParams): Promise<SendMessageResult> {
  const { userText, session, authToken } = params;

  // Cancel any in-flight request
  _activeController?.abort();
  _activeController = new AbortController();

  const userMsg: AIMessage = {
    id: nanoid(),
    role: 'user',
    content: userText,
    ts: Date.now(),
    contextLabel: contextLabel(session.context),
  };

  // Add streaming placeholder
  const assistantId = nanoid();
  const placeholder: AIMessage = {
    id: assistantId,
    role: 'assistant',
    content: '',
    ts: Date.now(),
    isStreaming: true,
  };

  const updatedMessages = [...session.messages, userMsg, placeholder];
  session.messages = updatedMessages;
  session.updatedAt = Date.now();

  // Build request (last 20 messages for context)
  const history = session.messages
    .filter(m => !m.isStreaming && m.role !== 'system')
    .slice(-20)
    .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

  const brandMemory = await getEnabledMemorySummary();

  const request: AIChatRequest = {
    messages: history,
    context: session.context,
    brandMemory: Object.keys(brandMemory).length > 0 ? brandMemory : undefined,
    maxTokens: 700,
  };

  let response: AIChatResponse;
  try {
    response = await callAI(request, authToken, _activeController.signal);
  } catch (err: unknown) {
    if ((err as Error)?.name === 'AbortError') {
      // Remove streaming placeholder
      session.messages = session.messages.filter(m => m.id !== assistantId);
      session.updatedAt = Date.now();
      throw err;
    }
    response = { content: '', error: 'Connection error. Please try again.' };
  }

  // Build final AI message
  const aiMsg: AIMessage = {
    id: assistantId,
    role: 'assistant',
    content: response.content,
    ts: Date.now(),
    isStreaming: false,
    error: response.error,
    contextLabel: contextLabel(session.context),
    actionCard: response.actionCard
      ? {
          ...response.actionCard,
          id: nanoid(),
          status: 'pending',
        }
      : undefined,
  };

  // Replace placeholder with final message
  session.messages = session.messages.map(m => m.id === assistantId ? aiMsg : m);
  session.updatedAt = Date.now();

  // Audit log for action cards
  if (aiMsg.actionCard) {
    await addAuditEntry({
      eventType: 'suggested',
      screen: session.context.screen,
      actionType: aiMsg.actionCard.type,
      title: aiMsg.actionCard.title,
      canUndo: aiMsg.actionCard.canUndo,
    });
  }

  // Persist session
  await _persistSession(session);

  return { session, response: aiMsg };
}

// ─── Cancel ───────────────────────────────────────────────────────────────────

export function cancelGeneration(): void {
  _activeController?.abort();
  _activeController = null;
  // Remove trailing streaming placeholder from active session
  if (_currentSession) {
    _currentSession.messages = _currentSession.messages.filter(m => !m.isStreaming);
  }
}

// ─── Apply action ─────────────────────────────────────────────────────────────

export async function applyAction(
  session: AISession,
  messageId: string,
  confirmed: boolean,
): Promise<AISession> {
  const msg = session.messages.find(m => m.id === messageId);
  if (!msg?.actionCard) return session;

  const status: AIMessage['actionCard'] = msg.actionCard
    ? { ...msg.actionCard, status: confirmed ? 'applied' : 'rejected' }
    : undefined;

  session.messages = session.messages.map(m =>
    m.id === messageId ? { ...m, actionCard: status } : m,
  );
  session.updatedAt = Date.now();

  await addAuditEntry({
    eventType: confirmed ? 'approved' : 'rejected',
    screen: session.context.screen,
    actionType: msg.actionCard.type,
    title: msg.actionCard.title,
    canUndo: msg.actionCard.canUndo,
  });

  await _persistSession(session);
  return session;
}

export async function undoAction(session: AISession, messageId: string): Promise<AISession> {
  const msg = session.messages.find(m => m.id === messageId);
  if (!msg?.actionCard || !msg.actionCard.canUndo) return session;

  session.messages = session.messages.map(m =>
    m.id === messageId
      ? { ...m, actionCard: m.actionCard ? { ...m.actionCard, status: 'undone' } : undefined }
      : m,
  );
  session.updatedAt = Date.now();

  await addAuditEntry({
    eventType: 'undone',
    screen: session.context.screen,
    actionType: msg.actionCard.type,
    title: msg.actionCard.title,
    canUndo: false,
    affectedRecord: messageId,
  });

  await _persistSession(session);
  return session;
}

// ─── Home Suggestions ─────────────────────────────────────────────────────────

const SUGGESTIONS_KEY = 'bt:ai:suggestions:v1';

export async function getAISuggestions(): Promise<AISuggestion[]> {
  const DEMO: AISuggestion[] = [
    {
      id: 'sug_restock',
      title: 'Restock black medium hoodies',
      reason: 'At current sales velocity, you have ~8 days of stock remaining.',
      expectedImpact: 'Prevents ~$2,400 in missed revenue',
      actionLabel: 'View inventory',
      actionRoute: '/inventory',
      category: 'inventory',
      priority: 'urgent',
      contextPrompt: 'What should I restock urgently?',
    },
    {
      id: 'sug_ship',
      title: 'Ship 3 orders before 5 PM',
      reason: 'Three orders are ready to ship. Two have a 2-day delivery promise.',
      expectedImpact: 'Protects seller rating and customer satisfaction',
      actionLabel: 'View orders',
      actionRoute: '/(tabs)/orders',
      category: 'orders',
      priority: 'urgent',
      contextPrompt: 'Which orders should I ship today?',
    },
    {
      id: 'sug_content',
      title: 'Create content for your best seller',
      reason: 'Your Essential Hoodie has a high view-to-purchase rate but limited recent content.',
      expectedImpact: 'Estimated +18% product page visits',
      actionLabel: 'Open content creator',
      actionRoute: '/create-post',
      category: 'content',
      priority: 'high',
      contextPrompt: 'Create a content plan for my best-selling hoodie.',
    },
    {
      id: 'sug_quote',
      title: 'Review manufacturer quote expiring tomorrow',
      reason: 'Pacific Thread quote #QT-2041 expires in 22 hours.',
      expectedImpact: 'Losing this quote delays production by 3–4 weeks',
      actionLabel: 'View quote',
      actionRoute: '/manufacturer-hub',
      category: 'production',
      priority: 'high',
      contextPrompt: 'Compare my current manufacturer quotes.',
    },
    {
      id: 'sug_conversion',
      title: 'Improve a low-converting product page',
      reason: 'Canvas Cargo Jacket has the highest traffic but lowest add-to-cart rate.',
      expectedImpact: 'Estimated +$1,800/mo revenue if conversion reaches category average',
      actionLabel: 'Open product',
      actionRoute: '/(tabs)/products',
      category: 'analytics',
      priority: 'medium',
      contextPrompt: 'Why is my Canvas Cargo Jacket not converting?',
    },
    {
      id: 'sug_winback',
      title: 'Send a win-back campaign',
      reason: '18 customers haven\'t ordered in 60+ days — a win-back typically recovers 15–25%.',
      expectedImpact: 'Estimated 3–5 recovered customers',
      actionLabel: 'View customers',
      actionRoute: '/(tabs)/more',
      category: 'customers',
      priority: 'medium',
      contextPrompt: 'Which customers are at risk of churning?',
    },
  ];

  try {
    const raw = await AsyncStorage.getItem(SUGGESTIONS_KEY);
    if (!raw) {
      await AsyncStorage.setItem(SUGGESTIONS_KEY, JSON.stringify(DEMO));
      return DEMO;
    }
    const stored = JSON.parse(raw) as AISuggestion[];
    // Merge with demo to add any new suggestions
    const storedIds = new Set(stored.map(s => s.id));
    const merged = [...stored, ...DEMO.filter(d => !storedIds.has(d.id))];
    return merged.filter(s => !s.dismissedAt && !s.completedAt);
  } catch {
    return DEMO;
  }
}

export async function dismissSuggestion(id: string): Promise<void> {
  try {
    const suggestions = await getAISuggestions();
    const all = await AsyncStorage.getItem(SUGGESTIONS_KEY);
    const stored: AISuggestion[] = all ? JSON.parse(all) : suggestions;
    const updated = stored.map(s => s.id === id ? { ...s, dismissedAt: Date.now() } : s);
    await AsyncStorage.setItem(SUGGESTIONS_KEY, JSON.stringify(updated));
  } catch {}
}

export async function completeSuggestion(id: string): Promise<void> {
  try {
    const all = await AsyncStorage.getItem(SUGGESTIONS_KEY);
    const stored: AISuggestion[] = all ? JSON.parse(all) : [];
    const updated = stored.map(s => s.id === id ? { ...s, completedAt: Date.now() } : s);
    await AsyncStorage.setItem(SUGGESTIONS_KEY, JSON.stringify(updated));
  } catch {}
}

// ─── Next Best Actions ────────────────────────────────────────────────────────

export async function getNextBestActions(): Promise<NextBestAction[]> {
  // In production this would analyse real data. For now, demo data.
  return [
    { id: 'nba_ship',  title: 'Ship 3 orders before 5 PM',                       subtitle: 'Orders ready to ship',              icon: 'package', accentColor: '#F97316', route: '/(tabs)/orders',  priority: 1, category: 'orders'    },
    { id: 'nba_stock', title: 'Black medium hoodies: ~8-day supply',              subtitle: 'Consider placing reorder today',     icon: 'layers',  accentColor: '#F87171', route: '/inventory',     priority: 2, category: 'inventory' },
    { id: 'nba_quote', title: 'Manufacturer quote expires tomorrow',              subtitle: 'Pacific Thread QT-2041',            icon: 'clock',   accentColor: '#F59E0B', route: '/manufacturer-hub', priority: 3, category: 'production' },
    { id: 'nba_video', title: 'Your latest video is driving product clicks',      subtitle: 'Create a follow-up post',           icon: 'video',   accentColor: '#8B5CF6', route: '/create-post',   priority: 4, category: 'content'   },
    { id: 'nba_conv',  title: 'Canvas Cargo Jacket: high views, low add-to-cart', subtitle: 'Optimise the product page',        icon: 'trending-down', accentColor: '#22D3EE', route: '/(tabs)/products', priority: 5, category: 'analytics' },
  ];
}
