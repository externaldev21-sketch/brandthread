import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({
  Platform: { select: (o: Record<string, unknown>) => o.ios ?? o.default },
  StyleSheet: {
    flatten: (style: unknown): Record<string, unknown> =>
      Array.isArray(style) ? Object.assign({}, ...style.flat(Infinity).filter(Boolean)) : (style as Record<string, unknown>),
  },
}));

import { SYSTEM_FONT, weightForFamily, withSystemFont } from '@/lib/systemFont';
import { FONT } from '@/lib/theme';

describe('system font', () => {
  it('maps every FONT token and legacy Inter family to a weight', () => {
    expect(weightForFamily(FONT.regular)).toBe('400');
    expect(weightForFamily(FONT.medium)).toBe('500');
    expect(weightForFamily(FONT.semibold)).toBe('600');
    expect(weightForFamily(FONT.bold)).toBe('700');
    expect(weightForFamily('Inter_600SemiBold')).toBe('600');
    expect(weightForFamily('Anton_400Regular')).toBeNull();
    expect(weightForFamily(undefined)).toBeNull();
  });

  it('swaps a weight token for the system font at that weight', () => {
    const resolved = withSystemFont([{ fontSize: 17 }, { fontFamily: FONT.bold }]);
    expect(resolved).toEqual([[{ fontSize: 17 }, { fontFamily: FONT.bold }], { fontFamily: SYSTEM_FONT, fontWeight: '700' }]);
  });

  it('keeps an explicit fontWeight', () => {
    const resolved = withSystemFont({ fontFamily: FONT.regular, fontWeight: '600' as const });
    expect(resolved).toEqual([{ fontFamily: FONT.regular, fontWeight: '600' }, { fontFamily: SYSTEM_FONT, fontWeight: '600' }]);
  });

  it('returns the same style untouched when there is nothing to map', () => {
    const style = { fontFamily: 'Anton_400Regular', fontSize: 30 };
    expect(withSystemFont(style)).toBe(style);
    expect(withSystemFont(undefined)).toBeUndefined();
  });
});
