import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({
  Animated: { Value: class {}, View: 'View', spring: () => ({ start: () => {} }), timing: () => ({ start: () => {} }) },
  PanResponder: { create: () => ({ panHandlers: {} }) },
  Platform: { OS: 'ios' },
  Pressable: 'Pressable', StyleSheet: { create: (s: unknown) => s }, Text: 'Text', View: 'View',
}));
vi.mock('@/components/ui/Icon', () => ({ Icon: 'Icon' }));
vi.mock('@/constants/motion', () => ({ SPRING: {} }));
vi.mock('@/lib/haptics', () => ({ haptics: { selection: vi.fn() } }));
vi.mock('@/contexts/AppThemeContext', () => ({ useAppTheme: () => ({ theme: {} }) }));

import { FULL_SWIPE_FRACTION, resolveSwipeRelease } from '../SwipeRow';

const both = { width: 390, leadingWidth: 148, trailingWidth: 222, fullSwipe: true };

describe('resolveSwipeRelease (Apple Mail swipe)', () => {
  it('full swipe past the threshold runs the outermost action on that side', () => {
    expect(resolveSwipeRelease(-390 * FULL_SWIPE_FRACTION - 1, 0, both)).toEqual({ kind: 'full', side: 'trailing' });
    expect(resolveSwipeRelease(390 * FULL_SWIPE_FRACTION + 1, 0, both)).toEqual({ kind: 'full', side: 'leading' });
  });

  it('a partial swipe past half the buttons opens them; a short one closes', () => {
    expect(resolveSwipeRelease(-120, 0, both)).toEqual({ kind: 'open', side: 'trailing' });
    expect(resolveSwipeRelease(80, 0, both)).toEqual({ kind: 'open', side: 'leading' });
    expect(resolveSwipeRelease(-40, 0, both)).toEqual({ kind: 'close' });
  });

  it('a flick opens even when the finger travelled a little', () => {
    expect(resolveSwipeRelease(-40, -1.2, both)).toEqual({ kind: 'open', side: 'trailing' });
  });

  it('never opens a side that has no actions, and respects fullSwipe=false', () => {
    const trailingOnly = { ...both, leadingWidth: 0 };
    expect(resolveSwipeRelease(300, 0, trailingOnly)).toEqual({ kind: 'close' });
    expect(resolveSwipeRelease(-300, 0, { ...both, fullSwipe: false })).toEqual({ kind: 'open', side: 'trailing' });
  });
});
