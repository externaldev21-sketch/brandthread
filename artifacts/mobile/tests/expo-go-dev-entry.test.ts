import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const layout = readFileSync(resolve(__dirname, '../app/_layout.tsx'), 'utf8');
const bypass = readFileSync(resolve(__dirname, '../lib/devBypass.ts'), 'utf8');

describe('Expo Go development entry', () => {
  it('renders the native development preview without waiting for ClerkLoaded', () => {
    expect(bypass).toContain("DEV_BYPASS_ROLE: 'buyer' | 'seller' | null = __DEV__ ? 'seller' : null");
    expect(layout).toContain('{PREVIEW_ROLE || DEV_BYPASS_ROLE ? (');
    expect(layout).toContain('<ClerkLoaded>{appTree}</ClerkLoaded>');
  });
});