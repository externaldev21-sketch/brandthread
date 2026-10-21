import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

function harness(ready: boolean) {
  const requires: string[] = [];
  const snapshots: (() => boolean)[] = [];
  const flatten = (style: any): any => Array.isArray(style)
    ? Object.assign({}, ...style.map(flatten)) : style ?? {};
  const react = {
    forwardRef: (render: any) => render,
    createElement: (type: any, props: any) => ({ type, props }),
    useSyncExternalStore: (_subscribe: any, snapshot: () => boolean) => {
      snapshots.push(snapshot);
      return snapshot();
    },
  };
  const module = { exports: {} as { withFontStyle: (base: any, name: string) => any } };
  runInNewContext(readFileSync(resolve(__dirname, '../shims/systemFontComponent.js'), 'utf8'), {
    module,
    require: (id: string) => {
      requires.push(id);
      if (id === 'react') return react;
      if (id === '../lib/systemFont') return { withSystemFont: (s: any) => s };
      if (id === 'react-native') return { StyleSheet: { flatten } };
      if (id === '../lib/iconFonts') return {
        isBundledIconFont: (name: string) => name === 'feather',
        subscribeIconFonts: () => () => {},
        isIconFontReady: () => ready,
        getIconFontServerHidden: () => false,
      };
      throw new Error(`Unexpected import: ${id}`);
    },
  });
  return { ...module.exports, requires, snapshots, flatten };
}

describe('app-wide icon text guard', () => {
  it('starts preloading before Router, without adding unused font families or glyph maps', () => {
    const entry = readFileSync(resolve(__dirname, '../index.ts'), 'utf8');
    expect(entry.indexOf("import './lib/iconFontBootstrap'")).toBeLessThan(entry.indexOf("import 'expo-router/entry'"));
    const assets = readFileSync(resolve(__dirname, '../lib/iconFontAssets.ts'), 'utf8');
    expect(assets.match(/require\(/g)).toHaveLength(6);
    expect(assets).not.toContain('glyphmaps');
    expect(assets).not.toContain('FontAwesome6_Regular.ttf');
    expect(assets).not.toContain('FontAwesome6_Solid.ttf');
  });

  it('emits early local web font preloads and icon-specific block CSS', () => {
    const html = readFileSync(resolve(__dirname, '../app/+html.tsx'), 'utf8');
    expect(html).toContain('Asset.fromModule(source).uri');
    expect(html).toContain('as="font"');
    expect(html).toContain('crossOrigin="anonymous"');
    expect(html).toContain('font-display:block');
    expect(html).not.toContain('fonts.gstatic.com');
  });

  it('keeps font helpers lazy to avoid the native select-of-undefined bootstrap cycle', () => {
    const h = harness(false);
    expect(h.requires).toEqual(['react', '../lib/systemFont']);
  });

  it('makes unready private-use glyphs invisible without altering their size or slot', () => {
    const h = harness(false);
    const Base = () => null;
    const Wrapped = h.withFontStyle(Base, 'Text');
    const ref = {};
    const outer = Wrapped({ style: { fontFamily: 'feather', fontSize: 24, width: 24 }, children: '\uE900' }, ref);
    const inner = outer.type(outer.props, ref);
    expect(inner.type).toBe(Base);
    expect(h.flatten(inner.props.style)).toEqual({ fontFamily: 'feather', fontSize: 24, width: 24, opacity: 0 });
    expect(inner.props.ref).toBe(ref);
  });

  it('restores ready icons with their original styles and forwards statics', () => {
    const h = harness(true);
    const Base = Object.assign(() => null, { State: { focus: true } });
    const Wrapped = h.withFontStyle(Base, 'Text');
    const style = { fontFamily: 'feather', fontSize: 32 };
    const outer = Wrapped({ style, children: '\uE900' }, null);
    const inner = outer.type(outer.props, null);
    expect(inner.props.style).toBe(style);
    expect(Wrapped.State).toBe(Base.State);
  });

  it('guards the glyph-plus-children array emitted by vector-icons', () => {
    const h = harness(false);
    const Wrapped = h.withFontStyle(() => null, 'Text');
    const outer = Wrapped({ style: { fontFamily: 'feather', fontSize: 24 }, children: ['\uE900', undefined] }, null);
    const inner = outer.type(outer.props, null);
    expect(h.flatten(inner.props.style).opacity).toBe(0);
  });

  it('does not subscribe normal UI text to font loading', () => {
    const h = harness(false);
    const Base = () => null;
    const Wrapped = h.withFontStyle(Base, 'Text');
    const style = { fontFamily: 'system-400', fontSize: 16 };
    const result = Wrapped({ style, children: 'Discover' }, null);
    expect(result.type).toBe(Base);
    expect(result.props.style).toBe(style);
    expect(h.snapshots).toHaveLength(0);
    expect(h.requires).not.toContain('../lib/iconFonts');
  });
});
