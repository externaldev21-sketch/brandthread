import { describe, expect, it, vi } from 'vitest';
vi.mock('react-native-reanimated', () => ({}));
vi.mock('@/lib/haptics', () => ({ hapticLight: vi.fn() }));
import { EDGE_WIDTH, entryOffset, shouldCompleteBack, shouldStartBackSwipe } from './motion';

describe('onboarding edge swipe', () => {
  it('only starts from the left edge, rightward, horizontally locked, when back exists', () => {
    expect(shouldStartBackSwipe(5, 20, 2, true)).toBe(true);
    expect(shouldStartBackSwipe(5, 20, 2, false)).toBe(false);
    expect(shouldStartBackSwipe(EDGE_WIDTH + 1, 20, 2, true)).toBe(false);
    expect(shouldStartBackSwipe(5, -20, 2, true)).toBe(false);
    expect(shouldStartBackSwipe(5, 20, 18, true)).toBe(false);
  });
  it('completes on distance or velocity', () => {
    expect(shouldCompleteBack(150, 0, 400)).toBe(true);
    expect(shouldCompleteBack(40, 0.8, 400)).toBe(true);
    expect(shouldCompleteBack(40, 0.1, 400)).toBe(false);
  });
  it('forward enters from the right, back from the left', () => {
    expect(entryOffset(1, 400)).toBeGreaterThan(0);
    expect(entryOffset(-1, 400)).toBeLessThan(0);
  });
});
