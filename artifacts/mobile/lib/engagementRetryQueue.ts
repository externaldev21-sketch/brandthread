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
import { AppState } from 'react-native';
import { classifyNetworkError } from './networkNotice';
import { accountStorageKey, adoptLegacyKey, getAccountStorageScope } from './accountStorage';

export type EngagementActionKind = 'like' | 'save' | 'repost' | 'follow' | 'not_interested';

export interface QueuedEngagementAction {
  /** Stable id for this queued action — used to de-dupe repeated taps on the same target+kind. */
  id: string;
  kind: EngagementActionKind;
  targetId: string;
  payload?: Record<string, unknown>;
  attempts: number;
  createdAt: number;
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
let processing = false;
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
      .then((raw) => { if (loadedScope === scope) queue = raw ? JSON.parse(raw) : []; })
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

/** A screen registers how to actually replay each kind of queued action. */
export function setEngagementRetryExecutor(fn: ((action: QueuedEngagementAction) => Promise<void>) | null): void {
  executor = fn;
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
  queue.push({ id, ...action, attempts: 0, createdAt: Date.now() });
  await persist();
  void processEngagementRetryQueue();
}

export async function processEngagementRetryQueue(): Promise<void> {
  await load();
  if (processing || !executor || queue.length === 0) return;
  processing = true;
  const scope = loadedScope;
  try {
    const active = executor;
    const remaining: QueuedEngagementAction[] = [];
    for (const action of queue) {
      // Never replay one account's queued actions after switching to another.
      if (getAccountStorageScope() !== scope) return;
      try {
        await active(action);
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
    queue = remaining;
    await persist(scope);
  } finally {
    processing = false;
  }
}

/** Call once per screen lifetime (e.g. the feed) to drain the queue on an interval and whenever the app returns to the foreground. Returns a cleanup function. */
export function startEngagementRetryQueuePump(intervalMs = 20_000): () => void {
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
  processing = false;
}
