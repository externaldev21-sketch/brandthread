import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
const compatibilityGuide = readFileSync(
  new URL('../docs/expo-go-animation-compatibility.md', import.meta.url),
  'utf8',
);

describe('Expo Go SDK 57 animation compatibility', () => {
  it('keeps the animation libraries on the same documented compatibility pair', () => {
    expect(dependencies['react-native-reanimated']).toBe('4.5.1');
    expect(dependencies['react-native-worklets']).toBe('0.10.1');
    expect(dependencies.expo).toMatch(/^~57\./);
  });

  it('validates the animation pair instead of excluding it from SDK checks', () => {
    const excluded = packageJson.expo.install?.exclude ?? [];
    expect(excluded).not.toContain('react-native-reanimated');
    expect(excluded).not.toContain('react-native-worklets');
  });

  it('records upstream evidence and requires a native cold launch to verify the phone', () => {
    expect(compatibilityGuide).toContain('https://github.com/expo/expo/issues/48390');
    expect(compatibilityGuide).toContain('successful cold launch');
    expect(compatibilityGuide).toContain('not proof');
  });
});