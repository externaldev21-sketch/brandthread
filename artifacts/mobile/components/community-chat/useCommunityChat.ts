/**
 * State + realtime for one community group chat screen.
 *
 * Owns: first load (community + latest 50), older-page pagination, the
 * realtime subscription (only while the screen is focused; catch-up on
 * reconnect, 5s polling while the socket is down), optimistic sends with
 * retry, optimistic reactions, mark-read, and the "N new messages" counter.
 * The merge rules themselves are pure and live in lib/communities/chatMerge.ts.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { ApiError } from '@/lib/networkNotice';
import { apiErrorMessage } from '@/lib/safety';
import { messagePreviewText } from '@/lib/chatGrouping';
import { useCommunityClient, useCommunityMyId } from '@/lib/communities/useCommunityClient';
import {
  CommunityAuthRequiredError,
  type Community, type CommunityAttachment, type CommunityEvent, type CommunityMessage,
} from '@/lib/communities/types';
import {
  applyCreated, applySent, dropPending, markPending, maxSeq, nextNewCount, removeMessage, setReactions,
  toDisplay, toInvertedRows, toggleMyReaction, upsertMessages,
  type ChatLists, type ChatRow, type DisplayMessage, type PendingMessage,
} from '@/lib/communities/chatMerge';

export type ChatStatus = 'loading' | 'ready' | 'error' | 'auth' | 'removed' | 'deleted' | 'notfound';

export interface SendPayload {
  text: string;
  attachments: CommunityAttachment[];
  replyTo?: DisplayMessage | null;
}

export type SendOutcome =
  | { ok: true }
  | { ok: false; code: 'MODERATED' | 'OTHER'; message: string };

const PAGE_SIZE = 50;
const POLL_MS = 5_000;
const MARK_READ_DEBOUNCE_MS = 600;
const NOTICE_MS = 3_500;
const MAX_CATCH_UP_PAGES = 5;

const MODERATED_FALLBACK = 'That message can’t be sent. Try rewording it.';

function attachmentFor(a: CommunityAttachment): CommunityAttachment {
  return { type: 'image', url: a.url, ...(a.width ? { width: a.width } : {}), ...(a.height ? { height: a.height } : {}) };
}

export function useCommunityChat(communityId: string | undefined) {
  const client = useCommunityClient();
  const myId = useCommunityMyId();
  const [community, setCommunity] = useState<Community | null>(null);
  const [status, setStatus] = useState<ChatStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const [lists, setLists] = useState<ChatLists>({ items: [], pending: [] });
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hiddenSenders, setHiddenSenders] = useState<ReadonlySet<string>>(new Set());
  const [newCount, setNewCount] = useState(0);
  const [focused, setFocused] = useState(true);
  const [fallback, setFallback] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const listsRef = useRef(lists);
  const nextBeforeRef = useRef<number | null>(null);
  const loadingOlderRef = useRef(false);
  const catchingUpRef = useRef(false);
  const nearBottomRef = useRef(true);
  const focusedRef = useRef(true);
  const aliveRef = useRef(true);
  const loadTokenRef = useRef(0);
  const markTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      if (markTimerRef.current) clearTimeout(markTimerRef.current);
      if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    };
  }, []);

  useFocusEffect(useCallback(() => {
    focusedRef.current = true;
    setFocused(true);
    return () => { focusedRef.current = false; setFocused(false); };
  }, []));

  const commit = useCallback((fn: (l: ChatLists) => ChatLists) => {
    const next = fn(listsRef.current);
    listsRef.current = next;
    setLists(next);
  }, []);

  const flash = useCallback((text: string) => {
    setNotice(text);
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = setTimeout(() => setNotice(null), NOTICE_MS);
  }, []);

  // ─── Mark read (debounced; only while focused and at the bottom) ───────────
  const scheduleMarkRead = useCallback(() => {
    if (!communityId || !focusedRef.current || !nearBottomRef.current) return;
    if (markTimerRef.current) clearTimeout(markTimerRef.current);
    markTimerRef.current = setTimeout(() => { client.markRead(communityId).catch(() => {}); }, MARK_READ_DEBOUNCE_MS);
  }, [client, communityId]);

  const setNearBottom = useCallback((near: boolean) => {
    if (nearBottomRef.current === near) return;
    nearBottomRef.current = near;
    if (near) { setNewCount(0); scheduleMarkRead(); }
  }, [scheduleMarkRead]);

  // ─── Load ─────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    if (!communityId) { setStatus('notfound'); return; }
    const token = ++loadTokenRef.current;
    setStatus('loading');
    setError(null);
    try {
      const [c, page] = await Promise.all([
        client.get(communityId),
        client.messages(communityId, { limit: PAGE_SIZE }),
      ]);
      if (!aliveRef.current || loadTokenRef.current !== token) return;
      commit(() => ({ items: upsertMessages([], page.messages), pending: [] }));
      nextBeforeRef.current = page.nextBefore;
      setHasMore(page.hasMore);
      setCommunity(c);
      setStatus('ready');
    } catch (e) {
      if (!aliveRef.current || loadTokenRef.current !== token) return;
      if (e instanceof CommunityAuthRequiredError) { setStatus('auth'); return; }
      if (e instanceof ApiError && e.status === 403) { setStatus('removed'); return; }
      if (e instanceof ApiError && e.status === 404) { setStatus('notfound'); return; }
      setError(apiErrorMessage(e, 'We couldn’t load this group. Check your connection and try again.'));
      setStatus('error');
    }
  }, [client, communityId, commit]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => { if (status === 'ready') scheduleMarkRead(); }, [status, scheduleMarkRead]);

  const loadOlder = useCallback(async () => {
    if (!communityId || loadingOlderRef.current || nextBeforeRef.current == null) return;
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    try {
      const page = await client.messages(communityId, { before: nextBeforeRef.current, limit: PAGE_SIZE });
      if (!aliveRef.current) return;
      commit((l) => ({ ...l, items: upsertMessages(l.items, page.messages) }));
      nextBeforeRef.current = page.nextBefore;
      setHasMore(page.hasMore);
    } catch {
      flash('Couldn’t load earlier messages. Scroll up to try again.');
    } finally {
      loadingOlderRef.current = false;
      if (aliveRef.current) setLoadingOlder(false);
    }
  }, [client, communityId, commit, flash]);

  // ─── Realtime ─────────────────────────────────────────────────────────────
  const handleCreated = useCallback((msg: CommunityMessage) => {
    const r = applyCreated(listsRef.current, msg, myId);
    commit(() => ({ items: r.items, pending: r.pending }));
    if (r.isNewFromOthers) {
      setNewCount((c) => nextNewCount(c, { nearBottom: nearBottomRef.current, fromOthers: true }));
      scheduleMarkRead();
    }
  }, [commit, myId, scheduleMarkRead]);

  const catchUp = useCallback(async () => {
    if (!communityId || catchingUpRef.current) return;
    catchingUpRef.current = true;
    try {
      let cursor = maxSeq(listsRef.current.items);
      for (let i = 0; i < MAX_CATCH_UP_PAGES; i++) {
        const page = await client.messages(communityId, { after: cursor, limit: 100 });
        if (!aliveRef.current) return;
        page.messages.forEach(handleCreated);
        if (!page.hasMore || page.messages.length === 0) break;
        cursor = page.messages[page.messages.length - 1].seq;
      }
    } catch { /* the next reconnect / poll tick tries again */ }
    finally { catchingUpRef.current = false; }
  }, [client, communityId, handleCreated]);

  const handleEvent = useCallback((event: CommunityEvent) => {
    switch (event.type) {
      case 'message.created':
        handleCreated(event.message);
        break;
      case 'message.deleted':
        commit((l) => ({ ...l, items: removeMessage(l.items, event.messageId) }));
        break;
      case 'reaction.updated':
        commit((l) => ({ ...l, items: setReactions(l.items, event.messageId, event.reactions) }));
        break;
      case 'member.removed':
        if (event.userId === '' || event.userId === myId) setStatus('removed');
        else setCommunity((c) => (c ? { ...c, memberCount: Math.max(0, c.memberCount - 1) } : c));
        break;
      case 'community.deleted':
        setStatus('deleted');
        break;
    }
  }, [commit, handleCreated, myId]);

  const ready = status === 'ready';
  useEffect(() => {
    if (!communityId || !ready || !focused) return;
    const off = client.subscribe(communityId, {
      onEvent: handleEvent,
      onConnected: () => { void catchUp(); },
      onFallback: (active) => setFallback(active),
    });
    // Demo mode has no socket handshake to hang a catch-up on.
    if (client.mode !== 'live') void catchUp();
    return () => { off(); setFallback(false); };
  }, [client, communityId, ready, focused, handleEvent, catchUp]);

  useEffect(() => {
    if (!fallback || !ready || !focused) return;
    const timer = setInterval(() => { void catchUp(); }, POLL_MS);
    return () => clearInterval(timer);
  }, [fallback, ready, focused, catchUp]);

  // ─── Sending ──────────────────────────────────────────────────────────────
  const dispatchSend = useCallback(async (p: PendingMessage): Promise<SendOutcome> => {
    if (!communityId) return { ok: false, code: 'OTHER', message: 'Couldn’t send.' };
    try {
      const msg = await client.send(communityId, {
        text: p.text || undefined,
        attachments: p.attachments.length ? p.attachments.map(attachmentFor) : undefined,
        replyToId: p.replyToId,
      });
      if (aliveRef.current) commit((l) => applySent(l, p.clientId, msg));
      return { ok: true };
    } catch (e) {
      if (e instanceof ApiError && e.code === 'MODERATED') {
        // Not a failure to retry — hand the draft back so it can be reworded.
        commit((l) => ({ ...l, pending: dropPending(l.pending, p.clientId) }));
        return { ok: false, code: 'MODERATED', message: apiErrorMessage(e, MODERATED_FALLBACK) };
      }
      if (e instanceof ApiError && e.status === 403) {
        commit((l) => ({ ...l, pending: dropPending(l.pending, p.clientId) }));
        setStatus('removed');
        return { ok: false, code: 'OTHER', message: 'You’re no longer a member of this group.' };
      }
      const message = e instanceof ApiError && e.status === 429
        ? 'You’re sending messages quickly. Give it a moment, then tap to retry.'
        : 'Couldn’t send. Tap to retry.';
      commit((l) => ({ ...l, pending: markPending(l.pending, p.clientId, { status: 'failed', error: message }) }));
      return { ok: false, code: 'OTHER', message };
    }
  }, [client, communityId, commit]);

  const send = useCallback((payload: SendPayload): Promise<SendOutcome> => {
    const clientId = `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
    const reply = payload.replyTo;
    const pending: PendingMessage = {
      clientId,
      text: payload.text,
      attachments: payload.attachments,
      replyToId: reply && !reply.pendingStatus ? reply.id : undefined,
      replyPreview: reply ? messagePreviewText({ text: reply.text, attachment: reply.attachments[0] ?? null }) : undefined,
      replyToAuthorName: reply?.fromName,
      ts: Date.now(),
      status: 'sending',
    };
    commit((l) => ({ ...l, pending: [...l.pending, pending] }));
    return dispatchSend(pending);
  }, [commit, dispatchSend]);

  const retry = useCallback(async (clientId: string) => {
    const p = listsRef.current.pending.find((x) => x.clientId === clientId);
    if (!p) return;
    commit((l) => ({ ...l, pending: markPending(l.pending, clientId, { status: 'sending', error: undefined }) }));
    const outcome = await dispatchSend({ ...p, status: 'sending' });
    if (!outcome.ok && outcome.code === 'MODERATED') flash(outcome.message);
  }, [commit, dispatchSend, flash]);

  const removePending = useCallback((clientId: string) => {
    commit((l) => ({ ...l, pending: dropPending(l.pending, clientId) }));
  }, [commit]);

  // ─── Message actions ──────────────────────────────────────────────────────
  const toggleReaction = useCallback(async (msg: DisplayMessage, type: string) => {
    if (!communityId || !myId || msg.pendingStatus) return;
    const current = listsRef.current.items.find((m) => m.id === msg.id);
    if (!current) return;
    const before = current.reactions;
    const { reactions, action } = toggleMyReaction(before, myId, type);
    commit((l) => ({ ...l, items: setReactions(l.items, msg.id, reactions) }));
    try {
      if (action === 'react') await client.react(communityId, msg.id, type);
      else await client.unreact(communityId, msg.id);
    } catch {
      commit((l) => ({ ...l, items: setReactions(l.items, msg.id, before) }));
      flash('Couldn’t update that reaction. Try again.');
    }
  }, [client, communityId, commit, flash, myId]);

  const deleteMessage = useCallback(async (msg: DisplayMessage) => {
    if (!communityId || msg.pendingStatus) return;
    try {
      await client.deleteMessage(communityId, msg.id);
      commit((l) => ({ ...l, items: removeMessage(l.items, msg.id) }));
    } catch (e) {
      flash(apiErrorMessage(e, 'Couldn’t delete that message. Try again.'));
    }
  }, [client, communityId, commit, flash]);

  const hideSender = useCallback((userId: string) => {
    setHiddenSenders((prev) => new Set(prev).add(userId));
  }, []);

  const setMuted = useCallback(async (muted: boolean) => {
    if (!communityId) return;
    setCommunity((c) => (c ? { ...c, muted } : c));
    try {
      await client.setMuted(communityId, muted);
      flash(muted ? 'Notifications muted for this group.' : 'Notifications back on.');
    } catch (e) {
      setCommunity((c) => (c ? { ...c, muted: !muted } : c));
      flash(apiErrorMessage(e, 'Couldn’t change that setting. Try again.'));
    }
  }, [client, communityId, flash]);

  const leave = useCallback(async (): Promise<{ ok: true } | { ok: false; message: string }> => {
    if (!communityId) return { ok: false, message: 'Couldn’t leave this group.' };
    try {
      await client.leave(communityId);
      return { ok: true };
    } catch (e) {
      if (e instanceof ApiError && e.code === 'OWNER_CANNOT_LEAVE') {
        return { ok: false, message: 'Transfer ownership or delete the group first.' };
      }
      return { ok: false, message: apiErrorMessage(e, 'Couldn’t leave this group. Try again.') };
    }
  }, [client, communityId]);

  // ─── Derived ──────────────────────────────────────────────────────────────
  const rows: ChatRow[] = useMemo(
    () => toInvertedRows(toDisplay(lists.items, lists.pending, hiddenSenders, { id: myId ?? 'me' })),
    [lists, hiddenSenders, myId],
  );
  const canModerate = !!community && community.kind !== 'official' && (community.role === 'owner' || community.role === 'admin');

  return {
    client, myId, community, status, error, reload: load,
    rows, hasMore, loadingOlder, loadOlder, empty: ready && rows.length === 0,
    send, retry, removePending, toggleReaction, deleteMessage, hideSender,
    newCount, setNearBottom, notice, flash, fallback,
    setMuted, leave, canModerate,
  };
}
