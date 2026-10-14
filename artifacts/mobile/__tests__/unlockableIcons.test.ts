import { describe, expect, it } from 'vitest';
import { bestLevel, isIconUnlocked, lockedCaption, unlockableIconName } from '@/lib/unlockableIcons';

describe('unlockable app icons', () => {
  it('takes the best level across brands', () => {
    expect(bestLevel([])).toBeNull();
    expect(bestLevel(['member', null, 'insider', 'member'])).toBe('insider');
    expect(bestLevel(['insider', 'inner_circle'])).toBe('inner_circle');
  });

  it('unlocks Brushed silver at Insider and Chrome at Inner Circle with any brand', () => {
    expect(isIconUnlocked('brushed-silver', null)).toBe(false);
    expect(isIconUnlocked('brushed-silver', 'member')).toBe(false);
    expect(isIconUnlocked('brushed-silver', 'insider')).toBe(true);
    expect(isIconUnlocked('chrome', 'insider')).toBe(false);
    expect(isIconUnlocked('chrome', 'inner_circle')).toBe(true);
    expect(isIconUnlocked('brushed-silver', 'inner_circle')).toBe(true);
  });

  it('names icons and their locked captions', () => {
    expect(unlockableIconName('chrome')).toBe('Chrome');
    expect(lockedCaption('brushed-silver')).toBe('Insider');
    expect(lockedCaption('chrome')).toBe('Inner Circle');
  });
});
