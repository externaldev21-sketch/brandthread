import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { liveDeepLinkHref } from './liveDeepLink';

describe('liveDeepLinkHref', () => {
  it('opens the LIVE pager on the shared stream', () => {
    expect(liveDeepLinkHref('abc-123')).toBe('/live?streamId=abc-123');
    expect(liveDeepLinkHref(['x y'])).toBe('/live?streamId=x%20y');
  });

  it('falls back to the LIVE pager without a stream id', () => {
    expect(liveDeepLinkHref(undefined)).toBe('/live');
    expect(liveDeepLinkHref('  ')).toBe('/live');
  });

  it('is served by a real /live/[streamId] route', () => {
    const route = readFileSync(resolve(__dirname, '../../app/live/[streamId].tsx'), 'utf8');
    expect(route).toContain("useLocalSearchParams");
    expect(route).toContain("buyer-live");
    expect(route).toContain("Log in to watch");
  });
});

describe('realtime sockets connect under /api', () => {
  // Only /api reaches api-server on the deployed site; a bare /ws/* upgrade
  // hit the static web server and the screens fell back to polling.
  it('live streams', () => {
    const src = readFileSync(resolve(__dirname, 'useLiveSocket.ts'), 'utf8');
    expect(src).toContain('/api/ws/live?streamId=');
  });

  it('community chat', () => {
    const src = readFileSync(resolve(__dirname, '../communities/useCommunityClient.ts'), 'utf8');
    expect(src).toContain('/api/ws/community?communityId=');
  });
});
