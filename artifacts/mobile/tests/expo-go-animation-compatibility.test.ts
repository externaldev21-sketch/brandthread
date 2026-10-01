import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
const compatibilityGuide = readFileSync(
  new URL('../docs/expo-go-animation-compatibility.md', import.meta.url),
  'utf8',
);

describe('Expo Go SDK 57 animation compatibility workaround', () => {
  it('keeps the animation libraries on the same documented compatibility pair', () => {
    expect(dependencies['react-native-reanimated']).toBe('4.5.0');
    expect(dependencies['react-native-worklets']).toBe('0.10.0');
    expect(dependencies.expo).toMatch(/^~57\./);
  });

  it('limits the deliberate Expo dependency-check exceptions to the animation pair', () => {
    expect([...packageJson.expo.install.exclude].sort()).toEqual([
      'react-native-reanimated',
      'react-native-worklets',
    ]);
  });

  it('records the upstream evidence and requires a native cold launch before retiring the workaround', () => {
    expect(compatibilityGuide).toContain('https://github.com/expo/expo/issues/48390');
    expect(compatibilityGuide).toContain('successful cold launch');
    expect(compatibilityGuide).toContain('not proof');
  });
});