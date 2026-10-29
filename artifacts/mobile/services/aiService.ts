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
import { resolveAccountKey } from '@/lib/accountStorage';
import { isSellerDevPreview } from '@/lib/devPreview';
import { fetchWithTimeout } from '@/lib/fetchWithTimeout';

/** Non-streaming AI chat replies can take a while; still never hang forever. */
const AI_REQUEST_TIMEOUT_MS = 90_000;
const AI_STREAM_TIMEOUT_MS = 120_000;
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
import { AiConsentRequiredError, isAiConsentRequiredBody, withAiConsent } from '@/lib/aiConsent';
import { AI_CREDITS_ALERT_COPY, routeAiCreditsRefusal, type AiCreditsErrorKind } from '../lib/aiCreditsError';
import { classifyAiCreditsError, surfaceAiCreditsError } from '@/lib/aiCreditsError';

// ─── ID helper ────────────────────────────────────────────────────────────────

function nanoid(): string {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

// ─── AsyncStorage key scoping ─────────────────────────────────────────────────

/** Legacy device-wide key; stored per account (first signed-in account claims it). */
const SETTINGS_KEY = 'bt:ai:settings:v1';
/** Set while a settings change has not yet been accepted by the server. */
const SETTINGS_PENDING_KEY = 'bt:ai:settings:pending:v1';
const settingsKey = () => resolveAccountKey(SETTINGS_KEY, 'claim');
const pendingSettingsKey = () => resolveAccountKey(SETTINGS_PENDING_KEY, 'claim');
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
    const raw = await AsyncStorage.getItem(await settingsKey());
    if (!raw) return normalizeAISettings(undefined);
    return normalizeAISettings(JSON.parse(raw));
  } catch {
    return normalizeAISettings(undefined);
  }
}

const settingsListeners = new Set<(settings: AISettings) => void>();

export function subscribeAISettings(listener: (settings: AISettings) => void): () => void {
  settingsListeners.add(listener);
  return () => { settingsListeners.delete(listener); };
}

/** Writes the device cache only. Use pushAISettings() to sync to the account. */
export async function saveAISettings(settings: AISettings): Promise<void> {
  const normalized = normalizeAISettings(settings);
  const key = await settingsKey();
  await AsyncStorage.setItem(key, JSON.stringify(normalized));
  if (key !== await settingsKey()) return;
  for (const listener of settingsListeners) listener(normalized);
}

export function confirmationFor(
  card: Pick<AIActionCard, 'type' | 'title' | 'description' | 'isDestructive' | 'requiresConfirmation'>,
  settings: Pick<AISettings, 'confirmSensitiveActions' | 'confirmDestructiveActions' | 'confirmPublishing' | 'confirmSending'>,
): { title: string; message: string; destructive: boolean } | null {
  const text = `${card.title} ${card.description ?? ''}`.toLowerCase();
  if (card.isDestructive && settings.confirmDestructiveActions) {
    return { title: 'Apply action', message: `Apply "${card.title}"? This cannot be undone.`, destructive: true };
  }
  if ((card.type === 'schedule' || /\b(publish|go live|make (it )?live)\b/.test(text)) && settings.confirmPublishing) {
    return { title: 'Publish?', message: `"${card.title}" will make this visible to buyers.`, destructive: false };
  }
  if (/\b(send|email|message|notify|push)\b/.test(text) && settings.confirmSending) {
    return { title: 'Send?', message: `"${card.title}" will send to your customers or followers.`, destructive: false };
  }
  return card.requiresConfirmation && settings.confirmSensitiveActions
    ? { title: 'Apply action', message: `Apply "${card.title}"?`, destructive: false } : null;
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
    const res = await fetchWithTimeout(`${apiBase}/api/v1/ai/settings`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    if (!res.ok) return null;
    const body = await res.json() as { settings?: unknown; updatedAt?: string | null };
    const pending = await AsyncStorage.getItem(await pendingSettingsKey()).catch(() => null);
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
  const pendingKey = pendingSettingsKey();
  // The cache (and the pending marker) are written right away so a reader
  // sees the new value even while the network write is still queued.
  const cached = Promise.all([
    saveAISettings(normalized),
    pendingKey.then((key) => AsyncStorage.setItem(key, serialized)),
  ]).catch(() => { /* cache is best-effort */ });
  const run = async (): Promise<boolean> => {
    await cached;
    const apiBase = process.env.EXPO_PUBLIC_API_BASE_URL ?? '';
    if (!apiBase || !auth) return false;
    try {
      const authToken = typeof auth === 'function' ? await auth().catch(() => null) : auth;
      if (!authToken) return false;
      // Bounded: writes are serialized, so one hung PUT would otherwise hold
      // every later settings change back forever.
      const res = await fetchWithTimeout(`${apiBase}/api/v1/ai/settings`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ settings: normalized }),
      });
      if (res.ok) {
        // Clear the marker only if no newer change was queued after this one.
        const key = await pendingKey;
        const stillPending = await AsyncStorage.getItem(key).catch(() => null);
        if (stillPending === serialized) {
          await AsyncStorage.removeItem(key).catch(() => { /* best-effort */ });
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

/** Copy for an out-of-credits refusal (the AI credits screen is opened too). */
export const AI_OUT_OF_CREDITS_MESSAGE = "You're out of AI credits. Add credits to keep chatting.";

/** An AI chat failure that carries the server's status and credit-gate code. */
export type AIRequestError = Error & { status?: number; code?: AiCreditsErrorKind };

/**
 * The AI credit gate's refusals (402 insufficient_credits, 429 user_daily_cap,
 * 503 global_daily_cap) keep their server code so the screen can tell a daily
 * cap ("resets tomorrow") from burst rate limiting. A 402 also opens the AI
 * credits screen, the same way lib/api.ts surfaceAiCreditsError does for
 * every other AI endpoint (this chat endpoint does not go through lib/api.ts).
 */
function creditGateError(status: number, text: string): AIRequestError | null {
  const kind = classifyAiCreditsError(status, text);
  if (!kind) return null;
  if (kind === 'insufficient_credits') surfaceAiCreditsError(kind);
  const message = kind === 'insufficient_credits' ? AI_OUT_OF_CREDITS_MESSAGE : AI_CREDITS_ALERT_COPY[kind].message;
  return Object.assign(new Error(message), { status, code: kind });
}

// ─── Session repair ───────────────────────────────────────────────────────────

/** A double write of the same message lands within this window. */
const DUPLICATE_WINDOW_MS = 2_000;

/**
 * Remove empty messages and deduplicate consecutive identical messages.
 * Preserves ordering. Called on every session load.
 */
function repairMessages(messages: AIMessage[]): AIMessage[] {
  const out: AIMessage[] = [];
  for (const m of messages) {
    // Strip any persisted streaming placeholders (should never be stored)
    if (m.isStreaming) continue;
    // Drop empty messages
    if (!m.content?.trim() && !m.error) continue;
    // Drop an exact duplicate of the message right before it (same role +
    // content within 2 s). The same question asked again later in the
    // conversation is a real turn and is kept.
    const prev = out[out.length - 1];
    if (prev && prev.role === m.role && prev.content === m.content &&
        Math.abs((m.ts ?? 0) - (prev.ts ?? 0)) <= DUPLICATE_WINDOW_MS) continue;
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

/**
 * Make `session` the in-memory current session — unless the screen has since
 * loaded another account's / store's session (a turn that finished after an
 * account switch must not replace the new account's conversation in memory;
 * it is still persisted under its own key).
 */
function setCurrentSessionFor(session: AISession, userId?: string | null, storeContext?: string | null): void {
  if (_lastSessionKey !== null && _lastSessionKey !== sessionKey(userId, storeContext)) return;
  _currentSession = session;
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
  // Called without an account (AI Settings → Clear history): clear the
  // conversation that was actually loaded, not the signed-out 'anon' slot.
  const key = userId === undefined && storeContext === undefined && _lastSessionKey
    ? _lastSessionKey
    : sessionKey(userId, storeContext);
  await AsyncStorage.removeItem(key);
}

// ─── Errors ───────────────────────────────────────────────────────────────────

export type AIServiceErrorCode = AiCreditsErrorKind | 'auth' | 'rate_limited' | 'unavailable' | 'network' | 'http';

/** A failed AI request, carrying the server's error code so the UI can pick copy. */
export class AIServiceError extends Error {
  constructor(message: string, public readonly code: AIServiceErrorCode, public readonly status?: number) {
    super(message);
    this.name = 'AIServiceError';
  }
}

export const AI_DAILY_CAP_MESSAGE = AI_CREDITS_ALERT_COPY.user_daily_cap.message;
export const AI_NO_CREDITS_MESSAGE = "You're out of AI credits — add more to keep going.";
export const AI_NETWORK_MESSAGE = "Couldn't reach Brandthread AI.";

/**
 * Maps a non-2xx AI response to an AIServiceError. The AI credit gate's
 * refusals keep their code (a 429 `user_daily_cap` is a daily cap, not the
 * per-minute rate limit), and a 402 is routed to the AI credits screen.
 */
function aiHttpError(status: number, body: string): AIServiceError {
  const creditsKind = routeAiCreditsRefusal(status, body);
  if (creditsKind === 'insufficient_credits') return new AIServiceError(AI_NO_CREDITS_MESSAGE, creditsKind, status);
  if (creditsKind === 'user_daily_cap') return new AIServiceError(AI_DAILY_CAP_MESSAGE, creditsKind, status);
  if (creditsKind === 'global_daily_cap') return new AIServiceError(AI_CREDITS_ALERT_COPY.global_daily_cap.message, creditsKind, status);
  if (status === 401 || status === 403) {
    return new AIServiceError('Authentication error. Please sign in again.', 'auth', status);
  }
  if (status === 429) {
    return new AIServiceError('Rate limit reached — please wait a moment and try again.', 'rate_limited', status);
  }
  if (status >= 500) {
    return new AIServiceError('AI service is temporarily unavailable. Please try again shortly.', 'unavailable', status);
  }
  let serverMessage: string | undefined;
  try {
    const parsed = JSON.parse(body) as { error?: unknown };
    if (typeof parsed?.error === 'string') serverMessage = parsed.error;
  } catch { /* non-JSON body */ }
  return new AIServiceError(serverMessage ?? `AI request failed (${status}).`, 'http', status);
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
  if (isSellerDevPreview()) {
    throw new Error('Brandthread AI is unavailable in the signed-out seller preview.');
  }
  const apiBase = process.env.EXPO_PUBLIC_API_BASE_URL ?? '';
  if (!apiBase) {
    throw new Error('AI service is not configured. Check your API base URL.');
  }
  if (!authToken) {
    throw new Error('Sign in to use Brandthread AI.');
  }

  const res = await fetchWithTimeout(`${apiBase}/api/v1/ai/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify(request),
    signal,
  }, AI_REQUEST_TIMEOUT_MS);

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (res.status === 403) {
      const text = body;
      if (isAIDisabledBody(text)) {
        await markAssistantDisabledLocally();
        throw aiDisabledError();
      }
      if (isAiConsentRequiredBody(403, text)) throw new AiConsentRequiredError();
    }
    throw aiHttpError(res.status, body);
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
    // XHR reports both a cancelled request and a network failure as status
    // 0, so remember whether *we* aborted to tell the two apart.
    let aborted = false;

    const onAbort = () => {
      aborted = true;
      xhr.abort();
    };
    // Stopped before the request went out (e.g. while the request body was
    // being built): never send it.
    if (signal.aborted) {
      reject(Object.assign(new Error('Request aborted'), { name: 'AbortError' }));
      return;
    }
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
        const gate = creditGateError(xhr.status, xhr.responseText ?? '');
        if (gate) {
          reject(gate);
        } else if (xhr.status === 403 && isAIDisabledBody(xhr.responseText ?? '')) {
          markAssistantDisabledLocally().finally(() => reject(aiDisabledError()));
        } else if (xhr.status === 403 && isAiConsentRequiredBody(403, xhr.responseText)) {
          reject(new AiConsentRequiredError());
          return;
        } else if (xhr.status === 0) {
          reject(aborted || signal.aborted
            ? Object.assign(new Error('Request aborted'), { name: 'AbortError' })
            : new AIServiceError(AI_NETWORK_MESSAGE, 'network', 0));
        } else if (xhr.status !== 200) {
          reject(aiHttpError(xhr.status, xhr.responseText ?? ''));
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
      reject(aborted || signal.aborted
        ? Object.assign(new Error('Request aborted'), { name: 'AbortError' })
        : new AIServiceError(AI_NETWORK_MESSAGE, 'network', 0));
    };

    // A stalled stream ends in an error the chat can show, not an endless
    // typing indicator.
    xhr.timeout = AI_STREAM_TIMEOUT_MS;
    xhr.ontimeout = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('Brandthread AI took too long to answer. Please try again.'));
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
  setCurrentSessionFor(newSession, userId, storeContext);

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
    response = await withAiConsent(() => callAI(request, authToken, signal));
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
    // First AI use: ask before sending the conversation to the provider (QA-0043).
    response = await withAiConsent(() => callAIStream(request, authToken, onDelta, signal));
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
  setCurrentSessionFor(newSession, userId, storeContext);

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
  setCurrentSessionFor(newSession, userId, storeContext);

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
  if (!isSellerDevPreview() && apiBase && authToken) {
    try {
      const res = await fetchWithTimeout(`${apiBase}/api/v1/ai/suggestions`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (res.ok) {
        const { suggestions } = await res.json() as { suggestions: AISuggestion[] };
        // An empty list is a real answer (everything was handled): it replaces
        // the cache instead of falling back to suggestions that no longer apply.
        if (Array.isArray(suggestions)) {
          try {
            const raw = await AsyncStorage.getItem(storageKey);
            const stored: AISuggestion[] = raw ? JSON.parse(raw) : [];
            // Dismissed and completed suggestions stay hidden (the cached
            // path below filters both) — keep their markers across refetches.
            const handled = stored.filter(s => s.dismissedAt || s.completedAt);
            const handledIds = new Set(handled.map(s => s.id));
            const filtered = suggestions.filter(s => !handledIds.has(s.id) && allowed(s));
            await AsyncStorage.setItem(storageKey, JSON.stringify([
              ...handled,
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
