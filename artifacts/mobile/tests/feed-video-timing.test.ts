import { describe, it, expect, vi, afterEach } from 'vitest';
import { beginFeedVideoTiming, completeFeedVideoTiming } from '../lib/feedVideoTiming';

afterEach(() => vi.restoreAllMocks());
describe('feed actual-frame timing', () => {
  it('measures monotonic activation-to-frame time and records each activation once', () => {
    const clock = vi.spyOn(performance, 'now');
    clock.mockReturnValueOnce(100).mockReturnValueOnce(137);
    const token = beginFeedVideoTiming('real-post');
    expect(completeFeedVideoTiming(token)?.activationToFirstFrameMs).toBe(37);
    expect(completeFeedVideoTiming(token)).toBeNull();
  });
  it('allows an already-painted warm surface to be revealed immediately', () => {
    vi.spyOn(performance, 'now').mockReturnValue(12);
    expect(completeFeedVideoTiming(beginFeedVideoTiming('warm-post'))?.activationToFirstFrameMs).toBe(0);
  });
});
