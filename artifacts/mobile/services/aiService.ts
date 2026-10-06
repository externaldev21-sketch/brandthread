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
  NextBestAction, contextLabel,
} from './aiTypes';
import { getEnabledMemorySummary } from './aiBrandMemory';
import { addAuditEntry } from './aiAuditLog';
import { getPreviewAiReply } from '../lib/previewAiBrain';
import {
  aiDisabledError,
  normalizeAISettings,
  suggestionCategoryAllowed,
} from './aiSettingsPolicy';

// ─── ID helper ────────────────────────────────────────────────────────────────

function nanoid(): string {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

// ─── AsyncStorage key scoping ─────────────────────────────────────────────────

const SETTINGS_KEY = 'bt:ai:settings:v1';
/** Set while a settings change has not yet been accepted by the server. */
const SETTINGS_PENDING_KEY = 'bt:ai:settings:pending:v1';
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

/**
 * Device cache of the seller's AI Settings. The account copy lives on the
 * server (GET/PUT /api/v1/ai/settings) — see syncAISettingsFromServer() and
 * pushAISettings(). The cache is what the app reads offline and in the
 * signed-out web preview, which never calls the server.
 */
export async function getAISettings(): Promise<AISettings> {
  try {
    const raw = await AsyncStorage.getItem(SETTINGS_KEY);
    if (!raw) return normalizeAISettings(undefined);
    return normalizeAISettings(JSON.parse(raw));
  } catch {
    return normalizeAISettings(undefined);
  }
}

/** Writes the device cache only. Use pushAISettings() to sync to the account. */
export async function saveAISettings(settings: AISettings): Promise<void> {
  await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(normalizeAISettings(settings)));
}

/**
 * Loads the account's AI Settings from the server and refreshes the device
 * cache. Returns null (cache untouched) when there is no API base / token or
 * the request fails, so callers keep showing the cached copy.
 * Callers must not call this in dev/web preview (see lib/devPreview.ts).
 */
export async function syncAISettingsFromServer(authToken: string | null | undefined): Promise<AISettings | null> {
  const apiBase = process.env.EXPO_PUBLIC_API_BASE_URL ?? '';
  if (!apiBase || !authToken) return null;
  try {
    const res = await fetch(`${apiBase}/api/v1/ai/settings`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    if (!res.ok) return null;
    const body = await res.json() as { settings?: unknown; updatedAt?: string | null };
    const pending = await AsyncStorage.getItem(SETTINGS_PENDING_KEY).catch(() => null);
    if (!body.updatedAt || pending) {
      // Either a change made on this device (e.g. offline) has not reached
      // the server yet, or the account has no row (first sync after this
      // shipped) — the device's choices win instead of being reset.
      const local = await getAISettings();
      await pushAISettings(local, authToken);
      return local;
    }
    const settings = normalizeAISettings(body.settings);
    await saveAISettings(settings);
    return settings;
  } catch {
    return null;
  }
}

// Serialize writes so rapid toggles reach the server in order.
let _settingsPush: Promise<boolean> = Promise.resolve(true);

/**
 * Saves the settings to the device cache and to the account. Resolves true
 * when the server accepted them. Callers must not call this in dev/web
 * preview — use saveAISettings() there.
 */
export function pushAISettings(
  settings: AISettings,
  auth: string | null | undefined | (() => Promise<string | null>),
): Promise<boolean> {
  const normalized = normalizeAISettings(settings);
  const serialized = JSON.stringify(normalized);
  // The cache (and the pending marker) are written right away so a reader
  // sees the new value even while the network write is still queued.
  const cached = Promise.all([
    saveAISettings(normalized),
    AsyncStorage.setItem(SETTINGS_PENDING_KEY, serialized),
  ]).catch(() => { /* cache is best-effort */ });
  const run = async (): Promise<boolean> => {
    await cached;
    const apiBase = process.env.EXPO_PUBLIC_API_BASE_URL ?? '';
    if (!apiBase || !auth) return false;
    try {
      const authToken = typeof auth === 'function' ? await auth().catch(() => null) : auth;
      if (!authToken) return false;
      const res = await fetch(`${apiBase}/api/v1/ai/settings`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ settings: normalized }),
      });
      if (res.ok) {
        // Clear the marker only if no newer change was queued after this one.
        const stillPending = await AsyncStorage.getItem(SETTINGS_PENDING_KEY).catch(() => null);
        if (stillPending === serialized) {
          await AsyncStorage.removeItem(SETTINGS_PENDING_KEY).catch(() => { /* best-effort */ });
        }
      }
      return res.ok;
    } catch {
      return false;
    }
  };
  _settingsPush = _settingsPush.then(run, run);
  return _settingsPush;
}

/** The server said the assistant is off for this account — mirror that in the cache. */
async function markAssistantDisabledLocally(): Promise<void> {
  try {
    const current = await getAISettings();
    if (current.enabled) await saveAISettings({ ...current, enabled: false });
  } catch { /* best-effort */ }
}

function isAIDisabledBody(text: string): boolean {
  try {
    return (JSON.parse(text) as { code?: string })?.code === 'AI_DISABLED';
  } catch {
    return false;
  }
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
    if (res.status === 403) {
      const text = await res.text().catch(() => '');
      if (isAIDisabledBody(text)) {
        await markAssistantDisabledLocally();
        throw aiDisabledError();
      }
    }
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
        if (xhr.status === 403 && isAIDisabledBody(xhr.responseText ?? '')) {
          markAssistantDisabledLocally().finally(() => reject(aiDisabledError()));
        } else if (xhr.status === 401 || xhr.status === 403) {
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

  const settings = await getAISettings();
  // "Brand Memory" off → the summary is never sent (the server also drops it).
  const brandMemory = settings.brandMemoryEnabled ? await getEnabledMemorySummary() : {};

  return {
    messages: history,
    context: session.context,
    brandMemory: Object.keys(brandMemory).length > 0 ? brandMemory : undefined,
    maxTokens: 700,
    aiSettings: settings,
  };
}

/** Throws AIDisabledError when "Enable AI assistant" is off on this device. */
async function assertAssistantEnabled(): Promise<void> {
  const settings = await getAISettings();
  if (!settings.enabled) throw aiDisabledError();
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

  await assertAssistantEnabled();

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

  await assertAssistantEnabled();

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

/**
 * Preview-only counterpart to sendMessageStream() — same contract and
 * return shape, but never calls the real (paid, auth-gated) AI endpoint.
 * The reply comes from lib/previewAiBrain.ts's template answers over the
 * same seeded preview data every other dev-preview screen uses. Callers
 * must gate on isSellerDevPreview()/isBuyerDevPreview() before using this;
 * it does not re-check that itself so the gate stays visible at the call
 * site (see app/ai-brain.tsx).
 */
export async function sendPreviewMessageStream(
  params: Pick<SendMessageParams, 'userText' | 'session' | 'userId' | 'storeContext'>,
  onDelta: (textSoFar: string) => void,
): Promise<SendMessageResult> {
  const { userText, session, userId, storeContext } = params;

  await assertAssistantEnabled();

  const fullReply = getPreviewAiReply(userText);

  // A light word-by-word reveal so the preview exercises the same streaming
  // UI (typing dots → live text) a real reply would, instead of popping in
  // instantly — without any network round-trip.
  const words = fullReply.split(' ');
  let shown = '';
  for (const word of words) {
    shown = shown ? `${shown} ${word}` : word;
    onDelta(shown);
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, 18));
  }

  const { newSession, aiMsg } = await finalizeTurn(session, userText, { content: fullReply }, userId, storeContext);
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

  // "Enable AI assistant" / "Dashboard suggestions" off → nothing is fetched
  // or shown; a disabled data source hides its category (the server applies
  // the same rules to what it computes).
  const settings = await getAISettings();
  if (!settings.enabled || !settings.suggestionsEnabled) return [];
  const allowed = (s: AISuggestion) => suggestionCategoryAllowed(s.category, settings);

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
            const filtered = suggestions.filter(s => !dismissedIds.has(s.id) && allowed(s));
            await AsyncStorage.setItem(storageKey, JSON.stringify([
              ...stored.filter(s => s.dismissedAt),
              ...filtered,
            ]));
            return filtered;
          } catch { return suggestions.filter(allowed); }
        }
      }
    } catch { /* fall through — no fake fallback here */ }
  }

  // No API or no token — return cached suggestions or empty
  try {
    const raw = await AsyncStorage.getItem(storageKey);
    if (!raw) return [];
    const stored = JSON.parse(raw) as AISuggestion[];
    return stored.filter(s => !s.dismissedAt && !s.completedAt && allowed(s));
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
