import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The floating tab bars (buyer + seller) must never show square corners or a
 * rectangle behind their rounded pills. Every painted layer of the pill glass
 * (blur, tint, specular gradient) carries the pill's own radius rather than
 * relying solely on the wrapper's `overflow: hidden` — WebKit and composited
 * layers can drop that clip for backdrop-filter children.
 */
const read = (file: string) => readFileSync(resolve(__dirname, '..', file), 'utf8');
const parts = read('components/tab-bar/TabBarParts.tsx');
const seller = read('components/SellerGlobalTabBar.tsx');
const buyer = read('components/buyer-nav/BuyerTabBar.tsx');

function body(source: string, start: string, end: string) {
  const from = source.indexOf(start);
  expect(from).toBeGreaterThan(-1);
  return source.slice(from, source.indexOf(end, from));
}

describe('tab bar has no square background', () => {
  it('rounds every painted TabBarGlass layer', () => {
    const tabBarGlass = body(parts, 'export function TabBarGlass', '// ─── Unread badge');
    expect(tabBarGlass).toContain("const rounded = { borderRadius: radius, overflow: 'hidden' } as const;");
    expect(tabBarGlass).toMatch(/<BlurView[\s\S]*?style=\{\[StyleSheet\.absoluteFill, rounded\]\}/);
    expect(tabBarGlass).toMatch(/<LinearGradient[\s\S]*?style=\{\[StyleSheet\.absoluteFill, rounded\]\}/);
    expect(tabBarGlass).toMatch(/StyleSheet\.absoluteFill,\s*rounded,\s*\{ backgroundColor/);
    expect(tabBarGlass).not.toMatch(/style=\{StyleSheet\.absoluteFill\}/);
  });

  it('gives each pill shadow the same radius as its pill, and the bar row no fill', () => {
    expect(parts).toMatch(/style=\{\[TAB_BAR_SHADOW, \{ width: size, height: size, borderRadius: radius\.bar \}/);
    expect(seller).toMatch(/TAB_BAR_SHADOW,\s*\{\s*width: metrics\.capsuleWidth,\s*height: metrics\.capsuleHeight,\s*borderRadius: radius\.bar,/);
    expect(buyer).toMatch(/styles\.shadow,\s*\{ width: regularMetrics\.capsuleWidth, height: regularMetrics\.capsuleHeight, borderRadius: radius\.bar \}/);
    for (const source of [seller, buyer]) {
      const barStyle = body(source, '  bar: {', '},');
      expect(barStyle).not.toMatch(/backgroundColor|boxShadow|shadow|elevation/);
    }
  });
});
