import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  Linking: { canOpenURL: vi.fn().mockResolvedValue(false) },
  Share: { share: vi.fn().mockResolvedValue(undefined) },
}));

import { STORY_CARD_WIDTH, STORY_CARD_HEIGHT, captureShareCard } from '@/lib/shareCard';

describe('shareCard: story image dimensions', () => {
  it('targets a 9:16 Instagram-Stories-ready canvas', () => {
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
