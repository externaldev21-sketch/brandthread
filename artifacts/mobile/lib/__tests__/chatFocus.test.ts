import { describe, expect, it } from 'vitest';
import { messageRowIndex, setPendingChatFocus, takePendingChatFocus } from '../chatFocus';

describe('chat focus handoff', () => {
  it('is taken once, and only by the same conversation', () => {
    setPendingChatFocus('c1', 'm9');
    expect(takePendingChatFocus('c2')).toBeNull();
    expect(takePendingChatFocus('c1')).toBe('m9');
    expect(takePendingChatFocus('c1')).toBeNull();
  });
  it('finds the message row among date and call rows', () => {
    const rows = [{ type: 'date' }, { type: 'message', msg: { id: 'a' } }, { type: 'call_log' }, { type: 'message', msg: { id: 'b' } }];
    expect(messageRowIndex(rows, 'b')).toBe(3);
    expect(messageRowIndex(rows, 'zz')).toBe(-1);
  });
});
