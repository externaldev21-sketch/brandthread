import { describe, expect, it } from 'vitest';
import {
  appStoreLinks, deferredInviteEnabled, inviteCodeFromHandoff, shouldCheckDeferredInvite, storeForUserAgent,
} from './deferredInvite';

describe('deferred invite hand-off (BT-312)', () => {
  it('reads the code only from a copied Brandthread invite link', () => {
    expect(inviteCodeFromHandoff('https://brandthread.app/invite/k7m2pq')).toBe('K7M2PQ');
    expect(inviteCodeFromHandoff('  https://www.brandthread.app/invite/K7M2PQ/?utm_source=x ')).toBe('K7M2PQ');
    for (const other of ['https://evil.app/invite/K7M2PQ', 'https://brandthread.app/u/k7m2pq', 'K7M2PQ', 'https://brandthread.app/invite/<x>', '', null, 'x'.repeat(500)]) {
      expect(inviteCodeFromHandoff(other as string)).toBeNull();
    }
  });

  it('checks once, at a signed-out first launch on a phone, unless switched off', () => {
    const base = { platform: 'ios', isLoaded: true, isSignedIn: false, alreadyChecked: false, enabled: true };
    expect(shouldCheckDeferredInvite(base)).toBe(true);
    expect(shouldCheckDeferredInvite({ ...base, platform: 'android' })).toBe(true);
    expect(shouldCheckDeferredInvite({ ...base, platform: 'web' })).toBe(false);
    expect(shouldCheckDeferredInvite({ ...base, isSignedIn: true })).toBe(false);
    expect(shouldCheckDeferredInvite({ ...base, alreadyChecked: true })).toBe(false);
    expect(shouldCheckDeferredInvite({ ...base, isLoaded: false })).toBe(false);
    expect(shouldCheckDeferredInvite({ ...base, enabled: false })).toBe(false);
    expect(deferredInviteEnabled({})).toBe(true);
    expect(deferredInviteEnabled({ EXPO_PUBLIC_DEFERRED_INVITE: '0' })).toBe(false);
  });

  it('only offers a Download button once the store listing is configured', () => {
    expect(appStoreLinks({})).toEqual({ ios: null, android: null });
    expect(appStoreLinks({ EXPO_PUBLIC_APP_STORE_URL: 'https://apps.apple.com/app/id1', EXPO_PUBLIC_PLAY_STORE_URL: 'javascript:x' }))
      .toEqual({ ios: 'https://apps.apple.com/app/id1', android: null });
    expect(storeForUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)')).toBe('ios');
    expect(storeForUserAgent('Mozilla/5.0 (Linux; Android 15; Pixel 9)')).toBe('android');
    expect(storeForUserAgent('Mozilla/5.0 (Macintosh)')).toBeNull();
  });
});
