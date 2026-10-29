import { afterEach, describe, expect, it, vi } from 'vitest';

const alert = vi.hoisted(() => vi.fn());
vi.mock('react-native', () => ({ Alert: { alert }, Platform: { OS: 'web' }, Share: { share: vi.fn() } }));

import { copyLink } from './shareActions';

const realNavigator = globalThis.navigator;
function setNavigator(value: unknown) {
  Object.defineProperty(globalThis, 'navigator', { value, configurable: true, writable: true });
}

describe('copyLink on web (audit)', () => {
  afterEach(() => { setNavigator(realNavigator); alert.mockClear(); });

  it('reports failure instead of "Link copied" when the browser has no Clipboard API', async () => {
    setNavigator({});
    expect(await copyLink('https://brandthread.app/@nova')).toBe(false);
    expect(alert).toHaveBeenCalledWith('Couldn’t copy link', 'Try again.');
    expect(alert).not.toHaveBeenCalledWith('Link copied');
  });

  it('copies and confirms when the Clipboard API exists', async () => {
    const writeText = vi.fn(async () => {});
    setNavigator({ clipboard: { writeText } });
    expect(await copyLink('https://brandthread.app/@nova')).toBe(true);
    expect(writeText).toHaveBeenCalledWith('https://brandthread.app/@nova');
    expect(alert).toHaveBeenCalledWith('Link copied');
  });
});
