/**
 * Regression guard for the amber "Read-only preview..." banner reported on
 * /payouts: repeated investigation found no such text anywhere in this
 * area's source, but the report was specific and repeated, so this locks
 * the absence in rather than trusting a one-off manual re-read. Scans every
 * quoted string literal (not identifiers, not comments, not import paths)
 * in the Payouts screen and Thread Cash components for preview/demo/
 * read-only wording — the same class of leak `scripts/audit/half-done-audit.mjs`
 * already watches for app-wide.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..');

const FILES = [
  'app/payouts.tsx',
  'app/thread-cash-history.tsx',
  'components/thread-cash/SellerThreadCashCard.tsx',
  'components/thread-cash/CashOutSheet.tsx',
  'components/StripeConnectWarning.tsx',
  'components/RoleLockedView.tsx',
];

const BANNED = /\bpreview\b|\bdemo\b|read-only|read only/i;

function stringLiterals(source: string): string[] {
  const out: string[] = [];
  const re = /'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    const value = m[1] ?? m[2] ?? m[3] ?? '';
    if (value.startsWith('@/') || value.startsWith('./') || value.startsWith('../')) continue; // module paths
    out.push(value);
  }
  return out;
}

describe('Payouts / Thread Cash: no preview-demo-read-only wording in user-facing strings', () => {
  for (const file of FILES) {
    it(`${file} has no preview-mode leakage in string literals`, () => {
      const source = readFileSync(resolve(ROOT, file), 'utf8');
      const offenders = stringLiterals(source).filter((s) => BANNED.test(s));
      expect(offenders).toEqual([]);
    });
  }
});
