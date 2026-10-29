/**
 * Ratchet lint for typography drift (Dev, on Customers: "the sizing and
 * wording of fonts [should] match on all the pages").
 *
 * Every text style in app/ and components/ sits on the house type scale in
 * lib/theme.ts:
 *  - weight comes from the FONT tokens (`fontFamily: FONT.semibold`), never a
 *    raw `fontWeight` — lib/systemFont.ts maps the FONT token to the right
 *    face and weight, and a bare numeric weight renders inconsistently;
 *  - a literal `fontSize` is one of the scale's sizes (FS, plus TEXT's iOS
 *    roles such as callout 16), and never token arithmetic like
 *    `FS.xs + 1`;
 *  - `fontFamily` is a FONT token, never a font-name string ('Inter_600SemiBold',
 *    'Georgia', …).
 *
 * Genuinely intentional exceptions are marked on the line itself with
 * `// type-exempt: <reason>` (hero money figures, countdown digits, a
 * user-chosen story/design font, the Apple/Google Pay mark), so a reviewer
 * sees the reason where the style lives. Whole files that render something
 * other than app chrome, or that other in-flight work owns, sit in the
 * allowlist below — it can only shrink:
 *
 * `pnpm vitest run tests/typography-scale-lint.test.ts -t stale`
 * fails the moment an allowlist entry no longer needs to be there.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FS, TEXT } from '@/lib/theme';

const ROOT = path.resolve(import.meta.dirname, '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.git') continue;
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full, out);
      continue;
    }
    if (/\.(tsx?|jsx?)$/.test(entry) && !entry.includes('.test.')) out.push(full);
  }
  return out;
}

function rel(full: string): string {
  return path.relative(ROOT, full).split(path.sep).join('/');
}

/** Every size the house scale defines: FS tokens plus TEXT's iOS roles. */
export const SCALE_SIZES = new Set<number>([
  ...Object.values(FS),
  ...Object.values(TEXT).map((role) => role.fontSize),
]);

const RAW_WEIGHT = /\bfontWeight\s*[:=]/;
const LITERAL_SIZE = /\bfontSize\s*:\s*(\d+(?:\.\d+)?)(?![\d.])/g;
const TOKEN_ARITHMETIC = /\bfontSize\s*:\s*FS\.\w+\s*[-+*/]/;
// A FONT token with a web fallback stack (`${FONT.regular}, ${EMOJI_FONT_STACK}`) is fine.
const FAMILY_STRING = /\bfontFamily\s*[:=]\s*\{?\s*(?:['"]|`(?!\$\{FONT\.))/;

export function typographyViolations(source: string): string[] {
  const hits: string[] = [];
  source.split('\n').forEach((line, i) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
    if (line.includes('type-exempt:')) return;
    const code = line.replace(/\/\/.*$/, '');
    const at = `${i + 1}: ${trimmed}`;
    if (RAW_WEIGHT.test(code)) hits.push(`raw fontWeight — ${at}`);
    for (const m of code.matchAll(LITERAL_SIZE)) {
      if (!SCALE_SIZES.has(Number(m[1]))) hits.push(`off-scale fontSize ${m[1]} — ${at}`);
    }
    if (TOKEN_ARITHMETIC.test(code)) hits.push(`FS token arithmetic — ${at}`);
    if (FAMILY_STRING.test(code)) hits.push(`font-name string — ${at}`);
  });
  return hits;
}

const TYPOGRAPHY_ALLOWLIST = new Set<string>([
  // Owned by other in-flight sessions; migrate when they land.
  'app/design-canvas.tsx',
  'app/payouts.tsx',
  // Not app chrome: the seller's web store drawn natively (mirrors the
  // api-server page's own type), the exported 9:16 share-card image, the
  // Stripe Elements iframe's CSS appearance config, and a Procreate brush-set
  // glyph (artwork).
  'components/store/StoreSitePreview.tsx',
  'components/share-cards/MilestoneStoryCard.tsx',
  'components/checkout/StripePayment.web.tsx',
  'components/design-studio/BrushSetGlyph.tsx',
]);

describe('typography stays on the house type scale', () => {
  const sourceFiles = ['app', 'components']
    .map((dir) => path.join(ROOT, dir))
    .filter((dir) => statSync(dir, { throwIfNoEntry: false })?.isDirectory())
    .flatMap((dir) => walk(dir))
    .map(rel);

  it('scale includes the FS tokens and TEXT roles', () => {
    expect([...SCALE_SIZES].sort((a, b) => a - b)).toEqual([11, 12, 13, 15, 16, 17, 20, 22, 28, 34]);
  });

  it('detects each class of drift', () => {
    expect(typographyViolations("a: { fontWeight: '600' },")).toHaveLength(1);
    expect(typographyViolations('a: { fontSize: 14 },')).toHaveLength(1);
    expect(typographyViolations('a: { fontSize: FS.xs + 1 },')).toHaveLength(1);
    expect(typographyViolations("a: { fontFamily: 'Inter_600SemiBold' },")).toHaveLength(1);
    expect(typographyViolations('a: { fontSize: 15, fontFamily: FONT.semibold },')).toEqual([]);
    expect(typographyViolations('a: { fontSize: 40 }, // type-exempt: hero figure')).toEqual([]);
  });

  it('flags every file off the type scale not already tracked', () => {
    const offenders = sourceFiles
      .filter((file) => !TYPOGRAPHY_ALLOWLIST.has(file))
      .flatMap((file) => typographyViolations(readFileSync(path.join(ROOT, file), 'utf8')).map((hit) => `${file}:${hit}`));

    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  it('stale: every allowlisted file still needs to be there', () => {
    const stale = [...TYPOGRAPHY_ALLOWLIST].filter((file) => {
      if (!sourceFiles.includes(file)) return true; // deleted/moved
      return typographyViolations(readFileSync(path.join(ROOT, file), 'utf8')).length === 0;
    });

    expect(stale, stale.join('\n')).toEqual([]);
  });
});
