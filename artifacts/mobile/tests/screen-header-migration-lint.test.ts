/**
 * Ratchet lint for Dev's whole-app header/notch sweep.
 *
 * Two rules, each enforced via a shrinking allowlist rather than a hard cutover
 * — the 278-route migration onto `components/ScreenHeader` is being done by
 * four sessions in parallel right now, so a hard "every route must use
 * ScreenHeader" assertion today would fail CI for everyone until all four
 * finish. Instead: a file already in the allowlist is still allowed to be
 * unmigrated (no new failure), but the allowlist can only ever get SMALLER —
 * remove a file from it the moment that file starts using ScreenHeader (or,
 * for the Modal rule, starts referencing safe-area insets); add a file to it
 * only if it is added here in the same change that adds the file itself.
 * `pnpm vitest run tests/screen-header-migration-lint.test.ts -t stale` will
 * fail the moment an entry no longer needs to be there, so a session finishing
 * its range gets told exactly which lines to delete.
 *
 * A file NOT in an allowlist below and NOT satisfying the rule fails
 * immediately — that's the real enforcement: a brand-new route/Modal, or a
 * regression in an already-migrated one, is caught right away rather than
 * waiting for a manual review to notice.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';

const ROOT = path.resolve(import.meta.dirname, '..');

const headerCache = new Map<string, boolean>();
/** Follow rendered local frames and default route aliases, not unused imports. */
function usesSharedHeader(full: string, visiting = new Set<string>()): boolean {
  if (headerCache.has(full)) return headerCache.get(full)!;
  if (visiting.has(full)) return false;
  visiting.add(full);
  const source = readFileSync(full, 'utf8');
  const tree = ts.createSourceFile(full, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const rendered = new Set<string>();
  function visit(node: ts.Node) {
    // A header inside a dialog is not the route's page header.
    if (ts.isJsxElement(node) && /^(Modal|BottomSheet)$|(?:Sheet|Dialog|Overlay)$/.test(node.openingElement.tagName.getText(tree))) return;
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) rendered.add(node.tagName.getText(tree));
    ts.forEachChild(node, visit);
  }
  visit(tree);
  let result = source.includes('ScreenHeader');
  for (const node of tree.statements) {
    if (result) break;
    let specifier: string | undefined;
    let used = false;
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      specifier = node.moduleSpecifier.text;
      const clause = node.importClause;
      if (specifier === '@/components/layout' || specifier === '@/components/layout/Header') {
        if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)
          && clause.namedBindings.elements.some(binding => (binding.propertyName ?? binding.name).text === 'Header' && rendered.has(binding.name.text))) {
          result = true;
          break;
        }
      }
      const isPageFrame = (name: string) => /(?:Frame|Screen|Page|Route)$/.test(name);
      used = !!clause?.name && rendered.has(clause.name.text) && isPageFrame(clause.name.text);
      if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        used ||= clause.namedBindings.elements.some(binding => !binding.isTypeOnly && rendered.has(binding.name.text) && isPageFrame(binding.name.text));
      }
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      specifier = node.moduleSpecifier.text;
      used = !!node.exportClause && ts.isNamedExports(node.exportClause)
        && node.exportClause.elements.some(binding => binding.name.text === 'default');
    }
    if (!used || !specifier || (!specifier.startsWith('.') && !specifier.startsWith('@/'))) continue;
    const base = specifier.startsWith('@/') ? path.join(ROOT, specifier.slice(2)) : path.resolve(path.dirname(full), specifier);
    const dependency = [base + '.tsx', base + '.ts', path.join(base, 'index.tsx'), path.join(base, 'index.ts')]
      .find(candidate => existsSync(candidate));
    if (dependency) result = usesSharedHeader(dependency, visiting);
  }
  visiting.delete(full);
  headerCache.set(full, result);
  return result;
}

function isRedirectOnly(source: string): boolean {
  return /<Redirect\b/.test(source) || /router\.(replace|push)\(/.test(source)
    && (!/<[A-Z][A-Za-z0-9]*(?:\s|\/?>)/.test(source)
      || /return\s+<View\b[^;]*\/>;\s*}/.test(source));
}

function walk(dir: string, filter: (full: string, entry: string) => boolean, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (entry === 'node_modules') continue;
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full, filter, out);
      continue;
    }
    if (filter(full, entry)) out.push(full);
  }
  return out;
}

function rel(full: string): string {
  return path.relative(ROOT, full).split(path.sep).join('/');
}

// ─── Rule 1: every app/ route uses ScreenHeader (or is still migrating) ───────

// Generated from the state of `app/` when this test was added (211 of 274
// route files). Sessions 01AaWLh1 (a-b), 01DgPbif (c-l), 01Lbcp8K (m-r),
// 01Cdzzzi (s-v) are migrating these onto ScreenHeader — delete a file's line
// here in the same change that migrates it.
const SCREENHEADER_MIGRATION_ALLOWLIST = new Set([
  'app/(buyer)/discover-feed.tsx',
  'app/(buyer)/discover.tsx',
  'app/(buyer)/feed.tsx',
  'app/(buyer)/inbox.tsx',
  'app/(buyer)/index.tsx',
  'app/(buyer)/profile.tsx',
  'app/(tabs)/feed.tsx',
  'app/(tabs)/index.tsx',
  'app/(tabs)/more.tsx',
  'app/(tabs)/products.tsx',
  'app/(tabs)/profile.tsx',
  'app/account-type.tsx',
  'app/add-product.tsx',
  'app/automation.tsx', // redirect-only route
  // Renders the shared components/chat/ConversationThread.tsx (own chat header).
  'app/buyer-conversation.tsx',
  'app/buyer-live.tsx',
  'app/buyer-product-detail.tsx',
  'app/buyer-story-create.tsx',
  'app/buyer-story-viewer.tsx',
  'app/story-mention-viewer.tsx',
  'app/c/[collectionId].tsx',
  'app/call-screen.tsx',
  'app/camera-capture.tsx',
  'app/community-guidelines.tsx',
  'app/design-canvas.tsx',
  // Editor chrome copied from Linktree's design editor: back, undo/redo, Cancel + Save.
  'app/store-design.tsx',
  'app/forgot-password.tsx',
  'app/live-feed.tsx',
  'app/live.tsx',
  'app/manufacturer.tsx',
  'app/onboarding.tsx',
  'app/privacy.tsx',
  'app/refund-policy.tsx',
  'app/seller-agreement.tsx',
  'app/product-editor.tsx',
  'app/profile-videos.tsx',
  'app/seller-conversation.tsx',
  // Renders the shared components/inbox/MessagesInbox.tsx (TabPageHeader, like (buyer)/inbox).
  'app/seller-inbox.tsx',
  'app/seller-live.tsx',
  'app/seller-profile.tsx',
  'app/settings.tsx',
  'app/sign-in.tsx',
  'app/splash.tsx',
  'app/store-generating.tsx',
  'app/store-preview.tsx',
  'app/terms.tsx',
  'app/thread-explainer.tsx',
  'app/thread-product-detail.tsx',
]);

function isRouteFile(full: string, entry: string): boolean {
  if (!full.includes(`${path.sep}app${path.sep}`) && !full.startsWith(path.join(ROOT, 'app') + path.sep)) return false;
  if (!/\.tsx$/.test(entry)) return false;
  if (entry === '_layout.tsx' || entry.startsWith('+') || entry.endsWith('.test.tsx')) return false;
  // Out of scope — a separate effort owns the checkout/address flow (see
  // screen-fit-safe-area.test.tsx's own exclusion, and e2e/notch-crawl.spec.ts's
  // matching one). Its own doc comment happens to mention "ScreenHeader" in
  // prose, which would otherwise false-positive this file as migrated.
  if (entry === 'buyer-checkout.tsx') return false;
  return true;
}

// ─── Rule 2: every <Modal> respects safe-area insets (or is still migrating) ──

// Generated the same way — files rendering a react-native `<Modal` that don't
// yet reference useSafeAreaInsets/useHeaderTopInset/SafeAreaView anywhere.
const MODAL_INSETS_ALLOWLIST = new Set([
  'app/(tabs)/profile.tsx',
  'app/help.tsx',
  'components/PlanUpsellModal.tsx',
  'components/ProductReviewsSection.tsx',
  'components/SellerTutorialOverlay.tsx',
  'components/SetupCelebration.tsx',
  'components/buyer-feed/LongPressMenu.tsx',
  'components/chat/ThemePickerSheet.tsx',
  'components/discover/DiscoverSafetyMenu.tsx',
  'components/motion/SheetRise.tsx',
  'components/settings/SettingsKit.tsx',
  'components/thread-cash/ChatAttachThreadCash.tsx',
]);

function isSourceFile(full: string, entry: string): boolean {
  if (!/\.tsx?$/.test(entry)) return false;
  if (entry.endsWith('.test.tsx') || entry.endsWith('.test.ts')) return false;
  return full.includes(`${path.sep}app${path.sep}`) || full.includes(`${path.sep}components${path.sep}`)
    || full.startsWith(path.join(ROOT, 'app') + path.sep) || full.startsWith(path.join(ROOT, 'components') + path.sep);
}

describe('every app/ route renders its title through the shared ScreenHeader', () => {
  const routeFiles = [...walk(path.join(ROOT, 'app'), isRouteFile)].map(rel).sort();

  it('a route not using ScreenHeader is on the migration allowlist', () => {
    const offenders: string[] = [];
    for (const full of routeFiles.map((r) => path.join(ROOT, r))) {
      const r = rel(full);
      const source = readFileSync(full, 'utf8');
      if (usesSharedHeader(full) || isRedirectOnly(source)) continue;
      if (!SCREENHEADER_MIGRATION_ALLOWLIST.has(r)) offenders.push(r);
    }
    expect(offenders, 'new/regressed route(s) not using ScreenHeader and not on the migration allowlist').toEqual([]);
  });

  it('stale: every allowlisted route still needs to be there', () => {
    const stale: string[] = [];
    for (const r of SCREENHEADER_MIGRATION_ALLOWLIST) {
      const full = path.join(ROOT, r);
      if (!existsSync(full)) { stale.push(`${r} (file no longer exists — delete this line)`); continue; }
      const source = readFileSync(full, 'utf8');
      if (usesSharedHeader(full) || isRedirectOnly(source)) stale.push(`${r} (already migrated — delete this line)`);
    }
    expect(stale, 'allowlist entries that no longer need to be there — delete them').toEqual([]);
  });
});

describe('every in-screen <Modal> respects safe-area insets', () => {
  const modalFiles = [...walk(ROOT, isSourceFile)]
    .filter((full) => /<Modal\b/.test(readFileSync(full, 'utf8')))
    .map(rel)
    .sort();

  function hasInsetsRef(source: string): boolean {
    return source.includes('useSafeAreaInsets') || source.includes('useHeaderTopInset') || source.includes('SafeAreaView')
      || source.includes('ModalSafeArea') || source.includes('SafeAreaProvider');
  }

  it('a <Modal> without an insets reference is on the migration allowlist', () => {
    const offenders: string[] = [];
    for (const r of modalFiles) {
      const source = readFileSync(path.join(ROOT, r), 'utf8');
      if (hasInsetsRef(source)) continue;
      if (!MODAL_INSETS_ALLOWLIST.has(r)) offenders.push(r);
    }
    expect(offenders, 'new/regressed <Modal> not referencing safe-area insets and not on the migration allowlist').toEqual([]);
  });

  it('stale: every allowlisted <Modal> file still needs to be there', () => {
    const stale: string[] = [];
    for (const r of MODAL_INSETS_ALLOWLIST) {
      const full = path.join(ROOT, r);
      if (!existsSync(full)) { stale.push(`${r} (file no longer exists — delete this line)`); continue; }
      const source = readFileSync(full, 'utf8');
      if (!source.includes('<Modal')) { stale.push(`${r} (no longer renders <Modal> — delete this line)`); continue; }
      if (hasInsetsRef(source)) stale.push(`${r} (already references insets — delete this line)`);
    }
    expect(stale, 'allowlist entries that no longer need to be there — delete them').toEqual([]);
  });
});
