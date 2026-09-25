/**
 * Brandthread AI Brain — Service Layer
 *
 * Handles message sending, session management, context building,
 * home suggestions, and next best actions.
 *
 * Design contract (immutable I/O):
 *  - sendMessage() receives a session snapshot; it does NOT mutate the input.
 *    It returns a new session with exactly one new user message and one new
 *    assistant message appended (or throws on abort / hard error).
 *  - The caller owns UI state; the service owns persistence and message IDs.
 *  - Sessions are scoped by Clerk userId + store context so account switches
 *    never bleed state.
 *  - Empty or duplicate rows are repaired on load.
 *
 * API keys NEVER appear in this file. All AI calls go through
 * the secure API server.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  AIMessage, AISession, AIScreenContext, AIChatRequest,
  AIChatResponse, AIActionCard, AISettings, AISuggestion,
  NextBestAction, DEFAULT_AI_SETTINGS, contextLabel,
} from './aiTypes';
import { getEnabledMemorySummary } from './aiBrandMemory';
import { addAuditEntry } from './aiAuditLog';

// ─── ID helper ────────────────────────────────────────────────────────────────

function nanoid(): string {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

// ─── AsyncStorage key scoping ─────────────────────────────────────────────────

const SETTINGS_KEY = 'bt:ai:settings:v1';
const MAX_STORED   = 50; // max messages kept in AsyncStorage

/**
 * Returns a per-user, per-store session storage key.
 * Falls back to a shared key when userId is not yet known (pre-auth).
 */
function sessionKey(userId?: string | null, storeContext?: string | null): string {
  const u = userId ?? 'anon';
  const s = storeContext ?? 'default';
  return `bt:ai:session:v2:${u}:${s}`;
}

function suggestionsKey(userId?: string | null): string {
  return `bt:ai:suggestions:v1:${userId ?? 'anon'}`;
}

// ─── In-memory state ──────────────────────────────────────────────────────────

let _activeController: AbortController | null = null;

// Track the last-loaded key so we can detect user/store switches.
let _lastSessionKey: string | null = null;
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

// ─── Session repair ───────────────────────────────────────────────────────────

/**
 * Remove empty messages and deduplicate consecutive identical messages.
 * Preserves ordering. Called on every session load.
 */
function repairMessages(messages: AIMessage[]): AIMessage[] {
  const seen = new Set<string>();
  const out: AIMessage[] = [];
  for (const m of messages) {
    // Drop empty non-streaming messages
    if (!m.isStreaming && !m.content?.trim() && !m.error) continue;
    // Drop exact content duplicates (same role + content within 2 s)
    const dedupKey = `${m.role}:${m.content}`;
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);
    // Strip any persisted streaming placeholders (should never be stored)
    if (m.isStreaming) continue;
    out.push(m);
  }
  return out;
}

// ─── Session management ───────────────────────────────────────────────────────

export interface LoadSessionOptions {
  context: AIScreenContext;
  userId?: string | null;
  storeContext?: string | null;
}

export async function loadSession(
  context: AIScreenContext,
  userId?: string | null,
  storeContext?: string | null,
): Promise<AISession> {
  const key = sessionKey(userId, storeContext);

  // Reload from storage when user/store context switches.
  if (_lastSessionKey !== key) {
    _currentSession = null;
    _lastSessionKey = key;
  }

  if (_currentSession) {
    _currentSession.context = context;
    return _currentSession;
  }

  try {
    const settings = await getAISettings();
    if (settings.sessionMemoryEnabled) {
      const raw = await AsyncStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw) as AISession;
        parsed.messages = repairMessages(parsed.messages ?? []);
        parsed.context = context;
        _currentSession = parsed;
        return _currentSession;
      }
    }
  } catch { /* fall through */ }

  return _newSession(context, key);
}

function _newSession(context: AIScreenContext, key?: string): AISession {
  const session: AISession = {
    id: nanoid(),
    messages: [],
    context,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  _currentSession = session;
  _lastSessionKey = key ?? _lastSessionKey;
  return session;
}

export function startNewSession(context: AIScreenContext): AISession {
  _currentSession = null;
  return _newSession(context, _lastSessionKey ?? undefined);
}

async function _persistSession(
  session: AISession,
  userId?: string | null,
  storeContext?: string | null,
): Promise<void> {
  try {
    const settings = await getAISettings();
    if (!settings.sessionMemoryEnabled) return;
    const key = sessionKey(userId, storeContext);
    const toSave: AISession = {
      ...session,
      // Never persist streaming placeholders
      messages: session.messages
        .filter(m => !m.isStreaming)
        .slice(-MAX_STORED),
    };
    await AsyncStorage.setItem(key, JSON.stringify(toSave));
  } catch { /* persistence is best-effort */ }
}

export async function clearSession(
  userId?: string | null,
  storeContext?: string | null,
): Promise<void> {
  _currentSession = null;
  const key = sessionKey(userId, storeContext);
  await AsyncStorage.removeItem(key);
}

// ─── API call ─────────────────────────────────────────────────────────────────

/**
 * Call the real AI endpoint.
 * Throws on abort (AbortError).
 * Throws on network / auth / provider failures with a concise error message.
 * Does NOT fall back to fake business data.
 */
async function callAI(
  request: AIChatRequest,
  authToken: string | null,
  signal: AbortSignal,
): Promise<AIChatResponse> {
  const apiBase = process.env.EXPO_PUBLIC_API_BASE_URL ?? '';
  if (!apiBase) {
    throw new Error('AI service is not configured. Check your API base URL.');
  }
  if (!authToken) {
    throw new Error('Sign in to use Brandthread AI.');
  }

  const res = await fetch(`${apiBase}/api/v1/ai/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify(request),
    signal,
  });

  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new Error('Authentication error. Please sign in again.');
    }
    if (res.status === 429) {
      throw new Error('Rate limit reached — please wait a moment and try again.');
    }
    if (res.status === 503 || res.status === 502) {
      throw new Error('AI service is temporarily unavailable. Please try again shortly.');
    }
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `AI request failed (${res.status}).`);
  }

  return res.json() as Promise<AIChatResponse>;
}

// ─── Streaming API call ───────────────────────────────────────────────────────

/**
 * Streams the AI reply via SSE using XMLHttpRequest — React Native's `fetch`
 * does not expose a readable response body, but XHR's `responseText` grows
 * incrementally during readyState 3 (LOADING), which is the standard way to
 * consume a streaming HTTP response on this platform.
 */
function callAIStream(
  request: AIChatRequest,
  authToken: string | null,
  onDelta: (fullTextSoFar: string) => void,
  signal: AbortSignal,
): Promise<AIChatResponse> {
  return new Promise((resolve, reject) => {
    const apiBase = process.env.EXPO_PUBLIC_API_BASE_URL ?? '';
    if (!apiBase) {
      reject(new Error('AI service is not configured. Check your API base URL.'));
      return;
    }
    if (!authToken) {
      reject(new Error('Sign in to use Brandthread AI.'));
      return;
    }

    const xhr = new XMLHttpRequest();
    let processedLength = 0;
    let buffer = '';
    let fullContent = '';
    let settled = false;

    const onAbort = () => xhr.abort();
    signal.addEventListener('abort', onAbort);
    const cleanup = () => signal.removeEventListener('abort', onAbort);

    function processNewData() {
      const text: string = xhr.responseText ?? '';
      const chunk = text.slice(processedLength);
      processedLength = text.length;
      if (!chunk) return;
      buffer += chunk;
      const parts = buffer.split('\n\n');
      buffer = parts.pop() ?? '';
      for (const part of parts) {
        const line = part.replace(/^data: /, '').trim();
        if (!line) continue;
        let evt: { type?: string; content?: string; actionCard?: AIActionCard; sources?: AIChatResponse['sources']; error?: string };
        try {
          evt = JSON.parse(line);
        } catch {
          continue;
        }
        if (evt.type === 'delta' && typeof evt.content === 'string') {
          fullContent += evt.content;
          onDelta(fullContent);
        } else if (evt.type === 'done' && !settled) {
          settled = true;
          cleanup();
          resolve({ content: evt.content ?? fullContent, actionCard: evt.actionCard as any, sources: evt.sources });
        } else if (evt.type === 'error' && !settled) {
          settled = true;
          cleanup();
          reject(new Error(evt.error ?? 'AI service temporarily unavailable.'));
        }
      }
    }

    xhr.onreadystatechange = () => {
      if (xhr.readyState === 3 || xhr.readyState === 4) {
        processNewData();
      }
      if (xhr.readyState === 4 && !settled) {
        settled = true;
        cleanup();
        if (xhr.status === 401 || xhr.status === 403) {
          reject(new Error('Authentication error. Please sign in again.'));
        } else if (xhr.status === 429) {
          reject(new Error('Rate limit reached — please wait a moment and try again.'));
        } else if (xhr.status === 0) {
          reject(Object.assign(new Error('Request aborted'), { name: 'AbortError' }));
        } else if (xhr.status >= 500 || xhr.status === 502 || xhr.status === 503) {
          reject(new Error('AI service is temporarily unavailable. Please try again shortly.'));
        } else if (xhr.status !== 200) {
          reject(new Error(`AI request failed (${xhr.status}).`));
        } else {
          // Stream ended without an explicit "done" event — use what we have.
          resolve({ content: fullContent });
        }
      }
    };
    xhr.onerror = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error("Couldn't reach Brandthread AI."));
    };

    xhr.open('POST', `${apiBase}/api/v1/ai/chat/stream`);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.setRequestHeader('Authorization', `Bearer ${authToken}`);
    xhr.send(JSON.stringify(request));
  });
}

// ─── Send message ─────────────────────────────────────────────────────────────

export interface SendMessageParams {
  userText: string;
  session: AISession;
  authToken: string | null;
  userId?: string | null;
  storeContext?: string | null;
}

export interface SendMessageResult {
  /** New session with userMsg + aiMsg appended. Input session is NOT mutated. */
  session: AISession;
  /** The assistant message that was appended. */
  response: AIMessage;
}

/**
 * Send one user turn and return the updated session + assistant message.
 *
 * Contract:
 *  - Does NOT mutate the input `session`.
 *  - Returns exactly one new user message and one new assistant message.
 *  - Throws on abort (re-throws AbortError so caller can clean up).
 *  - Throws a user-facing Error string on auth/network/provider failures.
 *  - Never persists empty messages or streaming placeholders.
 */
async function buildChatRequest(session: AISession, userText: string): Promise<AIChatRequest> {
  // Build history for the API request (excludes the new user message —
  // we add it explicitly so the server sees it as the latest turn).
  const history = repairMessages(session.messages)
    .slice(-20)
    .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));
  history.push({ role: 'user', content: userText });

  const brandMemory = await getEnabledMemorySummary();

  return {
    messages: history,
    context: session.context,
    brandMemory: Object.keys(brandMemory).length > 0 ? brandMemory : undefined,
    maxTokens: 700,
  };
}

async function finalizeTurn(
  session: AISession,
  userText: string,
  response: AIChatResponse,
  userId?: string | null,
  storeContext?: string | null,
): Promise<{ newSession: AISession; userMsg: AIMessage; aiMsg: AIMessage }> {
  const userMsg: AIMessage = {
    id: nanoid(),
    role: 'user',
    content: userText,
    ts: Date.now(),
    contextLabel: contextLabel(session.context),
  };

  const aiMsg: AIMessage = {
    id: nanoid(),
    role: 'assistant',
    content: response.content ?? '',
    ts: Date.now(),
    isStreaming: false,
    error: response.error,
    contextLabel: contextLabel(session.context),
    sources: response.sources,
    actionCard: response.actionCard
      ? { ...response.actionCard, id: nanoid(), status: 'pending' }
      : undefined,
  };

  const newSession: AISession = {
    ...session,
    messages: [...session.messages, userMsg, aiMsg],
    updatedAt: Date.now(),
  };
  _currentSession = newSession;

  if (aiMsg.actionCard) {
    await addAuditEntry({
      eventType: 'suggested',
      screen: session.context.screen,
      actionType: aiMsg.actionCard.type,
      title: aiMsg.actionCard.title,
      canUndo: aiMsg.actionCard.canUndo,
    }).catch(() => { /* audit is best-effort */ });
  }

  await _persistSession(newSession, userId, storeContext);

  return { newSession, userMsg, aiMsg };
}

export async function sendMessage(params: SendMessageParams): Promise<SendMessageResult> {
  const { userText, session, authToken, userId, storeContext } = params;

  // Cancel any in-flight request from a previous turn.
  _activeController?.abort();
  _activeController = new AbortController();
  const { signal } = _activeController;

  const request = await buildChatRequest(session, userText);

  // --- Network call (may throw) ---
  let response: AIChatResponse;
  try {
    response = await callAI(request, authToken, signal);
  } catch (err: unknown) {
    // Re-throw AbortError — caller strips the streaming placeholder.
    if ((err as Error)?.name === 'AbortError') throw err;
    // Any other error: surface to caller as a real error string.
    throw err;
  }

  const { newSession, aiMsg } = await finalizeTurn(session, userText, response, userId, storeContext);
  return { session: newSession, response: aiMsg };
}

/**
 * Same contract as sendMessage(), but streams the assistant's reply via SSE.
 * `onDelta` is called with the cumulative text as tokens arrive so the caller
 * can render a live-typing preview; the returned session only appears once
 * the full turn (including sources/action card) has resolved.
 */
export async function sendMessageStream(
  params: SendMessageParams,
  onDelta: (textSoFar: string) => void,
): Promise<SendMessageResult> {
  const { userText, session, authToken, userId, storeContext } = params;

  _activeController?.abort();
  _activeController = new AbortController();
  const { signal } = _activeController;

  const request = await buildChatRequest(session, userText);

  let response: AIChatResponse;
  try {
    response = await callAIStream(request, authToken, onDelta, signal);
  } catch (err: unknown) {
    if ((err as Error)?.name === 'AbortError') throw err;
    throw err;
  }

  const { newSession, aiMsg } = await finalizeTurn(session, userText, response, userId, storeContext);
  return { session: newSession, response: aiMsg };
}

// ─── Cancel ───────────────────────────────────────────────────────────────────

export function cancelGeneration(): void {
  _activeController?.abort();
  _activeController = null;
}

// ─── Apply action ─────────────────────────────────────────────────────────────

export async function applyAction(
  session: AISession,
  messageId: string,
  confirmed: boolean,
  userId?: string | null,
  storeContext?: string | null,
): Promise<AISession> {
  const msg = session.messages.find(m => m.id === messageId);
  if (!msg?.actionCard) return session;

  const updatedCard: AIActionCard = {
    ...msg.actionCard,
    status: confirmed ? 'applied' : 'rejected',
  };

  const newSession: AISession = {
    ...session,
    messages: session.messages.map(m =>
      m.id === messageId ? { ...m, actionCard: updatedCard } : m,
    ),
    updatedAt: Date.now(),
  };
  _currentSession = newSession;

  await addAuditEntry({
    eventType: confirmed ? 'approved' : 'rejected',
    screen: session.context.screen,
    actionType: msg.actionCard.type,
    title: msg.actionCard.title,
    canUndo: msg.actionCard.canUndo,
  }).catch(() => { /* best-effort */ });

  await _persistSession(newSession, userId, storeContext);
  return newSession;
}

export async function undoAction(
  session: AISession,
  messageId: string,
  userId?: string | null,
  storeContext?: string | null,
): Promise<AISession> {
  const msg = session.messages.find(m => m.id === messageId);
  if (!msg?.actionCard || !msg.actionCard.canUndo) return session;

  const newSession: AISession = {
    ...session,
    messages: session.messages.map(m =>
      m.id === messageId
        ? { ...m, actionCard: m.actionCard ? { ...m.actionCard, status: 'undone' as const } : undefined }
        : m,
    ),
    updatedAt: Date.now(),
  };
  _currentSession = newSession;

  await addAuditEntry({
    eventType: 'undone',
    screen: session.context.screen,
    actionType: msg.actionCard.type,
    title: msg.actionCard.title,
    canUndo: false,
    affectedRecord: messageId,
  }).catch(() => { /* best-effort */ });

  await _persistSession(newSession, userId, storeContext);
  return newSession;
}

// ─── Home Suggestions ─────────────────────────────────────────────────────────

export async function getAISuggestions(
  authToken?: string | null,
  userId?: string | null,
): Promise<AISuggestion[]> {
  const storageKey = suggestionsKey(userId);

  const apiBase = process.env.EXPO_PUBLIC_API_BASE_URL ?? '';
  // Try real API suggestions first
  if (apiBase && authToken) {
    try {
      const res = await fetch(`${apiBase}/api/v1/ai/suggestions`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (res.ok) {
        const { suggestions } = await res.json() as { suggestions: AISuggestion[] };
        if (Array.isArray(suggestions) && suggestions.length > 0) {
          try {
            const raw = await AsyncStorage.getItem(storageKey);
            const stored: AISuggestion[] = raw ? JSON.parse(raw) : [];
            const dismissedIds = new Set(stored.filter(s => s.dismissedAt).map(s => s.id));
            const filtered = suggestions.filter(s => !dismissedIds.has(s.id));
            await AsyncStorage.setItem(storageKey, JSON.stringify([
              ...stored.filter(s => s.dismissedAt),
              ...filtered,
            ]));
            return filtered;
          } catch { return suggestions; }
        }
      }
    } catch { /* fall through — no fake fallback here */ }
  }

  // No API or no token — return cached suggestions or empty
  try {
    const raw = await AsyncStorage.getItem(storageKey);
    if (!raw) return [];
    const stored = JSON.parse(raw) as AISuggestion[];
    return stored.filter(s => !s.dismissedAt && !s.completedAt);
  } catch {
    return [];
  }
}

export async function dismissSuggestion(id: string, userId?: string | null): Promise<void> {
  try {
    const storageKey = suggestionsKey(userId);
    const all = await AsyncStorage.getItem(storageKey);
    const stored: AISuggestion[] = all ? JSON.parse(all) : [];
    const updated = stored.map(s => s.id === id ? { ...s, dismissedAt: Date.now() } : s);
    await AsyncStorage.setItem(storageKey, JSON.stringify(updated));
  } catch { /* best-effort */ }
}

export async function completeSuggestion(id: string, userId?: string | null): Promise<void> {
  try {
    const storageKey = suggestionsKey(userId);
    const all = await AsyncStorage.getItem(storageKey);
    const stored: AISuggestion[] = all ? JSON.parse(all) : [];
    const updated = stored.map(s => s.id === id ? { ...s, completedAt: Date.now() } : s);
    await AsyncStorage.setItem(storageKey, JSON.stringify(updated));
  } catch { /* best-effort */ }
}

// ─── Next Best Actions ────────────────────────────────────────────────────────

export async function getNextBestActions(
  authToken?: string | null,
  userId?: string | null,
): Promise<NextBestAction[]> {
  if (authToken) {
    try {
      const suggestions = await getAISuggestions(authToken, userId);
      if (suggestions.length > 0) {
        const iconMap: Record<string, string> = {
          inventory: 'layers',
          orders:    'package',
          content:   'video',
          marketing: 'zap',
          analytics: 'trending-up',
          customers: 'users',
          store:     'layout',
          production:'clock',
        };
        const colorMap: Record<string, string> = {
          inventory: '#F87171',
          orders:    '#F97316',
          content:   '#C7CDD5',
          marketing: '#22D3EE',
          analytics: '#34D399',
          customers: '#60A5FA',
          store:     '#F8FAFC',
          production:'#F59E0B',
        };
        return suggestions.slice(0, 5).map((s, i) => ({
          id:          s.id,
          title:       s.title,
          subtitle:    s.reason,
          icon:        iconMap[s.category] ?? 'star',
          accentColor: colorMap[s.category] ?? '#C7CDD5',
          route:       s.actionRoute,
          priority:    i + 1,
          category:    s.category as NextBestAction['category'],
        }));
      }
    } catch { /* fall through */ }
  }
  return [];
}

// ─── Internal test helpers (not for production use) ───────────────────────────

/** @internal Reset in-memory session state. Used in tests only. */
export function _resetSessionForTest(): void {
  _activeController = null;
  _currentSession = null;
  _lastSessionKey = null;
}
