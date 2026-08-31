import { describe, expect, it } from 'vitest';
import { getInitialDropBroadcastStates } from './dropBroadcastState';

describe('drop broadcast state hydration', () => {
  it('keeps zero-recipient broadcasts already notified after reload', () => {
    expect(getInitialDropBroadcastStates([
      {
        id: 'drop-zero-followers',
        broadcastSentAt: '2026-08-31T01:00:00.000Z',
      },
      {
        id: 'drop-never-broadcast',
        broadcastSentAt: null,
      },
    ])).toEqual({
      'drop-zero-followers': 'already_sent',
    });
  });
});