import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-image', () => ({ Image: { prefetch: vi.fn(async () => { throw new Error('offline'); }) } }));

import { prefetchImage } from '../prefetch';

describe('prefetchImage', () => {
  it('swallows a failed prefetch instead of leaving an unhandled rejection', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      prefetchImage('https://example.test/a.jpg');
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });
});
