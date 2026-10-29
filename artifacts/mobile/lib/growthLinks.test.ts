import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isGuestBrowseRoute } from './guestRoutes';
import { buildLiveUrl, parseShareLink } from './shareLinks';

const appDir = path.resolve(__dirname, '..', 'app');

// Account wall (a7c64de9 "remove guest browsing, require an account for every
// app screen"): share links no longer open signed out; they route through
// sign-in with returnTo (lib/guestSignIn.ts). The links themselves still parse.
describe('growth links sit behind the account wall', () => {
  it('requires an account for every share-link entry point', () => {
    for (const segs of [
      ['p', '[postId]'], ['tag', '[tag]'], ['place', '[placeId]'], ['invite', '[code]'],
      ['live', '[streamId]'], ['g', '[code]'], ['giveaway'],
    ]) {
      expect(isGuestBrowseRoute(segs)).toBe(false);
    }
  });

  it('requires an account for the live directory and the shared-live viewer', () => {
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
