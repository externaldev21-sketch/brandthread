import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({
  Platform: { OS: 'web', select: (values: Record<string, unknown>) => values.web ?? values.default },
  StyleSheet: {
    flatten: (style: unknown) => Array.isArray(style)
      ? Object.assign({}, ...style.flat(Infinity).filter(Boolean)) : style,
  },
}));

import { SYSTEM_FONT, weightForFamily, withSystemFont } from '@/lib/systemFont';

describe('bundled web text font resolution', () => {
  it('uses Inter for unstyled web text without replacing authored display fonts', () => {
    expect(withSystemFont(undefined)).toEqual({ fontFamily: SYSTEM_FONT });
    expect(withSystemFont({ fontSize: 15 })).toEqual([{ fontSize: 15 }, { fontFamily: SYSTEM_FONT }]);
    const display = { fontFamily: 'Anton_400Regular' };
    expect(withSystemFont(display)).toBe(display);
  });

  it('puts bundled Inter and a real Latin fallback before emoji fonts', () => {
    const family = 'system-400, "Apple Color Emoji", "Noto Color Emoji"';
    const resolved = withSystemFont({ fontFamily: family }) as unknown as Array<{ fontFamily: string; fontWeight: string }>;
    expect(weightForFamily(family)).toBe('400');
    expect(resolved[1]).toEqual({
      fontFamily: `${SYSTEM_FONT}, "Apple Color Emoji", "Noto Color Emoji"`,
      fontWeight: '400',
    });
    expect(resolved[1].fontFamily.indexOf('system-ui')).toBeLessThan(resolved[1].fontFamily.indexOf('Noto Color Emoji'));
    expect(resolved[1].fontFamily).not.toContain('system-400');
  });

  it('resolves quoted legacy families without overriding explicit weights', () => {
    const resolved = withSystemFont({ fontFamily: '"Inter_700Bold", serif', fontWeight: '600' as const }) as unknown as Array<{ fontFamily: string; fontWeight: string }>;
    expect(resolved[1]).toEqual({ fontFamily: `${SYSTEM_FONT}, serif`, fontWeight: '600' });
  });
});
