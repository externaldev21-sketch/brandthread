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

const ROOT = path.resolve(import.meta.dirname, '..');

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
  'app/(buyer)/activity.tsx',
  'app/(buyer)/cart.tsx',
  'app/(buyer)/discover-feed.tsx',
  'app/(buyer)/discover.tsx',
  'app/(buyer)/feed.tsx',
  'app/(buyer)/following.tsx',
  'app/(buyer)/friends.tsx',
  'app/(buyer)/inbox.tsx',
  'app/(buyer)/index.tsx',
  'app/(buyer)/orders.tsx',
  'app/(buyer)/profile.tsx',
  'app/(tabs)/feed.tsx',
  'app/(tabs)/following.tsx',
  'app/(tabs)/index.tsx',
  'app/(tabs)/more.tsx',
  'app/(tabs)/orders.tsx',
  'app/(tabs)/products.tsx',
  'app/(tabs)/profile.tsx',
  'app/(tabs)/studio.tsx',
  'app/account-type.tsx',
  'app/add-product.tsx',
  'app/app-icon.tsx',
  'app/app-theme.tsx',
  'app/ai-assistant.tsx',
  'app/bg-removal.tsx',
  'app/buyer-account-control.tsx',
  'app/buyer-drop-detail.tsx',
  'app/buyer-live.tsx',
  'app/buyer-login-activity.tsx',
  'app/buyer-other-profile.tsx',
  'app/buyer-post-comments.tsx',
  'app/buyer-product-detail.tsx',
  'app/buyer-search.tsx',
  'app/buyer-story-create.tsx',
  'app/buyer-story-viewer.tsx',
  'app/story-mention-viewer.tsx',
  'app/c/[collectionId].tsx',
  'app/call-screen.tsx',
  'app/camera-capture.tsx',
  'app/community-guidelines.tsx',
  'app/conversation-details.tsx',
  'app/conversation-search.tsx',
  'app/design-canvas.tsx',
  'app/design-project.tsx',
  'app/design-prompt-edit.tsx',
  'app/design-upload-sketch.tsx',
  'app/design.tsx',
  'app/dispute-detail.tsx',
  'app/drops/[dropId].tsx',
  'app/forgot-password.tsx',
  'app/index.tsx',
  'app/ip-report.tsx',
  'app/live-feed.tsx',
  'app/live.tsx',
  'app/login-activity.tsx',
  'app/manufacturer-profile.tsx',
  'app/manufacturer.tsx',
  'app/navigation-isolation-probe.tsx',
  'app/onboarding.tsx',
  'app/orders.tsx',
  'app/privacy.tsx',
  'app/product-bundle-edit.tsx',
  'app/product-bundles.tsx',
  'app/product-detail.tsx',
  'app/product-editor.tsx',
  'app/product-import.tsx',
  'app/product-size-chart.tsx',
  'app/product-store.tsx',
  'app/profile-products.tsx',
  'app/profile-videos.tsx',
  'app/return-request.tsx',
  'app/seller-conversation.tsx',
  'app/seller-drop-preview.tsx',
  'app/seller-go-live.tsx',
  'app/seller-live.tsx',
  'app/seller-profile.tsx',
  'app/settings.tsx',
  'app/shipping-delivery.tsx',
  'app/shipping-label.tsx',
  'app/sign-in.tsx',
  'app/splash.tsx',
  'app/store-builder.tsx',
  'app/store-generating.tsx',
  'app/store-preview.tsx',
  'app/store/product/[productId].tsx',
  'app/team-invite.tsx',
  'app/terms.tsx',
  'app/thread-checkout.tsx',
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
  'app/design-ai-photoshoot.tsx',
  'app/design-bg-replace.tsx',
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
      if (source.includes('ScreenHeader')) continue;
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
      if (source.includes('ScreenHeader')) stale.push(`${r} (already migrated — delete this line)`);
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
      || source.includes('ModalSafeArea');
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
