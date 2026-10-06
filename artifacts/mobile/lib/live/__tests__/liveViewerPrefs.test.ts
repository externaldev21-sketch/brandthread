import { describe, expect, it } from 'vitest';
import { getLiveViewerPrefs, setLiveViewerPrefs } from '@/lib/live/liveViewerPrefs';

describe('live viewer prefs', () => {
  it('starts off and keeps changes for the next room', () => {
    expect(getLiveViewerPrefs()).toEqual({ captions: false, dataSaver: false });
    setLiveViewerPrefs({ captions: true });
    expect(getLiveViewerPrefs()).toEqual({ captions: true, dataSaver: false });
    setLiveViewerPrefs({ dataSaver: true });
    expect(getLiveViewerPrefs()).toEqual({ captions: true, dataSaver: true });
  });
});
