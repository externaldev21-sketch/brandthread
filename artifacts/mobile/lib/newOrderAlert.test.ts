import { beforeEach, describe, expect, it, vi } from 'vitest';

const platform = vi.hoisted(() => ({ OS: 'ios' }));
const player = vi.hoisted(() => ({ play: vi.fn(), remove: vi.fn(), addListener: vi.fn(() => ({ remove: vi.fn() })) }));
vi.mock('react-native', () => ({ Platform: platform }));
vi.mock('@/lib/haptics', () => ({ hapticLight: vi.fn(), hapticSuccess: vi.fn() }));
vi.mock('expo-audio', () => ({ createAudioPlayer: vi.fn(() => player) }));
vi.mock('@/lib/newOrderSoundSource', () => ({ NEW_ORDER_SOUND: 1 }));

import { hapticLight, hapticSuccess } from '@/lib/haptics';
import { createAudioPlayer } from 'expo-audio';
import { bannerFeedbackFor, playBannerFeedback } from './newOrderAlert';

const flush = () => new Promise(resolve => setTimeout(resolve, 20));

beforeEach(() => {
  vi.clearAllMocks();
  platform.OS = 'ios';
});

describe('bannerFeedbackFor', () => {
  it('maps push data to feedback', () => {
    expect(bannerFeedbackFor({ type: 'new_order_received' })).toBe('newOrder');
    expect(bannerFeedbackFor({ type: 'new_order_received', silent: true })).toBe('none');
    expect(bannerFeedbackFor({ type: 'message' })).toBe('tap');
    expect(bannerFeedbackFor(undefined)).toBe('tap');
  });
});

describe('playBannerFeedback', () => {
  it('plays one success haptic and the order sound once for a new order', async () => {
    playBannerFeedback({ type: 'new_order_received' });
    await flush();
    expect(hapticSuccess).toHaveBeenCalledTimes(1);
    expect(hapticLight).not.toHaveBeenCalled();
    expect(createAudioPlayer).toHaveBeenCalledTimes(1);
    expect(player.play).toHaveBeenCalledTimes(1);
  });

  it('stays quiet when the seller turned the new order sound off', async () => {
    playBannerFeedback({ type: 'new_order_received', silent: true });
    await flush();
    expect(hapticSuccess).not.toHaveBeenCalled();
    expect(hapticLight).not.toHaveBeenCalled();
    expect(createAudioPlayer).not.toHaveBeenCalled();
  });

  it('keeps the light haptic for other pushes and nothing on web', async () => {
    playBannerFeedback({ type: 'message' });
    expect(hapticLight).toHaveBeenCalledTimes(1);
    platform.OS = 'web';
    playBannerFeedback({ type: 'new_order_received' });
    await flush();
    expect(hapticSuccess).not.toHaveBeenCalled();
    expect(createAudioPlayer).not.toHaveBeenCalled();
  });
});
