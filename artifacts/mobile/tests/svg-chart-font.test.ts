/**
 * Chart axis/tick labels are react-native-svg <Text>, which never passes
 * through the app's Text shim. A bare `fontFamily={FONT.regular}` reached the
 * browser as the literal family "system-400" and rendered in the default
 * serif ("Revenue by hour" time labels). Every SvgText in the analytics
 * charts must take its font from svgTextFont() instead.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

let os = 'web';
vi.mock('react-native', () => ({
  Platform: {
    get OS() { return os; },
    select: (o: Record<string, unknown>) => o.web ?? o.default,
  },
  StyleSheet: { flatten: (s: unknown) => s },
}));

import { SYSTEM_FONT, svgTextFont } from '@/lib/systemFont';
import { FONT } from '@/lib/theme';

const CHART_FILES = [
  'components/analytics/AnalyticsKit.tsx',
  'components/analytics/InsightCharts.tsx',
];

describe('svgTextFont', () => {
  it('resolves a FONT token to Inter at its weight on web', () => {
    os = 'web';
    expect(SYSTEM_FONT.startsWith('Inter')).toBe(true);
    expect(svgTextFont(FONT.regular)).toEqual({ fontFamily: SYSTEM_FONT, fontWeight: '400' });
    expect(svgTextFont(FONT.semibold)).toEqual({ fontFamily: SYSTEM_FONT, fontWeight: '600' });
  });

  it('leaves the family to the platform UI font on native', () => {
    os = 'ios';
    expect(svgTextFont(FONT.medium)).toEqual({ fontWeight: '500' });
  });

  it.each(CHART_FILES)('%s never hands a raw FONT token to SvgText', (file) => {
    const src = readFileSync(path.join(__dirname, '..', file), 'utf8');
    const svgTexts = src.match(/<SvgText\b.*$/gm) ?? [];
    expect(svgTexts.length).toBeGreaterThan(0);
    for (const tag of svgTexts) {
      expect(tag).not.toMatch(/fontFamily=/);
      expect(tag).toContain('svgTextFont(');
    }
  });
});
