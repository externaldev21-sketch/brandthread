import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
const require = createRequire(import.meta.url);
const config = require('../babel.config.js');
const app = require('../app.json').expo;
const { transformSync } = require('@babel/core');
const preset = require.resolve('babel-preset-expo', { paths: [path.dirname(require.resolve('expo/package.json'))] });
function babel(platform: string, isDev: boolean) {
  return config({ caller: (fn: (c: unknown) => unknown) => fn({ platform, isDev }) });
}
describe('production optimization configuration', () => {
  it.each(['ios', 'android', 'web'])('strips production debug logs on %s but preserves errors and warnings', platform => {
    expect(babel(platform, false).plugins).toContainEqual(['transform-remove-console', { exclude: ['error', 'warn'] }]);
    expect(babel(platform, true).plugins).toEqual([]);
  });
  it('keeps the Expo compiler enabled and ProMotion unthrottled', () => {
    expect(app.experiments.reactCompiler).toBe(true);
    expect(app.jsEngine ?? 'hermes').toBe('hermes');
    expect(app.ios.infoPlist.CADisableMinimumFrameDurationOnPhone).toBe(true);
  });
  it.each(['ios', 'android', 'web'])('actually compiles memo caches and removes debug calls on %s', platform => {
    const settings = babel(platform, false);
    // The same Expo preset/override and caller contract used by Metro.
    const resolvePresets = (entries: [string, object][]) =>
      entries.map(([name, options]) => [name === 'babel-preset-expo' ? preset : name, options]);
    const result = transformSync(
      'import React from "react"; export function Probe({ label }) { return <View>{label}</View>; } console.log("debug"); console.warn("diagnostic");',
      {
        ...settings,
        presets: resolvePresets(settings.presets),
        overrides: settings.overrides.map((entry: { presets: [string, object][] }) => ({
          ...entry, presets: resolvePresets(entry.presets),
        })),
        configFile: false, babelrc: false,
        filename: path.resolve('components/PerformanceCompilerProbe.tsx'),
        caller: { name: 'metro', platform, isDev: false, supportsReactCompiler: true },
      },
    ).code;
    expect(result).toContain('compiler-runtime');
    expect(result).not.toContain('console.log');
    expect(result).toContain('console.warn');
  });
});
