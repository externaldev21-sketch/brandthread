/**
 * Ratchet lint banning "coming soon" wording from the app's copy.
 *
 * Dev's rule: empty/placeholder states must be factual ("No store visits
 * yet, we'll show traffic once visitors browse"), never a vague promise
 * ("Store insights are on the way", "coming soon", "stay tuned"). Bare
 * "soon" is banned too (it's the same promise in fewer words), except the
 * "as soon as X happens" idiom, which is a real temporal conjunction with a
 * completely different meaning and is stripped before matching.
 *
 * Enforced via a shrinking allowlist rather than a hard cutover — the app
 * currently has pre-existing "check back soon"/"Soon" badge copy in a few
 * places outside this change's scope, being replaced in small batches. A
 * file already in the allowlist is still allowed to use the banned wording
 * (no new failure), but the allowlist can only ever get SMALLER — remove a
 * file from it the moment its copy is made factual, and add a file to it
 * only in the same change that adds the file itself.
 * `pnpm vitest run tests/no-coming-soon-lint.test.ts -t stale` fails the
 * moment an entry no longer needs to be there, so a batch that finishes a
 * file gets told exactly which line to delete.
 *
 * A file NOT in the allowlist below and NOT satisfying the rule fails
 * immediately — that's the real enforcement: brand-new "coming soon" copy
 * is caught right away rather than waiting for manual review to notice.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';

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

const BANNED_PHRASE_RE = /\b(coming soon|on the way|stay tuned)\b/i;

function hasBannedWording(source: string): boolean {
  // Check copy, not identifiers such as the real expiring-credit `soon`
  // variable. Parsing also avoids treating "//" inside a URL as a comment.
  const tree = ts.createSourceFile('copy.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const copy: string[] = [];
  function visit(node: ts.Node) {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      if (!ts.isImportDeclaration(node.parent) && !ts.isExportDeclaration(node.parent) && !ts.isLiteralTypeNode(node.parent)
        && !/^(?:https?:|\/|@\/)/.test(node.text)) copy.push(node.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  const stripped = copy.join('\n')
    // "as soon as X" is a real temporal conjunction ("as soon as it loads"),
    // not a coming-soon promise — strip it before the bare-"soon" check.
    .replace(/as soon as/gi, '');
  if (BANNED_PHRASE_RE.test(stripped)) return true;
  // Expiration warnings and scheduled drops describe real dated events,
  // not unimplemented features. A bare "soon" in other copy is still banned.
  return /\bsoon\b/i.test(stripped
    .replace(/\b(?:expires|expiring|drops)\s+soon\b/gi, ''));
}

// Generated from the state of the tree when this lint was added. Rewrite the
// copy to be factual (what's true right now, not a promise about later),
// then delete the file's line here in the same change.
const COMING_SOON_ALLOWLIST = new Set([
  'components/inbox/MessagesInbox.tsx',
  'app/(tabs)/feed.tsx',
  'app/(tabs)/following.tsx',
  'app/buyer-drop-detail.tsx',
  'app/buyer-report.tsx',
  'app/buyer-settings.tsx',
  'app/manufacturer-messages.tsx',
  'app/quote-detail.tsx',
  'app/seller-settings.tsx',
  'components/ShopProductSheet.tsx',
  'components/onboarding/BrandsToFollowStep.tsx',
  'components/settings/SettingsKit.tsx',
  'lib/financeSummary.ts',
  'lib/previewNotes.ts',
]);

describe('no "coming soon" wording outside the tracked allowlist', () => {
  const sourceFiles = ['app', 'components', 'contexts', 'hooks', 'constants', 'lib', 'services']
    .map((dir) => path.join(ROOT, dir))
    .filter((dir) => statSync(dir, { throwIfNoEntry: false })?.isDirectory())
    .flatMap((dir) => walk(dir))
    .map(rel);

  it('flags every file with new coming-soon wording not already tracked', () => {
    const offenders = sourceFiles.filter((file) => hasBannedWording(readFileSync(path.join(ROOT, file), 'utf8')));
    const newOffenders = offenders.filter((file) => !COMING_SOON_ALLOWLIST.has(file));

    expect(newOffenders).toEqual([]);
  // This parses every application source file with TypeScript, rather than
  // matching raw text. Bound the complete-tree audit separately from UI tests.
  }, 20_000);

  it('stale: every allowlisted file still needs to be there', () => {
    const stale = [...COMING_SOON_ALLOWLIST].filter((file) => {
      if (!sourceFiles.includes(file)) return true; // deleted/moved
      return !hasBannedWording(readFileSync(path.join(ROOT, file), 'utf8'));
    });

    expect(stale).toEqual([]);
  });
});
