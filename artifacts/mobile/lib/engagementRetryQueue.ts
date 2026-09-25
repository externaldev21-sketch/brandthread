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

const STORAGE_KEY = 'bt:engagement-retry-queue:v1';
const MAX_ATTEMPTS = 8;

let queue: QueuedEngagementAction[] = [];
let loaded = false;
let loadPromise: Promise<void> | null = null;
let executor: ((action: QueuedEngagementAction) => Promise<void>) | null = null;
let processing = false;
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
  try {
    const active = executor;
    const remaining: QueuedEngagementAction[] = [];
    for (const action of queue) {
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
    queue = remaining;
    await persist();
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
  executor = null;
  processing = false;
}
