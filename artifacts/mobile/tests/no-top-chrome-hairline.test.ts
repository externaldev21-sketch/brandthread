import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { scanRepo, scanSource } from '../scripts/lint/no-top-chrome-hairline.mjs';

const read = (p: string) => readFileSync(path.join(process.cwd(), p), 'utf8');

/**
 * Dev: "I don't want that to happen at the top of ANY of my screens" — the
 * thin line above the Discover header. No top-of-screen container may draw
 * a hairline, border, shadow or a solid strip under the status bar.
 */
describe('nothing draws a line at the top of a screen', () => {
  it('no header / top bar / status-bar container in app/ or components/ has a border, hairline or shadow', () => {
    expect(scanRepo()).toEqual([]);
  });

  it('catches a border on a multi-line header style and a returning status-bar mask', () => {
    const header = `const styles = StyleSheet.create({\n  header: {\n    flexDirection: 'row',\n    borderBottomWidth: StyleSheet.hairlineWidth,\n  },\n});`;
    expect(scanSource('app/x.tsx', header).map((o: { what: string }) => o.what)).toEqual(['border', 'hairline']);
    const shadow = `const s = { topBar: { height: 44, shadowOpacity: 0.2 } };`;
    expect(scanSource('app/y.tsx', shadow)).toHaveLength(1);
    const mask = `<View testID="status-bar-mask" style={{ height: 59 }} />`;
    expect(scanSource('components/z.tsx', mask)[0].what).toBe('solid status-bar strip');
  });

  it('allows a zero border and ignores rows that are not top-of-screen chrome', () => {
    expect(scanSource('app/a.tsx', `const s = { header: { padding: 8, borderBottomWidth: 0 } };`)).toEqual([]);
    expect(scanSource('app/b.tsx', `const s = { sectionHeader: { padding: 8, borderBottomWidth: 1 } };`)).toEqual([]);
  });

  it('the shared headers cannot draw a divider at all', () => {
    for (const f of ['components/ScreenHeader.tsx', 'components/layout/Header.tsx']) {
      const src = read(f);
      expect(src, f).not.toMatch(/hairlineWidth/);
      expect(src, f).not.toMatch(/border(Bottom|Top)Width\s*:\s*(?!0\b)[^\s,}]/);
    }
  });

  it('the top inset every header pads by is snapped to a whole device pixel', () => {
    const hook = read('hooks/useHeaderTopInset.ts');
    expect(hook).toMatch(/PixelRatio\.roundToNearestPixel/);
    expect(hook).toMatch(/return roundToDevicePixel\(/);
  });
});
