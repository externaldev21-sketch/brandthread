import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('root Stack registration', () => {
  it('registers every screen name exactly once', () => {
    const source = readFileSync(resolve(__dirname, '../app/_layout.tsx'), 'utf8');
    const names = [...source.matchAll(/<Stack\.Screen\b[^>]*\bname="([^"]+)"/g)]
      .map(match => match[1]);
    expect(names.length).toBeGreaterThan(0);
    const duplicates = names.filter((name, index) => names.indexOf(name) !== index);
    expect(duplicates).toEqual([]);
    expect(names).toContain('analytics-reports');
  });
});
