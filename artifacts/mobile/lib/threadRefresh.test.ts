import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native-reanimated', () => ({ default: {}, Easing: {}, cancelAnimation: () => {}, useAnimatedStyle: () => ({}), useSharedValue: (v: unknown) => ({ value: v }), withRepeat: (v: unknown) => v, withTiming: (v: unknown) => v }));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
vi.mock('@/hooks/useReduceMotion', () => ({ useReduceMotion: () => false }));
vi.mock('@/contexts/AppThemeContext', () => ({ useAppTheme: () => ({ theme: { muted: '#C0C0C0' } }) }));
vi.mock('react-native', () => ({ Platform: { OS: 'ios' }, RefreshControl: () => null, StyleSheet: { create: (s: unknown) => s }, View: () => null, useWindowDimensions: () => ({ width: 393, height: 852 }) }));

import { THREAD_LOOP_MS, stitchCount } from '@/components/ui/ThreadRefresh';

describe('thread refresh', () => {
  it('loops in under a second', () => {
    expect(THREAD_LOOP_MS).toBeLessThan(1000);
  });
  it('fits whole stitches across the width (6pt dash, 4pt gap)', () => {
    expect(stitchCount(361)).toBe(36);
    expect(stitchCount(6)).toBe(1);
    expect(stitchCount(0)).toBe(0);
  });
});
