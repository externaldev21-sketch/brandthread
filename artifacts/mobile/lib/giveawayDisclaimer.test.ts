import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PLATFORM_SPONSOR_DISCLAIMER } from './giveawayDisclaimer';

describe('giveaway sponsor disclaimer (QA-0100)', () => {
  it('names Apple and Google as not sponsors', () => {
    expect(PLATFORM_SPONSOR_DISCLAIMER).toMatch(/Apple Inc\. and Google LLC are not sponsors/);
  });
  it('matches the wording the server appends to the official rules', () => {
    const server = readFileSync(path.resolve(__dirname, '../../api-server/src/lib/giveaways.ts'), 'utf8');
    expect(server).toContain(PLATFORM_SPONSOR_DISCLAIMER);
  });
  it('is shown on the buyer giveaway screen', () => {
    const screen = readFileSync(path.resolve(__dirname, '../app/giveaway.tsx'), 'utf8');
    expect(screen).toContain('{PLATFORM_SPONSOR_DISCLAIMER}');
  });
});
