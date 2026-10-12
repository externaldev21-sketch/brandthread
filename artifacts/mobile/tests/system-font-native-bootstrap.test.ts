import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';

// Reproduce the dependency graph emitted by iOS Metro: systemFont's RN import
// resolves back to the app shim, not the already-initialized native package.
function bootstrap() {
  const nativeText = () => null;
  const nativeInput = Object.assign(() => null, { State: { focusTextInput: () => undefined } });
  const timing = () => undefined;
  const native = {
    Platform: { OS: 'ios', select: (values: Record<string, unknown>) => values.ios ?? values.default },
    StyleSheet: { flatten: (style: unknown) => Array.isArray(style)
      ? Object.assign({}, ...style.flat(Infinity).filter(Boolean)) : style },
    Text: nativeText,
    TextInput: nativeInput,
    Animated: { timing, createAnimatedComponent: (component: unknown) => component },
  };
  const react = {
    forwardRef: (render: (...args: any[]) => unknown) => ({ render }),
    createElement: (type: unknown, props: unknown) => ({ type, props }),
  };
  const sources: Record<string, string> = {
    shim: readFileSync(new URL('../shims/react-native.js', import.meta.url), 'utf8'),
    helper: readFileSync(new URL('../shims/systemFontComponent.js', import.meta.url), 'utf8'),
    font: ts.transpileModule(
      readFileSync(new URL('../lib/systemFont.ts', import.meta.url), 'utf8'),
      { compilerOptions: { module: ts.ModuleKind.CommonJS } },
    ).outputText,
  };
  const cache = new Map<string, { exports: any }>();
  function load(name: string): any {
    if (cache.has(name)) return cache.get(name)!.exports;
    const module = { exports: {} };
    cache.set(name, module);
    const require = (dependency: string) => {
      if (dependency === 'react') return react;
      if (dependency === 'react-native') return name === 'shim' ? native : load('shim');
      if (dependency === './systemFontComponent') return load('helper');
      if (dependency === '../lib/systemFont') return load('font');
      throw new Error(`Unexpected bootstrap dependency: ${dependency}`);
    };
    vm.runInNewContext(sources[name], { module, exports: module.exports, require }, { filename: name });
    return module.exports;
  }
  return { load, cache, native };
}

describe('native system-font bootstrap', () => {
  it('publishes Platform before loading the circular font helper', () => {
    const { load, cache, native } = bootstrap();
    const shim = load('shim');
    expect(shim.Platform).toBe(native.Platform);
    expect(cache.has('helper')).toBe(false);
    expect(cache.has('font')).toBe(false);
    expect(() => shim.Text).not.toThrow();
    expect(load('font').SYSTEM_FONT).toBe('System');
  });

  it('keeps native text weights, props, refs and TextInput statics', () => {
    const { load, native } = bootstrap();
    const shim = load('shim');
    const ref = {};
    const rendered = shim.Text.render({ style: { fontFamily: 'Inter_700Bold' }, children: 'Hello' }, ref);
    expect(rendered.type).toBe(native.Text);
    expect(rendered.props.ref).toBe(ref);
    expect(rendered.props.children).toBe('Hello');
    expect(rendered.props.style[1]).toEqual({ fontFamily: 'System', fontWeight: '700' });
    expect(shim.TextInput.State).toBe(native.TextInput.State);
  });

  it('leaves animation functions untouched and wraps Animated.Text lazily', () => {
    const { load, cache, native } = bootstrap();
    const shim = load('shim');
    expect(shim.Animated.timing).toBe(native.Animated.timing);
    expect(cache.has('font')).toBe(false);
    expect(shim.Animated.Text).toBe(shim.Text);
  });
});
