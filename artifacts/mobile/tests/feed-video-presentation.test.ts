import { describe, expect, it, vi } from 'vitest';
import { canPlayFeedAudio, observeFeedVideoFrame } from '../lib/feedVideoPresentation';

function videoFixture(frameCallbacks = true) {
  const callbacks = new Map<number, () => void>();
  let nextId = 0;
  const element = Object.assign(new EventTarget(), {
    currentTime: 0, readyState: 4, videoWidth: 720, videoHeight: 1280,
    requestVideoFrameCallback: frameCallbacks ? vi.fn((callback: () => void) => {
      callbacks.set(++nextId, callback);
      return nextId;
    }) : undefined,
    cancelVideoFrameCallback: vi.fn((id: number) => { callbacks.delete(id); }),
  });
  const frame = () => {
    const pending = [...callbacks.values()];
    callbacks.clear();
    pending.forEach(callback => callback());
  };
  return { video: element as unknown as HTMLVideoElement, callbacks, frame };
}

describe('feed audio and visible frame handoff', () => {
  const ready = { active: true, focused: true, paused: false, laidOut: true, videoVisible: true };
  it('allows audio only on the active focused laid-out surface after its poster is gone', () => {
    expect(canPlayFeedAudio(ready)).toBe(true);
    for (const change of [
      { active: false }, { focused: false }, { paused: true },
      { laidOut: false }, { videoVisible: false },
    ]) expect(canPlayFeedAudio({ ...ready, ...change })).toBe(false);
  });

  it('does not equate play, loadeddata or progress with a compositor frame', () => {
    const { video, frame } = videoFixture();
    const visible = vi.fn();
    const stop = observeFeedVideoFrame(video, visible, vi.fn());
    for (const event of ['play', 'playing', 'loadeddata', 'canplay', 'timeupdate']) video.dispatchEvent(new Event(event));
    expect(visible).not.toHaveBeenCalled();
    frame();
    expect(visible).toHaveBeenCalledTimes(1);
    frame();
    expect(visible).toHaveBeenCalledTimes(1);
    stop();
  });

  it('arms for an already-loaded prepared surface without requiring another load event', () => {
    const { video, frame } = videoFixture();
    const visible = vi.fn();
    const stop = observeFeedVideoFrame(video, visible, vi.fn());
    frame();
    expect(visible).toHaveBeenCalledOnce();
    stop();
  });

  it('invalidates stale callbacks after seeking/source changes and remutes on buffering', () => {
    const { video, callbacks, frame } = videoFixture();
    const visible = vi.fn();
    const reset = vi.fn();
    const stop = observeFeedVideoFrame(video, visible, reset);
    const stale = [...callbacks.values()][0];
    video.dispatchEvent(new Event('loadstart'));
    stale();
    expect(visible).not.toHaveBeenCalled();
    frame();
    expect(visible).toHaveBeenCalledOnce();
    video.dispatchEvent(new Event('waiting'));
    expect(reset).toHaveBeenCalledTimes(2);
    frame();
    expect(visible).toHaveBeenCalledTimes(2);
    stop();
  });

  it('does not let released/offscreen views grant readiness to a later player', () => {
    const { video, callbacks } = videoFixture();
    const visible = vi.fn();
    const stop = observeFeedVideoFrame(video, visible, vi.fn());
    const stale = [...callbacks.values()][0];
    stop();
    stale();
    expect(visible).not.toHaveBeenCalled();
    expect(callbacks.size).toBe(0);
  });

  it('requires decoded dimensions and actual advancing time on older WebKit', () => {
    const { video } = videoFixture(false);
    const visible = vi.fn();
    const stop = observeFeedVideoFrame(video, visible, vi.fn());
    video.dispatchEvent(new Event('loadeddata'));
    video.dispatchEvent(new Event('timeupdate'));
    expect(visible).not.toHaveBeenCalled();
    video.currentTime = 0.05;
    video.dispatchEvent(new Event('timeupdate'));
    expect(visible).toHaveBeenCalledOnce();
    stop();
  });
});
