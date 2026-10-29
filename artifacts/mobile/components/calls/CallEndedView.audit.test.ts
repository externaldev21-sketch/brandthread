import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Source-structure test (last resort): the screen reads three styles that the
// StyleSheet never defined (a tsc error; at runtime the rating buttons lost
// their row layout and stacked vertically).
const src = readFileSync(join(__dirname, 'CallEndedView.tsx'), 'utf8');

describe('CallEndedView styles (audit)', () => {
  it('defines every styles.<key> the screen reads', () => {
    const sheet = src.slice(src.indexOf('StyleSheet.create('));
    const used = [...new Set([...src.matchAll(/styles\.(\w+)/g)].map(m => m[1]))];
    expect(used).toEqual(expect.arrayContaining(['ratingBlock', 'ratingPrompt', 'ratingRow']));
    for (const key of used) expect(sheet).toMatch(new RegExp(`\\b${key}:`));
  });
  it('lays the Good / Not good buttons out in a row', () => {
    expect(src).toMatch(/ratingRow:\s*\{[^}]*flexDirection:\s*'row'/);
  });
});
