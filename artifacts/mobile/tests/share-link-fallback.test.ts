import { describe, expect, it, vi } from 'vitest';
import { buildCanonicalProfileUrl, shareLinkWithFallback } from '@/lib/shareProfile';

// Share profile must work on native and on web — including desktop browsers
// with no Web Share API, where react-native-web's Share.share throws.

const url = buildCanonicalProfileUrl('JordanReyes')!;

describe('shareLinkWithFallback', () => {
  it('builds the real brandthread.app deep link', () => {
    expect(url).toBe('https://brandthread.app/u/jordanreyes');
  });

  it('uses the native share sheet with the link on iOS and Android', async () => {
    const nativeShare = vi.fn().mockResolvedValue({ action: 'sharedAction' });
    await expect(shareLinkWithFallback({ url, message: 'Jordan on Brandthread', platformOS: 'ios', nativeShare })).resolves.toBe('shared');
    expect(nativeShare).toHaveBeenLastCalledWith({ message: 'Jordan on Brandthread', url });
    await shareLinkWithFallback({ url, message: 'Jordan on Brandthread', platformOS: 'android', nativeShare });
    expect(nativeShare).toHaveBeenLastCalledWith({ message: `Jordan on Brandthread ${url}` });
  });

  it('uses the Web Share API on web when the browser has it, never RN Share', async () => {
    const nativeShare = vi.fn();
    const share = vi.fn().mockResolvedValue(undefined);
    await expect(shareLinkWithFallback({ url, message: 'm', platformOS: 'web', nativeShare, webNavigator: { share } })).resolves.toBe('shared');
    expect(share).toHaveBeenCalledWith({ title: 'm', text: 'm', url });
    expect(nativeShare).not.toHaveBeenCalled();
  });

  it('copies the link on web when native share is unavailable, without throwing', async () => {
    const nativeShare = vi.fn(() => { throw new Error('Share is not supported in this browser'); });
    const writeText = vi.fn().mockResolvedValue(undefined);
    await expect(shareLinkWithFallback({ url, message: 'm', platformOS: 'web', nativeShare, webNavigator: { clipboard: { writeText } } })).resolves.toBe('copied');
    expect(writeText).toHaveBeenCalledWith(url);
    expect(nativeShare).not.toHaveBeenCalled();
  });

  it('treats a cancelled web share as done and falls back to copy when the browser refuses', async () => {
    const abort = Object.assign(new Error('cancelled'), { name: 'AbortError' });
    await expect(shareLinkWithFallback({ url, message: 'm', platformOS: 'web', nativeShare: vi.fn(), webNavigator: { share: vi.fn().mockRejectedValue(abort) } })).resolves.toBe('shared');
    const writeText = vi.fn().mockResolvedValue(undefined);
    await expect(shareLinkWithFallback({
      url, message: 'm', platformOS: 'web', nativeShare: vi.fn(),
      webNavigator: { share: vi.fn().mockRejectedValue(new Error('NotAllowedError')), clipboard: { writeText } },
    })).resolves.toBe('copied');
    await expect(shareLinkWithFallback({ url, message: 'm', platformOS: 'web', nativeShare: vi.fn(), webNavigator: null })).resolves.toBe('unavailable');
  });
});
