import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, it, expect } from 'vitest';
import { bumpCommentCount, useCommentCountDelta } from '../lib/commentCountBus';

describe('Rail comment count after a server refresh', () => {
  it('bumps immediately, then absorbs that bump when the persisted count arrives', async () => {
    let value = 0;
    function Probe({ count }: { count: number }) { value = useCommentCountDelta('comment-refresh-test', count); return null; }
    let root!: ReactTestRenderer;
    await act(async () => { root = create(<Probe count={4} />); });
    expect(value).toBe(0);
    await act(async () => { bumpCommentCount('comment-refresh-test'); });
    expect(value).toBe(1);
    await act(async () => { root.update(<Probe count={5} />); });
    expect(value).toBe(0);
    await act(async () => { root.unmount(); });
  });
  it('does not add a prior post’s delta to a different post', async () => {
    let value = 0;
    function Probe({ id }: { id: string }) { value = useCommentCountDelta(id, 3); return null; }
    let root!: ReactTestRenderer;
    await act(async () => { root = create(<Probe id="comment-scope-a" />); bumpCommentCount('comment-scope-b', 8); });
    await act(async () => { bumpCommentCount('comment-scope-a'); });
    expect(value).toBe(1);
    await act(async () => { root.update(<Probe id="comment-scope-b" />); });
    expect(value).toBe(0);
    await act(async () => { root.unmount(); });
  });
});
