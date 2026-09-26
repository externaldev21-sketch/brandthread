/**
 * React bindings for the shared live directory (see liveDirectory.ts).
 */
import { useCallback, useSyncExternalStore } from 'react';
import { useRouter } from 'expo-router';
import { createLiveDirectory, type LiveDirectory } from './liveDirectory';
import { getLiveStreamProvider } from './liveProvider';

let directory: LiveDirectory | null = null;

export function getLiveDirectory(): LiveDirectory {
  directory ??= createLiveDirectory(async () => {
    const streams = await getLiveStreamProvider().listLive();
    return streams.map(s => ({ hostId: s.host.id, streamId: s.id }));
  });
  return directory;
}

/** The streamId `hostId` is live in right now, or null. */
export function useLiveStreamForHost(hostId: string | null | undefined): string | null {
  const dir = getLiveDirectory();
  useSyncExternalStore(dir.subscribe, dir.version, dir.version);
  return dir.streamFor(hostId);
}

/** Route to the LIVE pager, optionally opened at a stream / host. */
export function liveHref(target: { streamId?: string | null; hostId?: string | null } = {}): string {
  const qs: string[] = [];
  if (target.streamId) qs.push(`streamId=${encodeURIComponent(target.streamId)}`);
  if (target.hostId) qs.push(`hostId=${encodeURIComponent(target.hostId)}`);
  return `/live${qs.length ? `?${qs.join('&')}` : ''}`;
}

/** Push the LIVE pager. Keeps `bt_preview` on web so preview mode survives. */
export function useOpenLive() {
  const router = useRouter();
  return useCallback((target: { streamId?: string | null; hostId?: string | null } = {}) => {
    router.push(liveHref(target) as never);
  }, [router]);
}
