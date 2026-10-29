/**
 * Offline-safe retry queue for feed engagement actions (like/save/repost/
 * follow). The optimistic UI state (EngagementState in feed.tsx) always
 * updates instantly regardless of connectivity; this queue is what makes
 * that state eventually consistent with the server once the request that
 * was supposed to persist it actually fails for a connectivity reason
 * (offline, timeout, 5xx) rather than a real rejection (403/404/etc, which
 * still rolls back immediately at the call site).
 *
 * No NetInfo dependency: reachability is inferred from the failure itself
 * (lib/networkNotice's classifyNetworkError) plus a periodic pump and an
 * AppState-active nudge, which is enough to drain the queue shortly after
 * connectivity actually returns without adding a new native module.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { classifyNetworkError } from './networkNotice';
import { accountStorageKey, adoptLegacyKey, getAccountStorageScope, setAccountStorageScope } from './accountStorage';

export type EngagementActionKind = 'like' | 'save' | 'repost' | 'follow' | 'not_interested' | 'save_product';

export interface QueuedEngagementAction {
  /** Stable id for this queued action — used to de-dupe repeated taps on the same target+kind. */
  id: string;
  kind: EngagementActionKind;
  targetId: string;
  payload?: Record<string, unknown>;
  attempts: number;
  createdAt: number;
  /** Account that queued it — only ever replayed while that account is signed in. */
  ownerId?: string;
}

/** Pre-scoping device-wide key. Dropped, never claimed: replaying actions
 *  queued by one account would like/follow as whichever account is signed in. */
const LEGACY_STORAGE_KEY = 'bt:engagement-retry-queue:v1';
const MAX_ATTEMPTS = 8;

let queue: QueuedEngagementAction[] = [];
let loaded = false;
let loadPromise: Promise<void> | null = null;
/** Account whose queue is in memory; a different signed-in account reloads its own. */
let loadedScope: string | null = null;
let executor: ((action: QueuedEngagementAction) => Promise<void>) | null = null;
let globalFallbackExecutor: ((action: QueuedEngagementAction) => Promise<boolean>) | null = null;
let processing = false;
// Per-kind handlers used while no screen executor is registered (e.g. a
// follow queued from a profile screen while the feed isn't mounted).
const fallbacks = new Map<EngagementActionKind, (action: QueuedEngagementAction) => Promise<void>>();
let ownerResolver: (() => string | null) | null = null;
let globalPumpStarted = false;
const listeners = new Set<(queue: QueuedEngagementAction[]) => void>();

function emit() {
  listeners.forEach((listener) => listener(queue));
}

function load(): Promise<void> {
  const scope = getAccountStorageScope();
  if (loadedScope !== scope) {
    // Account switch: forget the previous account's in-memory queue (it stays
    // persisted under that account's key and resumes when it signs back in).
    queue = [];
    loaded = false;
    loadPromise = null;
    loadedScope = scope;
  }
  if (loaded) return Promise.resolve();
  if (!loadPromise) {
    loadPromise = adoptLegacyKey(LEGACY_STORAGE_KEY, 'drop')
      .then(() => AsyncStorage.getItem(accountStorageKey(LEGACY_STORAGE_KEY, scope)))
      .then((raw) => {
        if (loadedScope !== scope) return;
        const parsed = raw ? JSON.parse(raw) : [];
        queue = Array.isArray(parsed) ? parsed : [];
      })
      .catch(() => { if (loadedScope === scope) queue = []; })
      .finally(() => { if (loadedScope === scope) loaded = true; });
  }
  return loadPromise;
}

async function persist(scope: string | null = loadedScope): Promise<void> {
  if (scope === null || scope !== loadedScope) return;
  try {
    await AsyncStorage.setItem(accountStorageKey(LEGACY_STORAGE_KEY, scope), JSON.stringify(queue));
  } catch {
    // Best-effort — a failed persist just means a cold-start won't recover
    // this particular pending action; the in-memory queue still retries it
    // for the rest of this session.
  }
  emit();
}

/**
 * Call on sign-in/sign-out/account switch (app/_layout.tsx), before anything
 * enqueues. Switches the queue to that account's own stored entries.
 */
export function initEngagementRetryQueue(userId: string | null): void {
  setAccountStorageScope(userId);
  const next = userId ?? 'anon';
  if (next === loadedScope) return;
  loadedScope = next;
  queue = [];
  loaded = false;
  loadPromise = null;
  emit();
}

/** Drop an account's queued actions (explicit sign-out). */
export async function clearEngagementRetryQueue(userId: string): Promise<void> {
  if (userId === loadedScope) {
    queue = [];
    loadedScope = null;
    loaded = false;
    loadPromise = null;
    emit();
  }
  try {
    await AsyncStorage.removeItem(accountStorageKey(LEGACY_STORAGE_KEY, userId));
  } catch {
    // Best-effort.
  }
}

/** A screen registers how to actually replay each kind of queued action. */
export function setEngagementRetryExecutor(fn: ((action: QueuedEngagementAction) => Promise<void>) | null): void {
  executor = fn;
}

/** App-wide replay handles only actions it understands, without replacing a screen's executor. */
export function setFallbackEngagementRetryExecutor(fn: ((action: QueuedEngagementAction) => Promise<boolean>) | null): void {
  globalFallbackExecutor = fn;
}

/** Replays `kind` when no screen executor is registered. */
export function setEngagementRetryFallback(
  kind: EngagementActionKind,
  fn: ((action: QueuedEngagementAction) => Promise<void>) | null,
): void {
  if (fn) fallbacks.set(kind, fn);
  else fallbacks.delete(kind);
}

/** Who is signed in right now. Queued actions are stamped with it and only
 *  replayed for the same account, so one account's queued like/follow can
 *  never be sent under another account's session on a shared device. */
export function setEngagementRetryOwnerResolver(fn: (() => string | null) | null): void {
  ownerResolver = fn;
}

function currentOwner(): string | null {
  const owner = ownerResolver?.() ?? null;
  return owner && owner !== 'anon' ? owner : null;
}

/** True for connectivity/server-outage failures — anything else (a real 4xx rejection) should roll back instead of queuing. */
export function isRetryableFailure(error: unknown): boolean {
  return classifyNetworkError(error) !== null;
}

export function subscribeEngagementRetryQueue(listener: (queue: QueuedEngagementAction[]) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function enqueueEngagementRetry(action: Pick<QueuedEngagementAction, 'kind' | 'targetId' | 'payload'>): Promise<void> {
  await load();
  const id = `${action.kind}:${action.targetId}`;
  // Last write wins per (kind, target) — a rapid like/unlike toggle while
  // offline should only replay the final intended state, not every step.
  queue = queue.filter((a) => a.id !== id);
  const ownerId = currentOwner();
  queue.push({ id, ...action, attempts: 0, createdAt: Date.now(), ...(ownerId ? { ownerId } : {}) });
  await persist();
  void processEngagementRetryQueue();
}

export async function processEngagementRetryQueue(): Promise<void> {
  await load();
  if (processing || queue.length === 0) return;
  if (!executor && fallbacks.size === 0 && !globalFallbackExecutor) return;
  processing = true;
  const scope = loadedScope;
  try {
    const active = executor;
    const globalFallback = globalFallbackExecutor;
    const owner = currentOwner();
    const remaining: QueuedEngagementAction[] = [];
    // Snapshot: enqueueEngagementRetry can run while a replay is awaited, and
    // what it adds must survive the write-back below.
    const snapshot = queue;
    for (const action of snapshot) {
      // Never replay one account's queued actions after switching to another.
      if (getAccountStorageScope() !== scope) return;
      // A kind with its own registered handler always uses it (the feed's
      // executor only knows the feed's kinds); everything else goes through
      // the screen executor.
      const run = fallbacks.get(action.kind) ?? active;
      // Not replayable right now (no handler, or another account is signed
      // in): keep it for later, untouched.
      if ((!run && !globalFallback) || (action.ownerId && action.ownerId !== owner)) {
        remaining.push(action);
        continue;
      }
      try {
        if (run) await run(action);
        else if (!(await globalFallback!(action))) {
          remaining.push(action);
          continue;
        }
      } catch (error) {
        if (isRetryableFailure(error) && action.attempts + 1 < MAX_ATTEMPTS) {
          remaining.push({ ...action, attempts: action.attempts + 1 });
        }
        // A non-retryable failure, or too many attempts, drops the action —
        // the optimistic UI state is left as-is rather than surprising the
        // buyer with a rollback long after they moved on.
      }
    }
    if (getAccountStorageScope() !== scope || loadedScope !== scope) return;
    // Taps queued during this pass are new objects in `queue`; they win over
    // this pass's copy of the same (kind, target) and keep their place.
    const added = queue.filter((action) => !snapshot.includes(action));
    const addedIds = new Set(added.map((action) => action.id));
    queue = [...remaining.filter((action) => !addedIds.has(action.id)), ...added];
    await persist(scope);
  } finally {
    processing = false;
  }
}

/** Call once per screen lifetime (e.g. the feed) to drain the queue on an interval and whenever the app returns to the foreground. Returns a cleanup function. */
export function startEngagementRetryQueuePump(intervalMs = 20_000): () => void {
  // Loaded lazily: services/socialService.ts registers retry handlers on this
  // module at import time, and plain-node tests of that service never load
  // react-native.
  const { AppState } = require('react-native') as typeof import('react-native');
  const sub = AppState.addEventListener('change', (state) => {
    if (state === 'active') void processEngagementRetryQueue();
  });
  const interval = setInterval(() => { void processEngagementRetryQueue(); }, intervalMs);
  void processEngagementRetryQueue();
  return () => {
    sub.remove();
    clearInterval(interval);
  };
}

/** Idempotent app-wide pump, for screens that queue actions outside the feed. */
export function ensureEngagementRetryPump(): void {
  if (globalPumpStarted) return;
  globalPumpStarted = true;
  startEngagementRetryQueuePump();
}

export function getQueuedEngagementActions(): QueuedEngagementAction[] {
  return queue;
}

/** Test-only: reset in-memory state between test cases. */
export function __resetEngagementRetryQueueForTests(): void {
  queue = [];
  loaded = false;
  loadPromise = null;
  loadedScope = null;
  executor = null;
  globalFallbackExecutor = null;
  processing = false;
  fallbacks.clear();
  ownerResolver = null;
  globalPumpStarted = false;
  setAccountStorageScope(null);
}
