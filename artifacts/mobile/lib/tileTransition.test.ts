import { beforeEach, describe, expect, it } from 'vitest';
import {
  __clearPendingTileTransitionForTests,
  setPendingTileTransition,
  takePendingTileTransition,
} from './tileTransition';

describe('tileTransition handoff', () => {
  beforeEach(() => __clearPendingTileTransitionForTests());

  it('hands off the rect to the matching destination and then clears it', () => {
    setPendingTileTransition({ postId: 'p1', uri: 'https://x/1.jpg', rect: { x: 1, y: 2, width: 3, height: 4 } });
    expect(takePendingTileTransition('p1')).toEqual({
      postId: 'p1', uri: 'https://x/1.jpg', rect: { x: 1, y: 2, width: 3, height: 4 },
    });
    expect(takePendingTileTransition('p1')).toBeNull();
  });

  it('does not hand off a transition meant for a different post', () => {
    setPendingTileTransition({ postId: 'p1', uri: null, rect: { x: 0, y: 0, width: 0, height: 0 } });
    expect(takePendingTileTransition('p2')).toBeNull();
  });

  it('returns null when nothing is pending', () => {
    expect(takePendingTileTransition('anything')).toBeNull();
  });
});
