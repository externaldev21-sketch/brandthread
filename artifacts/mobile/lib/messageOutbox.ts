/**
 * Offline outbox for chat messages.
 *
 * A message the user sends is written here first, shown in the thread with
 * the chat's existing "sending" clock, and removed once the server stores it.
 * When the send fails because the device is offline or the server is briefly
 * unreachable, the entry simply stays queued (still "sending") and is
 * replayed later — on reconnect, when the app returns to the foreground, or
 * on the pump's interval (see lib/messageOutboxPump.ts) — in the order it was
 * written. A real rejection (moderation, blocked, request not accepted, …) is
 * dropped from the queue and handed back to the screen so it can show the
 * server's message and restore the composer, exactly like before.
 *
 * Every entry carries a client message id that is sent with each attempt.
 * The server stores it (migration 263) and answers a repeat of an already
 * stored send with that same row, so a retry after a lost response never
 * produces a duplicate message.
 *
 * Persisted in AsyncStorage per (user, conversation), so two accounts on one
 * device never see or replay each other's queued messages.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { classifyNetworkError } from './networkNotice';
import type { Message } from '@/services/socialTypes';

export type OutboxStatus = 'sending' | 'failed';

export interface OutboxDraft {
  text: string;
  attachment?: unknown;
  replyToId?: string;
  /** Display-only: the quote strip for a reply, so a queued reply renders the same as a sent one. */
  replyPreview?: string;
  replyToAuthorName?: string;
}

export interface OutboxEntry extends OutboxDraft {
  clientMessageId: string;
  conversationId: string;
  createdAt: number;
  /** Server-side failures so far (offline attempts are not counted). */
  attempts: number;
  status: OutboxStatus;
}

/** What the screen passes in to actually deliver one entry. Resolves with the stored message. */
export type OutboxSender = (entry: OutboxEntry) => Promise<unknown>;

/** Emitted whichever caller (screen or background pump) ran the flush, so an
 *  open thread can react to a send it didn't start itself. */
export type OutboxEvent =
  /** The server stored it; the entry is already removed from the queue. */
  | { type: 'sent'; userId: string; entry: OutboxEntry; result: unknown }
  /** The server refused it for good; the entry is already removed from the queue. */
  | { type: 'rejected'; userId: string; entry: OutboxEntry; error: unknown };

/** Thrown by a sender when the signed-in account no longer owns the queue it
 *  was asked to deliver — the entry stays queued for its own account. */
export class OutboxAccountMismatchError extends Error {
  constructor() {
    super('Outbox belongs to a different account');
    this.name = 'OutboxAccountMismatchError';
  }
}

/** Server-side (5xx/timeout) failures in a row before an entry stops retrying on
 *  its own and shows the chat's existing "Tap to retry" state instead. */
export const MAX_SERVER_ATTEMPTS = 5;

const STORAGE_PREFIX = 'bt:message-outbox:v1:';
export const OUTBOX_MESSAGE_ID_PREFIX = 'outbox-';

// ─── Pure helpers ───────────────────────────────────────────────────────────

export function outboxStorageKey(userId: string, conversationId: string): string {
  return `${STORAGE_PREFIX}${userId}:${conversationId}`;
}

export function outboxIndexKey(userId: string): string {
  return `${STORAGE_PREFIX}${userId}:index`;
}

let idCounter = 0;
/** Opaque id accepted by the server's parseClientMessageId (8–64 of [A-Za-z0-9_-]). */
export function createClientMessageId(now: number = Date.now(), random: () => number = Math.random): string {
  idCounter = (idCounter + 1) % 1_296; // two base-36 digits
  const rand = Math.floor(random() * 2_176_782_336).toString(36).padStart(6, '0');
  return `cm_${now.toString(36)}_${idCounter.toString(36).padStart(2, '0')}${rand}`;
}

/** The id a queued entry renders under in the thread. */
export function outboxMessageId(clientMessageId: string): string {
  return `${OUTBOX_MESSAGE_ID_PREFIX}${clientMessageId}`;
}

export function isOutboxMessageId(id: string | null | undefined): boolean {
  return typeof id === 'string' && id.startsWith(OUTBOX_MESSAGE_ID_PREFIX);
}

export function clientIdFromOutboxMessageId(id: string): string | null {
  return isOutboxMessageId(id) ? id.slice(OUTBOX_MESSAGE_ID_PREFIX.length) : null;
}

/** Appends an entry, ignoring a repeat of an id already queued. */
export function appendEntry(list: readonly OutboxEntry[], entry: OutboxEntry): OutboxEntry[] {
  if (list.some((e) => e.clientMessageId === entry.clientMessageId)) return list.slice();
  return [...list, entry];
}

/** Drops every entry the server already has (matched by client message id). */
export function withoutDelivered(
  list: readonly OutboxEntry[],
  serverMessages: ReadonlyArray<{ clientMessageId?: string | null }>,
): OutboxEntry[] {
  const delivered = new Set<string>();
  for (const m of serverMessages) if (m?.clientMessageId) delivered.add(m.clientMessageId);
  if (delivered.size === 0) return list.slice();
  return list.filter((e) => !delivered.has(e.clientMessageId));
}

/**
 * The thread as rendered: the server's messages, then any queued messages the
 * server doesn't have yet, in the order they were written. A queued message
 * whose send already landed (same client message id) is shown once, as the
 * server's copy.
 */
export function mergeOutboxIntoThread<M extends { clientMessageId?: string | null }>(
  serverMessages: readonly M[],
  pending: readonly M[],
): M[] {
  if (pending.length === 0) return serverMessages as M[];
  const delivered = new Set<string>();
  for (const m of serverMessages) if (m?.clientMessageId) delivered.add(m.clientMessageId);
  const extra = pending.filter((m) => !m.clientMessageId || !delivered.has(m.clientMessageId));
  return extra.length === 0 ? (serverMessages as M[]) : [...serverMessages, ...extra];
}

export interface OutboxAuthor {
  fromId: string;
  fromName: string;
  fromInitials: string;
  fromColor: string;
}

/** A queued entry as a thread message: the chat's existing "sending" (clock)
 *  or "failed" (Tap to retry) state, under an id that can't collide with a
 *  server id. */
export function outboxEntryToMessage(entry: OutboxEntry, author: OutboxAuthor): Message {
  return {
    id: outboxMessageId(entry.clientMessageId),
    conversationId: entry.conversationId,
    ...author,
    text: entry.text,
    attachment: entry.attachment as Message['attachment'],
    replyToId: entry.replyToId,
    replyPreview: entry.replyPreview,
    replyToAuthorName: entry.replyToAuthorName,
    reactions: [],
    status: entry.status,
    ts: entry.createdAt,
    deletedForMe: false,
    clientMessageId: entry.clientMessageId,
  };
}

export type FailureKind = 'offline' | 'server' | 'rejected';

/** Offline → keep and retry without counting; 5xx/timeout → retry a bounded number of
 *  times; anything else (a real 4xx answer) → rejected. */
export function classifySendFailure(error: unknown): FailureKind {
  if (error instanceof OutboxAccountMismatchError) return 'offline';
  const kind = classifyNetworkError(error);
  if (kind === 'offline') return 'offline';
  if (kind === 'server') return 'server';
  return 'rejected';
}

// ─── Store ──────────────────────────────────────────────────────────────────

const memory = new Map<string, OutboxEntry[]>();
const loading = new Map<string, Promise<OutboxEntry[]>>();
const flushing = new Map<string, Promise<void>>();
const rerun = new Set<string>();
const listeners = new Map<string, Set<(entries: OutboxEntry[]) => void>>();
const eventListeners = new Set<(event: OutboxEvent) => void>();
const EMPTY: OutboxEntry[] = [];

export function subscribeOutboxEvents(listener: (event: OutboxEvent) => void): () => void {
  eventListeners.add(listener);
  return () => { eventListeners.delete(listener); };
}

function emitEvent(event: OutboxEvent): void {
  eventListeners.forEach((fn) => {
    try { fn(event); } catch { /* a listener's own failure never stops the flush */ }
  });
}

function emit(key: string): void {
  const entries = memory.get(key) ?? EMPTY;
  listeners.get(key)?.forEach((fn) => fn(entries));
}

async function load(userId: string, conversationId: string): Promise<OutboxEntry[]> {
  const key = outboxStorageKey(userId, conversationId);
  const cached = memory.get(key);
  if (cached) return cached;
  let pending = loading.get(key);
  if (!pending) {
    pending = AsyncStorage.getItem(key)
      .then((raw) => {
        const parsed: unknown = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? (parsed as OutboxEntry[]) : [];
      })
      .catch(() => [] as OutboxEntry[])
      .then((entries) => {
        // A write that landed while we were reading wins over the stored copy.
        const current = memory.get(key);
        if (current) return current;
        memory.set(key, entries);
        return entries;
      })
      .finally(() => { loading.delete(key); });
    loading.set(key, pending);
  }
  return pending;
}

async function save(userId: string, conversationId: string, entries: OutboxEntry[]): Promise<void> {
  const key = outboxStorageKey(userId, conversationId);
  memory.set(key, entries);
  emit(key);
  try {
    if (entries.length === 0) await AsyncStorage.removeItem(key);
    else await AsyncStorage.setItem(key, JSON.stringify(entries));
    await updateIndex(userId, conversationId, entries.length > 0);
  } catch {
    // Best-effort: the in-memory queue still delivers for this session.
  }
}

async function readIndex(userId: string): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(outboxIndexKey(userId));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

let indexWrite: Promise<void> = Promise.resolve();
function updateIndex(userId: string, conversationId: string, hasEntries: boolean): Promise<void> {
  // Serialized so two conversations updating at once can't drop each other.
  indexWrite = indexWrite.then(async () => {
    const ids = await readIndex(userId);
    const has = ids.includes(conversationId);
    if (has === hasEntries) return;
    const next = hasEntries ? [...ids, conversationId] : ids.filter((id) => id !== conversationId);
    await AsyncStorage.setItem(outboxIndexKey(userId), JSON.stringify(next));
  }).catch(() => {});
  return indexWrite;
}

/** Conversations of `userId` that still have queued messages. */
export function listOutboxConversations(userId: string): Promise<string[]> {
  return indexWrite.then(() => readIndex(userId));
}

/** Synchronous view of what's already loaded (empty until `loadOutbox` resolves). */
export function getOutboxSnapshot(userId: string, conversationId: string): OutboxEntry[] {
  return memory.get(outboxStorageKey(userId, conversationId)) ?? EMPTY;
}

export function loadOutbox(userId: string, conversationId: string): Promise<OutboxEntry[]> {
  return load(userId, conversationId);
}

export function subscribeOutbox(
  userId: string,
  conversationId: string,
  listener: (entries: OutboxEntry[]) => void,
): () => void {
  const key = outboxStorageKey(userId, conversationId);
  let set = listeners.get(key);
  if (!set) { set = new Set(); listeners.set(key, set); }
  set.add(listener);
  return () => {
    set!.delete(listener);
    if (set!.size === 0) listeners.delete(key);
  };
}

export async function enqueueOutboxMessage(
  userId: string,
  conversationId: string,
  draft: OutboxDraft,
  options: { clientMessageId?: string; now?: number } = {},
): Promise<OutboxEntry> {
  const entries = await load(userId, conversationId);
  const entry: OutboxEntry = {
    text: draft.text,
    ...(draft.attachment !== undefined ? { attachment: draft.attachment } : {}),
    ...(draft.replyToId ? { replyToId: draft.replyToId } : {}),
    ...(draft.replyPreview ? { replyPreview: draft.replyPreview } : {}),
    ...(draft.replyToAuthorName ? { replyToAuthorName: draft.replyToAuthorName } : {}),
    clientMessageId: options.clientMessageId ?? createClientMessageId(options.now),
    conversationId,
    createdAt: options.now ?? Date.now(),
    attempts: 0,
    status: 'sending',
  };
  await save(userId, conversationId, appendEntry(entries, entry));
  return entry;
}

/** "Tap to retry" on a failed queued message: back to sending, at the end of its turn. */
export async function retryOutboxMessage(userId: string, conversationId: string, clientMessageId: string): Promise<boolean> {
  const entries = await load(userId, conversationId);
  if (!entries.some((e) => e.clientMessageId === clientMessageId)) return false;
  await save(userId, conversationId, entries.map((e) => (
    e.clientMessageId === clientMessageId ? { ...e, status: 'sending' as const, attempts: 0 } : e
  )));
  return true;
}

export async function discardOutboxMessage(userId: string, conversationId: string, clientMessageId: string): Promise<void> {
  const entries = await load(userId, conversationId);
  const next = entries.filter((e) => e.clientMessageId !== clientMessageId);
  if (next.length !== entries.length) await save(userId, conversationId, next);
}

/** Removes entries the server's message list shows were already stored. */
export async function reconcileOutbox(
  userId: string,
  conversationId: string,
  serverMessages: ReadonlyArray<{ clientMessageId?: string | null }>,
): Promise<void> {
  const entries = await load(userId, conversationId);
  if (entries.length === 0) return;
  const next = withoutDelivered(entries, serverMessages);
  if (next.length !== entries.length) await save(userId, conversationId, next);
}

/**
 * Sends every "sending" entry of one conversation, oldest first. Stops at the
 * first connectivity failure so later messages can never overtake an earlier
 * one. Entries in the "failed" state wait for an explicit retry. Concurrent
 * calls for the same conversation share one pass (and trigger one more pass
 * afterwards, so a message queued mid-flush isn't left behind).
 */
export function flushOutbox(
  userId: string,
  conversationId: string,
  send: OutboxSender,
): Promise<void> {
  const key = outboxStorageKey(userId, conversationId);
  const running = flushing.get(key);
  if (running) {
    rerun.add(key);
    return running;
  }
  const pass = (async () => {
    do {
      rerun.delete(key);
      await flushOnce(userId, conversationId, send);
    } while (rerun.has(key));
  })().finally(() => { flushing.delete(key); });
  flushing.set(key, pass);
  return pass;
}

async function flushOnce(userId: string, conversationId: string, send: OutboxSender): Promise<void> {
  const initial = await load(userId, conversationId);
  for (const queued of initial) {
    if (queued.status !== 'sending') continue;
    // Re-read: the entry may have been discarded/reconciled while an earlier one was in flight.
    const current = (await load(userId, conversationId)).find((e) => e.clientMessageId === queued.clientMessageId);
    if (!current || current.status !== 'sending') continue;
    try {
      const result = await send(current);
      // Announce first so an open thread can add the stored copy in the same
      // render the queued copy disappears in (no one-frame gap).
      emitEvent({ type: 'sent', userId, entry: current, result });
      const after = await load(userId, conversationId);
      await save(userId, conversationId, after.filter((e) => e.clientMessageId !== current.clientMessageId));
    } catch (error) {
      const kind = classifySendFailure(error);
      const after = await load(userId, conversationId);
      if (kind === 'rejected') {
        await save(userId, conversationId, after.filter((e) => e.clientMessageId !== current.clientMessageId));
        emitEvent({ type: 'rejected', userId, entry: current, error });
        continue;
      }
      const attempts = kind === 'server' ? current.attempts + 1 : current.attempts;
      const status: OutboxStatus = attempts >= MAX_SERVER_ATTEMPTS ? 'failed' : 'sending';
      await save(userId, conversationId, after.map((e) => (
        e.clientMessageId === current.clientMessageId ? { ...e, attempts, status } : e
      )));
      // Keep order: nothing after this entry may go out before it does.
      if (status === 'sending') return;
    }
  }
}

/** Flushes every conversation of `userId` that has queued messages. */
export async function flushAllOutboxes(userId: string, send: OutboxSender): Promise<void> {
  const ids = await listOutboxConversations(userId);
  for (const conversationId of ids) {
    await flushOutbox(userId, conversationId, send);
  }
}

/** Test-only: forget all in-memory state. */
export function __resetMessageOutboxForTests(): void {
  memory.clear();
  loading.clear();
  flushing.clear();
  rerun.clear();
  listeners.clear();
  eventListeners.clear();
  indexWrite = Promise.resolve();
  idCounter = 0;
}
