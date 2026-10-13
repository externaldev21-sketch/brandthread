import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const metadata = fs.readFileSync(path.join(repoRoot, 'docs/launch/app-store-metadata.md'), 'utf8');
const kit = fs.readFileSync(path.join(repoRoot, 'docs/launch/store-listing-kit.md'), 'utf8');

/** Characters as the stores count them (Unicode code points, not UTF-16 units). */
const count = (text: string) => [...text].length;

function tableValue(label: string): string {
  const line = metadata.split('\n').find((l) => l.startsWith(`| ${label}`));
  if (!line) throw new Error(`Row "${label}" missing from app-store-metadata.md`);
  const cells = line.split('|').map((c) => c.trim());
  return cells[2].replace(/^\*\*(.*)\*\*$/, '$1').replace(/^"(.*)"$/, '$1').replace(/^`(.*)`$/, '$1');
}

function blockquoteAfter(heading: string): string {
  const section = metadata.split(heading)[1]?.split(/\n## /)[0] ?? '';
  return section
    .split('\n')
    .filter((l) => l.startsWith('>'))
    .map((l) => l.replace(/^> ?/, '').replace(/\*\*/g, ''))
    .join('\n')
    .trim();
}

function fencedAfter(heading: string): string {
  const section = kit.split(heading)[1]?.split(/\n## /)[0] ?? '';
  return section.match(/```\n([\s\S]*?)\n```/)?.[1].trim() ?? '';
}

describe('store listing copy stays inside store limits', () => {
  it('iOS app name, subtitle, promotional text and keywords', () => {
    expect(count(tableValue('App name'))).toBeLessThanOrEqual(30);
    expect(count(tableValue('Subtitle'))).toBeLessThanOrEqual(30);
    expect(count(tableValue('Promotional text'))).toBeLessThanOrEqual(170);
    const keywords = tableValue('Keywords');
    expect(count(keywords)).toBeLessThanOrEqual(100);
    expect(keywords).not.toMatch(/,\s|\s,/); // spaces after commas waste the 100 characters
    expect(keywords.toLowerCase()).not.toContain('brandthread'); // the app name is indexed already
  });

  it('Google Play short description (80) and the shared long description (4000)', () => {
    expect(count(tableValue('Short description'))).toBeLessThanOrEqual(80);
    const description = blockquoteAfter('## Description (long form, both stores)');
    expect(count(description)).toBeGreaterThan(200);
    expect(count(description)).toBeLessThanOrEqual(4000);
  });

  it('release notes: App Store (4000) and Google Play (500)', () => {
    const ios = fencedAfter('## Release notes, 1.0.0 (App Store)');
    const play = fencedAfter('## Release notes, 1.0.0 (Google Play)');
    expect(count(ios)).toBeGreaterThan(0);
    expect(count(ios)).toBeLessThanOrEqual(4000);
    expect(count(play)).toBeGreaterThan(0);
    expect(count(play)).toBeLessThanOrEqual(500);
  });

  it('keeps the verified count table in the kit in sync with the copy', () => {
    const expected: Array<[string, number]> = [
      ['App name', count(tableValue('App name'))],
      ['Subtitle', count(tableValue('Subtitle'))],
      ['Promotional text', count(tableValue('Promotional text'))],
      ['Keywords', count(tableValue('Keywords'))],
      ['Short description', count(tableValue('Short description'))],
      ['Long description', count(blockquoteAfter('## Description (long form, both stores)'))],
    ];
    for (const [field, used] of expected) {
      const row = kit.split('\n').find((l) => l.startsWith(`| ${field} `));
      expect(row, `${field} row in store-listing-kit.md`).toBeDefined();
      expect(row).toMatch(new RegExp(`\\|\\s*${used}\\s*\\|`));
    }
  });
});

describe('store.config.json (EAS Metadata) matches the listing doc', () => {
  const config = JSON.parse(fs.readFileSync(path.join(repoRoot, 'artifacts/mobile/store.config.json'), 'utf8'));
  const info = config.apple.info['en-US'];

  it('uses the same name, subtitle, promotional text, keywords and description', () => {
    expect(info.title).toBe(tableValue('App name'));
    expect(info.subtitle).toBe(tableValue('Subtitle'));
    expect(info.promoText).toBe(tableValue('Promotional text'));
    expect(info.keywords.join(',')).toBe(tableValue('Keywords'));
    expect(info.description).toBe(blockquoteAfter('## Description (long form, both stores)'));
  });

  it('targets the launch search terms without wasting characters', () => {
    const keywords: string[] = info.keywords;
    expect(keywords).toEqual(expect.arrayContaining(['clothing brand', 'drops']));
    expect(keywords.join(',').length).toBeLessThanOrEqual(100);
    expect(new Set(keywords).size).toBe(keywords.length);
    // Words in the name/subtitle are already indexed by Apple.
    const indexed = `${info.title} ${info.subtitle}`.toLowerCase();
    for (const k of keywords) expect(indexed.includes(k)).toBe(false);
    expect(indexed).toContain('streetwear');
  });
});
