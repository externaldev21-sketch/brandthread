import { describe, expect, it, vi } from 'vitest';
import { copyProfileLink } from '@/lib/copyProfileLink';

describe('copyProfileLink', () => {
  it('copies the canonical profile URL', async () => {
    const setString = vi.fn().mockResolvedValue(true);
    expect(await copyProfileLink('Maya_Studio', setString)).toBe(true);
    expect(setString).toHaveBeenCalledWith('https://brandthread.app/u/maya_studio');
  });

  it('copies nothing without a valid handle', async () => {
    const setString = vi.fn();
    expect(await copyProfileLink(null, setString)).toBe(false);
    expect(await copyProfileLink('ab', setString)).toBe(false);
    expect(setString).not.toHaveBeenCalled();
  });

  it('reports a clipboard failure', async () => {
    expect(await copyProfileLink('maya', vi.fn().mockRejectedValue(new Error('denied')))).toBe(false);
  });
});
