/** Audit (chunk 09): the web duration probe clears its 5s fallback timer once it has an answer. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Platform } from 'react-native';

vi.mock('expo-document-picker', () => ({}));
vi.mock('expo-audio', () => ({}));
vi.mock('@/lib/api', () => ({ useApi: () => ({}) }));
vi.mock('@/components/CachedImage', () => ({ CachedImage: () => null }));
vi.mock('../ProfileBannerHeader', () => ({ BannerBottomFade: () => null, BannerMedia: () => null, BannerPlaceholder: () => null }));
vi.mock('../BannerTrimScreen', () => ({ BannerTrimScreen: () => null }));
vi.mock('@/lib/profileEvents', () => ({ emitProfileEvent: () => {} }));
vi.mock('@/lib/devPreview', () => ({ isBuyerDevPreview: () => false, isSellerDevPreview: () => false }));
vi.mock('@/contexts/AppThemeContext', () => ({ useAppTheme: () => ({ theme: {} }) }));
vi.mock('@/hooks/useHeaderTopInset', () => ({ useHeaderTopInset: () => 0 }));

import { probeWebVideoDuration } from '../ProfileBannerEditor';

const originalOS = Platform.OS;
afterEach(() => {
  (Platform as { OS: string }).OS = originalOS;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('probeWebVideoDuration', () => {
  it('resolves with the metadata duration and leaves no pending timer', async () => {
    vi.useFakeTimers();
    (Platform as { OS: string }).OS = 'web';
    const video: Record<string, any> = { removeAttribute: vi.fn(), duration: 0 };
    vi.stubGlobal('document', { createElement: () => video });
    const pending = probeWebVideoDuration('blob:clip');
    video.duration = 42;
    video.onloadedmetadata();
    await expect(pending).resolves.toBe(42);
    expect(vi.getTimerCount()).toBe(0);
    expect(video.removeAttribute).toHaveBeenCalledTimes(1);
  });
});
