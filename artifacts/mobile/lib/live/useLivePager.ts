/**
 * State for the LIVE pager: the list of live streams, per-stream realtime
 * state (viewers, likes, chat, pinned product), and graceful removal of
 * streams that end while the pager is open.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { LiveChatMessage, LiveStream, LiveStreamProvider, SuggestedCreator, UpcomingLive } from './types';
import { appendChat, initialStreamIndex, nextIndexAfterRemoval } from './liveOrdering';
import { getLiveDirectory } from './useLiveDirectory';

export interface LiveRuntime {
  viewerCount: number;
  likeCount: number;
  pinnedProductId: string | null;
  chat: LiveChatMessage[];
}

/** How long an ended page takes to animate out before it is removed. */
export const LIVE_END_ANIMATION_MS = 420;
const REFRESH_MS = 20_000;

export function useLivePager(
  provider: LiveStreamProvider,
  target: { streamId?: string | null; hostId?: string | null },
) {
  const [streams, setStreams] = useState<LiveStream[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [initialIndex, setInitialIndex] = useState(0);
  const [runtime, setRuntime] = useState<Record<string, LiveRuntime>>({});
  const [ending, setEnding] = useState<Record<string, true>>({});
  const [endedNotice, setEndedNotice] = useState<string | null>(null);
  const [upcoming, setUpcoming] = useState<UpcomingLive[]>([]);
  const [suggested, setSuggested] = useState<SuggestedCreator[]>([]);

  const streamsRef = useRef(streams);
  streamsRef.current = streams;
  const activeRef = useRef(activeIndex);
  activeRef.current = activeIndex;
  const endingRef = useRef(ending);
  endingRef.current = ending;

  const seedRuntime = useCallback((list: LiveStream[]) => {
    setRuntime(prev => {
      const next = { ...prev };
      for (const s of list) {
        next[s.id] ??= { viewerCount: s.viewerCount, likeCount: s.likeCount, pinnedProductId: s.pinnedProductId, chat: [] };
      }
      return next;
    });
  }, []);

  const loadExtras = useCallback(async () => {
    const [u, sc] = await Promise.all([
      provider.listUpcoming().catch(() => []),
      provider.listSuggestedCreators().catch(() => []),
    ]);
    setUpcoming(u);
    setSuggested(sc);
  }, [provider]);

  // Remove a stream with an exit animation, keeping the viewer on a
  // sensible page (advance to the next one if it was the active page).
  const removeStream = useCallback((streamId: string, hostName?: string) => {
    if (endingRef.current[streamId]) return;
    if (!streamsRef.current.some(s => s.id === streamId)) return;
    setEnding(prev => ({ ...prev, [streamId]: true }));
    if (hostName) setEndedNotice(`${hostName} ended their live`);
    getLiveDirectory().markEnded(streamId);
    setTimeout(() => {
      const list = streamsRef.current;
      const endedIndex = list.findIndex(s => s.id === streamId);
      if (endedIndex < 0) return;
      const nextActive = nextIndexAfterRemoval(activeRef.current, endedIndex, list.length);
      const nextList = list.filter(s => s.id !== streamId);
      setStreams(nextList);
      setActiveIndex(nextActive);
      setEnding(prev => { const n = { ...prev }; delete n[streamId]; return n; });
      if (nextList.length === 0) void loadExtras();
    }, LIVE_END_ANIMATION_MS);
  }, [loadExtras]);

  // Initial load.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await provider.listLive();
        if (cancelled) return;
        const start = initialStreamIndex(list, target);
        setStreams(list);
        seedRuntime(list);
        setInitialIndex(start);
        setActiveIndex(start);
        if (list.length === 0) await loadExtras();
      } catch {
        if (!cancelled) { setError(true); await loadExtras(); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider]);

  // Periodic refresh: new streams are appended (never reorder pages under
  // the viewer's thumb); streams that disappeared are removed gracefully.
  useEffect(() => {
    const t = setInterval(async () => {
      try {
        const fresh = await provider.listLive();
        const freshIds = new Set(fresh.map(s => s.id));
        const current = streamsRef.current;
        for (const s of current) if (!freshIds.has(s.id)) removeStream(s.id, s.host.name);
        const known = new Set(current.map(s => s.id));
        const added = fresh.filter(s => !known.has(s.id));
        if (added.length) {
          seedRuntime(added);
          setStreams(prev => [...prev, ...added]);
        }
      } catch { /* keep what we have */ }
    }, REFRESH_MS);
    return () => clearInterval(t);
  }, [provider, removeStream, seedRuntime]);

  // Join + realtime for the active stream only (neighbours stay preloaded
  // visually but don't hold a viewer slot or a poller).
  const activeId = streams[activeIndex]?.id;
  useEffect(() => {
    if (!activeId) return undefined;
    const stream = streamsRef.current.find(s => s.id === activeId);
    let alive = true;
    provider.join(activeId).then(res => {
      if (!alive) return;
      if (!res.ok) { removeStream(activeId, stream?.host.name); return; }
      setRuntime(prev => {
        const cur = prev[activeId];
        if (!cur) return prev;
        return { ...prev, [activeId]: { ...cur, chat: appendChat(cur.chat, res.recentChat) } };
      });
    }).catch(() => {});
    const unsubscribe = provider.subscribe(activeId, event => {
      if (!alive) return;
      if (event.type === 'ended') { removeStream(event.streamId, stream?.host.name); return; }
      setRuntime(prev => {
        const cur = prev[event.streamId];
        if (!cur) return prev;
        switch (event.type) {
          case 'viewers': return { ...prev, [event.streamId]: { ...cur, viewerCount: event.viewerCount } };
          case 'likes': return { ...prev, [event.streamId]: { ...cur, likeCount: Math.max(cur.likeCount, event.likeCount) } };
          case 'pinned': return { ...prev, [event.streamId]: { ...cur, pinnedProductId: event.productId } };
          case 'chat': return { ...prev, [event.streamId]: { ...cur, chat: appendChat(cur.chat, event.messages) } };
          default: return prev;
        }
      });
    });
    return () => {
      alive = false;
      unsubscribe();
      void provider.leave(activeId).catch(() => {});
    };
  }, [activeId, provider, removeStream]);

  const sendChat = useCallback(async (text: string) => {
    if (!activeId) return;
    const msg = await provider.sendChat(activeId, text);
    setRuntime(prev => {
      const cur = prev[activeId];
      return cur ? { ...prev, [activeId]: { ...cur, chat: appendChat(cur.chat, [msg]) } } : prev;
    });
  }, [activeId, provider]);

  const like = useCallback((streamId: string) => {
    setRuntime(prev => {
      const cur = prev[streamId];
      return cur ? { ...prev, [streamId]: { ...cur, likeCount: cur.likeCount + 1 } } : prev;
    });
    void provider.sendLike(streamId).catch(() => {});
  }, [provider]);

  const setFollowing = useCallback(async (hostId: string, following: boolean) => {
    setStreams(prev => prev.map(s => s.host.id === hostId ? { ...s, followedByViewer: following } : s));
    setSuggested(prev => prev.map(c => c.host.id === hostId ? { ...c, following } : c));
    try {
      await provider.setFollowing(hostId, following);
    } catch {
      setStreams(prev => prev.map(s => s.host.id === hostId ? { ...s, followedByViewer: !following } : s));
      setSuggested(prev => prev.map(c => c.host.id === hostId ? { ...c, following: !following } : c));
    }
  }, [provider]);

  const setReminder = useCallback(async (id: string, on: boolean) => {
    setUpcoming(prev => prev.map(u => u.id === id ? { ...u, reminderSet: on } : u));
    try { await provider.setReminder(id, on); } catch {
      setUpcoming(prev => prev.map(u => u.id === id ? { ...u, reminderSet: !on } : u));
    }
  }, [provider]);

  return {
    streams, loading, error, activeIndex, setActiveIndex, initialIndex, runtime, ending,
    endedNotice, clearEndedNotice: () => setEndedNotice(null),
    upcoming, suggested, sendChat, like, setFollowing, setReminder, removeStream,
  };
}
