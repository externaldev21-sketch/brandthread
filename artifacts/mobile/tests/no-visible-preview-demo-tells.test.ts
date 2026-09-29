/**
 * Regression test: no user-visible string may reveal that a screen is
 * running in the dev/demo preview bypass (?bt_preview=seller|buyer, with or
 * without &demo=1). Preview mode must remain fully detectable in CODE via
 * isSellerDevPreview()/isBuyerDevPreview()/isPreviewFreshMode()/
 * isPreviewDemoMode() — this test only guards what a real person (or a
 * screen reader) would actually see or hear.
 *
 * Scope and exclusions (read before adding to the allowlist below): this
 * repo has a lot of *legitimate* product features that are also named
 * "preview" and are shown to every real user, unrelated to the dev/demo
 * bypass — e.g. "Product Preview" (a seller previewing their own listing as
 * buyers see it), "Storefront preview", "Design preview", "Mockup preview",
 * "Version Preview", "Camera preview", the "Preview posts" bundled filler
 * content in the buyer feed (shown in production, not gated by
 * isBuyerDevPreview()). Flagging every occurrence of the word "preview"
 * would make this test useless noise, so it targets specifically: (a) any
 * Alert/Text whose surrounding code is gated by
 * isSellerDevPreview()/isBuyerDevPreview() (i.e. can ONLY ever render inside
 * the dev bypass) and (b) two known-fixed strings, so a regression on either
 * is caught immediately.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

const MOBILE_ROOT = path.resolve(__dirname, '..');
function read(relPath: string): string {
  return readFileSync(path.join(MOBILE_ROOT, relPath), 'utf8');
}

function walk(dir: string, onFile: (full: string, src: string) => void) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { walk(full, onFile); continue; }
    if (!/\.tsx?$/.test(entry.name) || entry.name.endsWith('.test.tsx') || entry.name.endsWith('.test.ts')) continue;
    onFile(full, readFileSync(full, 'utf8'));
  }
}

describe('no visible preview/demo tells in the dev preview bypass', () => {
  it('checkout no longer shows a "Preview order" note', () => {
    const src = read('components/checkout/PaymentSection.tsx');
    expect(src.toLowerCase()).not.toContain('preview order');
  });

  it('boost checkout no longer shows a "Preview mode" alert', () => {
    const src = read('app/boost.tsx');
    expect(src).not.toContain("'Preview mode'");
  });

  it('ad campaign checkout no longer shows a "Preview mode" alert', () => {
    const src = read('app/design-campaign.tsx');
    expect(src).not.toContain("'Preview mode'");
  });

  it('no file gated by isSellerDevPreview()/isBuyerDevPreview() contains an Alert.alert title mentioning preview/demo', () => {
    const offenders: string[] = [];
    walk(path.join(MOBILE_ROOT, 'app'), (full, src) => {
      if (!src.includes('isSellerDevPreview(') && !src.includes('isBuyerDevPreview(')) return;
      // Alert.alert('Title', ...) — first string literal argument.
      const alertRe = /Alert\.alert\(\s*['"]([^'"]*)['"]/g;
      let m: RegExpExecArray | null;
      while ((m = alertRe.exec(src))) {
        if (/\b(preview|demo)\b/i.test(m[1])) {
          offenders.push(`${path.relative(MOBILE_ROOT, full)}: Alert.alert('${m[1]}', ...)`);
        }
      }
    });
    expect(offenders).toEqual([]);
  });

  it('the exact strings Dev flagged ("Demo seller · Preview session", "Design preview · no account") are not present anywhere in mobile source', () => {
    // These exact phrases were searched for across app/, lib/, components/,
    // services/, this session's own branch, origin/dev, and every other
    // open remote branch reachable from this sandbox — none contain them.
    // This test exists so that if either string is ever (re)introduced by a
    // future change, it fails immediately instead of relying on a repeat of
    // that manual search.
    const searchDirs = ['app', 'lib', 'components', 'services'].map((d) => path.join(MOBILE_ROOT, d));
    const needles = ['Demo seller · Preview session', 'Design preview · no account'];
    const hits: string[] = [];
    for (const dir of searchDirs) {
      walk(dir, (full, src) => {
        for (const needle of needles) {
          if (src.includes(needle)) hits.push(`${path.relative(MOBILE_ROOT, full)} contains "${needle}"`);
        }
      });
    }
    expect(hits).toEqual([]);
  });
});
