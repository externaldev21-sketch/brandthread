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

const STORAGE_KEY = 'bt:engagement-retry-queue:v1';
const MAX_ATTEMPTS = 8;

let queue: QueuedEngagementAction[] = [];
let loaded = false;
let loadPromise: Promise<void> | null = null;
let executor: ((action: QueuedEngagementAction) => Promise<void>) | null = null;
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
  if (loaded) return Promise.resolve();
  if (!loadPromise) {
    loadPromise = AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => { queue = raw ? JSON.parse(raw) : []; })
      .catch(() => { queue = []; })
      .finally(() => { loaded = true; });
  }
  return loadPromise;
}

async function persist(): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
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
  if (!executor && fallbacks.size === 0) return;
  processing = true;
  try {
    const active = executor;
    const owner = currentOwner();
    const remaining: QueuedEngagementAction[] = [];
    for (const action of queue) {
      // A kind with its own registered handler always uses it (the feed's
      // executor only knows the feed's kinds); everything else goes through
      // the screen executor.
      const run = fallbacks.get(action.kind) ?? active;
      // Not replayable right now (no handler, or another account is signed
      // in): keep it for later, untouched.
      if (!run || (action.ownerId && action.ownerId !== owner)) {
        remaining.push(action);
        continue;
      }
      try {
        await run(action);
      } catch (error) {
        if (isRetryableFailure(error) && action.attempts + 1 < MAX_ATTEMPTS) {
          remaining.push({ ...action, attempts: action.attempts + 1 });
        }
        // A non-retryable failure, or too many attempts, drops the action —
        // the optimistic UI state is left as-is rather than surprising the
        // buyer with a rollback long after they moved on.
      }
    }
    queue = remaining;
    await persist();
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
  executor = null;
  processing = false;
  fallbacks.clear();
  ownerResolver = null;
  globalPumpStarted = false;
}
