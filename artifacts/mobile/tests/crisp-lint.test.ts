import { describe, expect, it } from 'vitest';
import { baselineFrom, findViolations, readAllowlist, readBaseline, scanSource, scanTree } from '../scripts/lint/crisp.mjs';
import { routeForFile, slugForRoute } from '../scripts/crisp/routes.mjs';

describe('crisp lint (no blur, faded text or soft edges)', () => {
  it('counts blur, translucent glass and faded text', () => {
    const source = [
      "import { BlurView } from 'expo-blur';",
      '<BlurView intensity={40} />',
      "const a = { backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)' };",
      '<Image blurRadius={22} /> <Image blurRadius={0} />',
      '<Glass variant="regular" /> <Glass solid radius={8} />',
      "const t = { color: 'rgba(255,255,255,0.7)', borderColor: 'rgba(255,255,255,0.2)' };",
      "const u = { color: '#FFFFFFB3' }; const v = { color: '#C0C0C0' };",
      '// <BlurView /> in a comment does not count',
    ].join('\n');
    const counts = scanSource(source);
    expect(counts.blur).toBe(4);
    expect(counts.glass).toBe(1);
    expect(counts.fadedText).toBe(2);
  });

  it('counts sub-pixel edges, react-native images, soft shadows and faded disabled states', () => {
    const source = [
      "import { Image, View } from 'react-native';",
      '<Image source={a} /> <Image source={b} />',
      'const s = { borderWidth: 0.5, borderTopWidth: StyleSheet.hairlineWidth, borderRadius: 10.5, fontSize: 13.5 };',
      'const sh = { shadowRadius: 24, elevation: 12 }; const ok = { shadowRadius: 2, elevation: 2 };',
      'const d = [styles.btn, disabled && { opacity: 0.4 }];',
      "const w = { willChange: 'transform' };",
    ].join('\n');
    const counts = scanSource(source);
    expect(counts).toMatchObject({ rnImage: 2, hairline: 1, fractionalRadius: 1, fractionalFont: 1, smearShadow: 2, disabledOpacity: 1, willChange: 1 });
  });

  it('does not count Image.getSize-only imports or expo-image', () => {
    expect(scanSource("import { Image } from 'react-native';\nImage.getSize(uri, cb);").rnImage).toBe(0);
    expect(scanSource("import { Image } from 'expo-image';\n<Image source={a} />").rnImage).toBe(0);
  });

  it('allows a file up to baseline + allow-list, and flags anything above', () => {
    const allow = { 'glass.tsx': { blur: { count: 1, reason: 'floating control' } } };
    expect(findViolations({ 'glass.tsx': { blur: 1 } }, {}, allow)).toEqual([]);
    expect(findViolations({ 'glass.tsx': { blur: 2 } }, {}, allow)).toHaveLength(1);
    expect(findViolations({ 'new.tsx': { fadedText: 1 } }, {}, {})).toEqual([{ file: 'new.tsx', rule: 'fadedText', count: 1, allowed: 0 }]);
    expect(baselineFrom({ 'glass.tsx': { blur: 3 } }, allow)).toEqual({ 'glass.tsx': { blur: 2 } });
  });

  it('every allow-list entry carries a reason', () => {
    for (const rules of Object.values(readAllowlist())) {
      for (const entry of Object.values(rules as Record<string, { count: number; reason: string }>)) {
        expect(entry.count).toBeGreaterThan(0);
        expect(entry.reason.length).toBeGreaterThan(10);
      }
    }
  });

  it('finds nothing new in the app source', () => {
    expect(findViolations(scanTree(), readBaseline(), readAllowlist())).toEqual([]);
  });
});

describe('crisp crawl route map', () => {
  it('maps app/ files to routes the way expo-router does', () => {
    expect(routeForFile('index.tsx')).toBe('/');
    expect(routeForFile('(tabs)/index.tsx')).toBe('/(tabs)');
    expect(routeForFile('(buyer)/inbox.tsx')).toBe('/(buyer)/inbox');
    expect(routeForFile('store/product/[productId].tsx')).toBe('/store/product/prod_nl_jacket_rust');
    expect(routeForFile('_layout.tsx')).toBeNull();
    expect(routeForFile('+not-found.tsx')).toBeNull();
    expect(slugForRoute('/(buyer)/inbox')).toBe('buyer_inbox');
  });
});
