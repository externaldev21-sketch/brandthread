import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import TestRenderer, { act } from 'react-test-renderer';

vi.mock('@/components/CachedImage', () => ({ CachedImage: 'CachedImage' }));

import { useCountdown } from '../StoryStickers';

describe('StoryStickers countdown (audit)', () => {
  it('uses the time the server snapshot arrived, not the time the story was opened', async () => {
    const now = Date.now();
    // Clocks agree; the story (and its serverNow) was fetched 30 s before it is opened.
    const receivedAt = now - 30_000;
    const serverNow = receivedAt;
    const releaseAt = new Date(receivedAt + 60_000).toISOString();
    let left: number | null = null;
    function Probe() { left = useCountdown(releaseAt, serverNow, false, receivedAt); return null; }
    await act(async () => { TestRenderer.create(<Probe />); });
    // 60 s after the fetch = 30 s from now (not 60 s from now).
    expect(left).not.toBeNull();
    expect(Math.abs((left as unknown as number) - 30_000)).toBeLessThan(2_000);
  });
});
