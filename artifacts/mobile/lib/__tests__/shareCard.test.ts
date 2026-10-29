import { afterEach, describe, expect, it, vi } from 'vitest';
import { Platform, Share } from 'react-native';

vi.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  Share: { share: vi.fn().mockResolvedValue(undefined) },
}));

// mediaLibraryCompat pulls in expo-constants, which can't load under vitest.
vi.mock('@/lib/mediaLibraryCompat', () => ({ getMediaLibrary: () => null }));

import { STORY_CARD_WIDTH, STORY_CARD_HEIGHT, captureShareCard, shareStoryCardImage, shareCardToInstagramStories } from '@/lib/shareCard';

afterEach(() => {
  Platform.OS = 'ios';
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.doUnmock('expo-sharing');
});

describe('shareCard: story image dimensions', () => {
  it('targets a 9:16 story canvas', () => {
    expect(STORY_CARD_WIDTH).toBe(1080);
    expect(STORY_CARD_HEIGHT).toBe(1920);
    expect(STORY_CARD_HEIGHT / STORY_CARD_WIDTH).toBeCloseTo(16 / 9, 5);
  });
});

describe('shareCard: captureShareCard', () => {
  it('captures the given ref at the exact story canvas size', async () => {
    const captureRef = vi.fn().mockResolvedValue('file:///tmp/card.png');
    vi.doMock('react-native-view-shot', () => ({ captureRef }));

    const uri = await captureShareCard({ current: {} } as never);

    expect(captureRef).toHaveBeenCalledWith(
      { current: {} },
      expect.objectContaining({
        format: 'png',
        width: STORY_CARD_WIDTH,
        height: STORY_CARD_HEIGHT,
      }),
    );
    expect(uri).toBe('file:///tmp/card.png');
    vi.doUnmock('react-native-view-shot');
  });
});

describe('shareCard: shareStoryCardImage', () => {
  it('opens the system share sheet with the PNG when sharing is available', async () => {
    const shareAsync = vi.fn().mockResolvedValue(undefined);
    vi.doMock('expo-sharing', () => ({ isAvailableAsync: vi.fn().mockResolvedValue(true), shareAsync }));

    expect(await shareStoryCardImage('file:///tmp/card.png', 'maya-story.png')).toBe('shared');
    expect(shareAsync).toHaveBeenCalledWith('file:///tmp/card.png', expect.objectContaining({ mimeType: 'image/png' }));
    vi.doUnmock('expo-sharing');
  });

  it('routes the legacy story button through expo-sharing without a social SDK', async () => {
    const shareAsync = vi.fn().mockResolvedValue(undefined);
    vi.doMock('expo-sharing', () => ({ isAvailableAsync: vi.fn().mockResolvedValue(true), shareAsync }));

    expect(await shareCardToInstagramStories('file:///tmp/card.png')).toBe('system');
    expect(shareAsync).toHaveBeenCalledWith('file:///tmp/card.png', {
      mimeType: 'image/png', UTI: 'public.png', dialogTitle: 'Add to story',
    });
    expect(Share.share).not.toHaveBeenCalled();
  });

  it.each(['ios', 'android'] as const)('uses the native system fallback on %s when expo-sharing is unavailable', async (platform) => {
    Platform.OS = platform;
    vi.doMock('expo-sharing', () => ({ isAvailableAsync: vi.fn().mockResolvedValue(false), shareAsync: vi.fn() }));

    expect(await shareCardToInstagramStories('file:///tmp/card.png')).toBe('system');
    expect(Share.share).toHaveBeenCalledWith(platform === 'ios'
      ? { url: 'file:///tmp/card.png' }
      : { message: 'file:///tmp/card.png' });
  });

  it('does not report success or open a second sheet when sharing rejects', async () => {
    vi.doMock('expo-sharing', () => ({
      isAvailableAsync: vi.fn().mockResolvedValue(true),
      shareAsync: vi.fn().mockRejectedValue(new Error('Sharing cancelled or failed')),
    }));

    expect(await shareCardToInstagramStories('file:///tmp/card.png')).toBe('cancelled');
    expect(Share.share).not.toHaveBeenCalled();
  });

  it('downloads the story card on web without opening a native sheet', async () => {
    Platform.OS = 'web';
    const anchor = { href: '', download: '', click: vi.fn() };
    const body = { appendChild: vi.fn(), removeChild: vi.fn() };
    vi.stubGlobal('document', { createElement: vi.fn(() => anchor), body });

    expect(await shareCardToInstagramStories('data:image/png;base64,abc')).toBe('downloaded');
    expect(anchor.download).toBe('brandthread-story.png');
    expect(anchor.click).toHaveBeenCalledOnce();
    expect(body.removeChild).toHaveBeenCalledWith(anchor);
    expect(Share.share).not.toHaveBeenCalled();
  });
});
