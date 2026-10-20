import { afterEach, describe, expect, it, vi } from 'vitest';
import { closeGuestSignIn, getGuestSignInRequest, guestReturnPath, requestGuestSignIn, subscribeGuestSignIn } from './guestSignIn';

afterEach(() => closeGuestSignIn(false));
describe('guest action prompt', () => {
  it('deduplicates taps and dismisses without replaying any action', () => {
    const dismiss = vi.fn();
    const listener = vi.fn();
    const unsubscribe = subscribeGuestSignIn(listener);
    requestGuestSignIn('/buyer-post-viewer?postId=abc&index=3', dismiss);
    requestGuestSignIn('/buyer-product-detail?id=wrong');
    expect(getGuestSignInRequest()?.returnTo).toBe('/buyer-post-viewer?postId=abc&index=3');
    expect(listener).toHaveBeenCalledTimes(1);
    closeGuestSignIn();
    expect(dismiss).toHaveBeenCalledTimes(1);
    expect(getGuestSignInRequest()).toBeNull();
    unsubscribe();
  });
  it('auth handoff closes the prompt without running the dismissal navigation', () => {
    const dismiss = vi.fn();
    requestGuestSignIn('/(buyer)/inbox', dismiss);
    closeGuestSignIn(false);
    expect(dismiss).not.toHaveBeenCalled();
  });
  it('rejects external return URLs and keeps all current route parameters', () => {
    requestGuestSignIn('//untrusted.test');
    expect(getGuestSignInRequest()?.returnTo).toBe('/(buyer)/');
    expect(guestReturnPath('/buyer-post-viewer', { postId: 'a b', index: '3', unused: undefined }))
      .toBe('/buyer-post-viewer?postId=a%20b&index=3');
  });
});
