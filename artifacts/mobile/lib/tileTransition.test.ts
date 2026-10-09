import { beforeEach, describe, expect, it } from 'vitest';
import {
  __clearPendingTileTransitionForTests,
  PENDING_TTL_MS,
  productTransitionKey,
  setPendingTileTransition,
  takePendingTileTransition,
} from './tileTransition';

describe('tileTransition handoff', () => {
  beforeEach(() => __clearPendingTileTransitionForTests());

  it('hands off the rect to the matching destination and then clears it', () => {
    setPendingTileTransition({ postId: 'p1', uri: 'https://x/1.jpg', rect: { x: 1, y: 2, width: 3, height: 4 } });
    expect(takePendingTileTransition('p1')).toMatchObject({
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

  it('ignores a handoff nobody picked up in time', () => {
    setPendingTileTransition({ postId: 'p1', uri: null, rect: { x: 0, y: 0, width: 1, height: 1 }, at: 1000 });
    expect(takePendingTileTransition('p1', 1000 + PENDING_TTL_MS + 1)).toBeNull();
  });

  it('keys product tiles apart from posts with the same id', () => {
    setPendingTileTransition({ postId: productTransitionKey('42'), uri: 'u', rect: { x: 0, y: 0, width: 1, height: 1 } });
    expect(takePendingTileTransition('42')).toBeNull();
    setPendingTileTransition({ postId: productTransitionKey('42'), uri: 'u', rect: { x: 0, y: 0, width: 1, height: 1 } });
    expect(takePendingTileTransition('product:42')).toMatchObject({ uri: 'u' });
  });
});
