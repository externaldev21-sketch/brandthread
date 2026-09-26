/**
 * "Who is live right now" — a tiny shared store so any avatar in the app
 * (feed rail, profiles, Messages rows) can show a LIVE ring and jump straight
 * into that creator's stream without each screen polling on its own.
 *
 * Pure apart from the injected `load` function, so it is unit-testable.
 */
export interface LiveDirectoryEntry { hostId: string; streamId: string }

export interface LiveDirectory {
  subscribe(listener: () => void): () => void;
  /** streamId the host is currently live in, or null. */
  streamFor(hostId: string | null | undefined): string | null;
  /** Monotonic version — changes whenever the set of live hosts changes. */
  version(): number;
  refresh(): Promise<void>;
  /** Drop a stream immediately (e.g. the pager saw it end). */
  markEnded(streamId: string): void;
}

export function createLiveDirectory(
  load: () => Promise<LiveDirectoryEntry[]>,
  refreshMs = 30_000,
): LiveDirectory {
  let byHost = new Map<string, string>();
  let ver = 0;
  const listeners = new Set<() => void>();
  let timer: ReturnType<typeof setInterval> | null = null;
  let inFlight: Promise<void> | null = null;

  function publish(next: Map<string, string>) {
    const same = next.size === byHost.size && [...next].every(([h, s]) => byHost.get(h) === s);
    if (same) return;
    byHost = next;
    ver += 1;
    listeners.forEach(l => { try { l(); } catch { /* ignore */ } });
  }

  async function refresh() {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      try {
        const entries = await load();
        publish(new Map(entries.map(e => [e.hostId, e.streamId])));
      } catch {
        // Signed out / offline: keep whatever we last knew.
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      if (listeners.size === 1) {
        void refresh();
        timer = setInterval(() => { void refresh(); }, refreshMs);
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && timer) { clearInterval(timer); timer = null; }
      };
    },
    streamFor(hostId) {
      return hostId ? byHost.get(hostId) ?? null : null;
    },
    version: () => ver,
    refresh,
    markEnded(streamId) {
      const next = new Map([...byHost].filter(([, s]) => s !== streamId));
      publish(next);
    },
  };
}
