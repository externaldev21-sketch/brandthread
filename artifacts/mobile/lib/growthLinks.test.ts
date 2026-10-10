import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isGuestBrowseRoute } from './guestRoutes';
import { buildLiveUrl, parseShareLink } from './shareLinks';

const appDir = path.resolve(__dirname, '..', 'app');

describe('growth links open for signed-out visitors (BT-303/319/321)', () => {
  it('lets a guest through every share-link entry point', () => {
    for (const segs of [
      ['p', '[postId]'], ['tag', '[tag]'], ['place', '[placeId]'], ['invite', '[code]'],
      ['live', '[streamId]'], ['g', '[code]'], ['giveaway'],
    ]) {
      expect(isGuestBrowseRoute(segs)).toBe(true);
    }
  });

  it('only opens the shared-live preview to guests, not the /live feed screen', () => {
    expect(isGuestBrowseRoute(['live'])).toBe(false);
  });
});

describe('live, giveaway and invite share links (BT-311/320/321)', () => {
  const id = '3f1a2b4c-1111-4222-8333-944455556666';

  it('shares live streams as https links', () => {
    expect(buildLiveUrl(id)).toBe(`https://brandthread.app/live/${id}`);
    expect(buildLiveUrl('../x')).toBeNull();
    expect(buildLiveUrl(null)).toBeNull();
  });

  it('maps /live, /g and /invite to in-app routes', () => {
    expect(parseShareLink(`https://brandthread.app/live/${id}`)).toEqual({ kind: 'live', id, href: `/live/${id}` });
    expect(parseShareLink('https://brandthread.app/g/ab12cd34')).toEqual({ kind: 'giveaway', code: 'AB12CD34', href: '/giveaway?code=AB12CD34' });
    expect(parseShareLink('brandthread://invite/k7m2pq')).toEqual({ kind: 'invite', code: 'K7M2PQ', href: '/invite/K7M2PQ' });
    expect(parseShareLink('https://brandthread.app/g/<script>')).toBeNull();
    expect(parseShareLink('https://brandthread.app/live/x')).toBeNull();
  });

  it('has an app route for every growth path the AASA claims', () => {
    for (const file of ['invite/[code].tsx', 'community-join.tsx', 'live/[streamId].tsx', 'g/[code].tsx', 'giveaway.tsx']) {
      expect(existsSync(path.join(appDir, file))).toBe(true);
    }
  });
});
