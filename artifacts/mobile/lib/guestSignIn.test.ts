import { afterEach, describe, expect, it, vi } from 'vitest';
const replace = vi.hoisted(() => vi.fn());
vi.mock('expo-router', () => ({ router: { replace } }));
import { closeGuestSignIn, getGuestSignInRequest, guestReturnPath, requestGuestSignIn, subscribeGuestSignIn } from './guestSignIn';

afterEach(() => { closeGuestSignIn(false); replace.mockClear(); });
describe('expired-session auth navigation', () => {
  it('routes to Welcome without opening a guest sheet or replaying any action', () => {
    const dismiss = vi.fn();
    const listener = vi.fn();
    const unsubscribe = subscribeGuestSignIn(listener);
    requestGuestSignIn('/buyer-post-viewer?postId=abc&index=3', dismiss);
    requestGuestSignIn('/buyer-product-detail?id=wrong');
    expect(replace).toHaveBeenCalledWith({
      pathname: '/onboarding', params: { returnTo: '/buyer-post-viewer?postId=abc&index=3' },
    });
    expect(listener).not.toHaveBeenCalled();
    closeGuestSignIn();
    expect(dismiss).not.toHaveBeenCalled();
    expect(getGuestSignInRequest()).toBeNull();
    unsubscribe();
  });
  it('auth handoff never runs the previous dismissal callback', () => {
    const dismiss = vi.fn();
    requestGuestSignIn('/(buyer)/inbox', dismiss);
    closeGuestSignIn(false);
    expect(dismiss).not.toHaveBeenCalled();
  });
  it('rejects external return URLs and keeps all current route parameters', () => {
    requestGuestSignIn('//untrusted.test');
    expect(replace).toHaveBeenCalledWith({ pathname: '/onboarding', params: { returnTo: '/' } });
    expect(guestReturnPath('/buyer-post-viewer', { postId: 'a b', index: '3', unused: undefined }))
      .toBe('/buyer-post-viewer?postId=a%20b&index=3');
  });
});
