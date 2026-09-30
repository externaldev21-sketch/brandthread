/**
 * Ratchet lint for the Appearance-theme blackout bug.
 *
 * Settings > Appearance lets sellers/buyers pick one of 12 color themes
 * (contexts/AppThemeContext.tsx). Every screen must re-theme with it. The
 * regression this guards against: a component reaching for a
 * theme-INDEPENDENT color instead of the live theme —
 *  - a literal black/white hex, rgb(a), or named-color string
 *    ('#000', '#000000', 'black', '#0A0A0A', 'rgb(0,0,0)', '#fff', 'white', …)
 *    used as a color value outside the theme definition files themselves;
 *  - importing one of lib/theme.ts's legacy monochrome-only color constants
 *    (BG/SURFACE/CARD/FG/ACCENT/PURPLE/CYAN/BLUE/… — see LEGACY_COLOR_TOKENS
 *    below) and using it as a color prop, instead of `useAppTheme()`'s
 *    `theme.background/theme.accent/…` or the `useColors()` compatibility
 *    hook.
 *
 * Three accents are allowed to stay fixed regardless of theme (LIVE badge
 * red, end-call red, Thread Cash green) — this lint does not special-case
 * them by name; a file that legitimately needs one of them stays on the
 * allowlist below rather than being exempted by pattern-matching, so a
 * reviewer double-checks every entry instead of the lint silently trusting
 * a comment.
 *
 * Enforced via a shrinking allowlist rather than a hard cutover, matching
 * tests/no-hardcoded-grey-lint.test.ts's approach for the same class of
 * problem — a first full scan of the app found ~2,000+ hits across 100+
 * files (the legacy `lib/theme.ts` constants were never fully migrated off
 * of), too many to fix in one change. A file already in the allowlist may
 * keep its hits (no new failure); the allowlist can only ever get SMALLER —
 * remove a file the moment its hits are replaced with theme tokens, and
 * only add one in the same change that adds the file.
 *
 * `pnpm vitest run tests/no-hardcoded-theme-color-lint.test.ts -t stale`
 * fails the moment an allowlist entry no longer needs to be there.
 *
 * A file NOT in the allowlist and NOT satisfying the rule fails
 * immediately — a brand-new hardcoded-theme-color hit is caught right away.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

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

// The only files allowed to define these literal values.
const TOKEN_FILES = new Set(['lib/theme.ts', 'contexts/AppThemeContext.tsx', 'constants/colors.ts']);

// Pure/near-pure black or white, as a hex literal, rgb(a)(...), or the
// named colors 'black'/'white' — used as a color value.
const HEX_BLACK_OR_WHITE = /#(000000|000|0a0a0a|0a0a0b|fff{3,4}|ffffff)\b/i;
const RGB_BLACK_OR_WHITE = /rgba?\(\s*(0|255)\s*,\s*\1\s*,\s*\1\s*[,)]/;
const NAMED_BLACK_OR_WHITE = /:\s*['"](black|white)['"]/;

// Legacy monochrome-only color constants from lib/theme.ts. Every one of
// these resolves to a fixed black/white/silver value in EVERY Appearance
// theme by construction (see lib/theme.ts) — using one as a color prop is
// the bug, regardless of which theme is active.
const LEGACY_COLOR_TOKENS = [
  'BG', 'SCREEN_BG', 'SURFACE', 'CARD', 'CARD_ELEVATED', 'OVERLAY',
  'SURFACE_GLASS', 'CARD_GLASS', 'CARD_ELEVATED_GLASS',
  'SELLER_DASHBOARD_GLASS', 'SELLER_DASHBOARD_GLASS_ELEVATED',
  'BORDER_ACTIVE', 'BORDER_FOCUS',
  'FG', 'TEXT_PRIMARY', 'ON_DARK',
  'ACCENT', 'ACCENT_LIGHT', 'ACCENT_DIM',
  'PURPLE', 'PURPLE_LIGHT', 'PURPLE_DIM',
  'CYAN', 'CYAN_LIGHT', 'CYAN_DIM',
  'BLUE', 'BLUE_DIM',
  'GRAD_PRIMARY', 'GRAD_HERO', 'GRAD_CARD_GLOW', 'GRAD_DARK_FADE', 'GRAD_TAB_BAR',
];

const LEGACY_TOKEN_IMPORT = new RegExp(
  `import\\s*\\{[^}]*\\}\\s*from\\s*['"]@/lib/theme['"]`,
);
const LEGACY_TOKEN_NAMES = new RegExp(`\\b(${LEGACY_COLOR_TOKENS.join('|')})\\b`);

function importedLegacyTokens(source: string): string[] {
  const found: string[] = [];
  for (const match of source.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]@\/lib\/theme['"]/g)) {
    const names = match[1].split(',').map((n) => n.trim().split(/\s+as\s+/)[0]);
    for (const name of names) {
      if (LEGACY_COLOR_TOKENS.includes(name)) found.push(name);
    }
  }
  return found;
}

function hasHardcodedThemeColor(source: string, file: string): boolean {
  const lines = source.split('\n');

  // Literal black/white used as a color value, outside a comment line.
  const hasLiteral = lines.some((line) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) return false;
    return HEX_BLACK_OR_WHITE.test(line) || RGB_BLACK_OR_WHITE.test(line) || NAMED_BLACK_OR_WHITE.test(line);
  });
  if (hasLiteral) return true;

  // A legacy monochrome-only token imported from @/lib/theme and actually
  // referenced elsewhere in the file (not just re-exported unused).
  if (LEGACY_TOKEN_IMPORT.test(source)) {
    const tokens = importedLegacyTokens(source);
    for (const token of tokens) {
      const usageCount = (source.match(new RegExp(`\\b${token}\\b`, 'g')) ?? []).length;
      // 1 occurrence = only the import itself; >1 means it's used somewhere.
      if (usageCount > 1) return true;
    }
  }
  return false;
}

// Generated from the state of the tree when this lint was added, after the
// first fix pass (shared checkout primitives, BrandthreadUI.tsx,
// EngagementButton.tsx, IconButton.tsx, Chip.tsx, and the explicitly
// reported screens). Replace a file's hardcoded colors with
// `useAppTheme()`/`useColors()` tokens, then delete its line here in the
// same change.
const HARDCODED_THEME_COLOR_ALLOWLIST = new Set<string>([
  'app/(buyer)/cart.tsx',
  'app/(buyer)/edit-profile.tsx',
  'app/(buyer)/friends.tsx',
  'app/(buyer)/inbox.tsx',
  'app/(buyer)/profile.tsx',
  'app/(tabs)/feed.tsx',
  'app/(tabs)/following.tsx',
  'app/(tabs)/index.tsx',
  'app/(tabs)/orders.tsx',
  'app/(tabs)/products.tsx',
  'app/(tabs)/profile.tsx',
  'app/+html.tsx',
  'app/_layout.tsx',
  'app/activity-center.tsx',
  'app/add-product.tsx',
  'app/admin-reports.tsx',
  'app/ai-brain.tsx',
  'app/ai-studio.tsx',
  'app/appearance.tsx',
  'app/boost.tsx',
  'app/buyer-archive.tsx',
  'app/buyer-close-friends.tsx',
  'app/buyer-collection.tsx',
  'app/buyer-conversation.tsx',
  'app/buyer-drop-detail.tsx',
  'app/buyer-drops.tsx',
  'app/buyer-friend-requests.tsx',
  'app/buyer-highlights-manager.tsx',
  'app/buyer-invite.tsx',
  'app/buyer-live.tsx',
  'app/buyer-muted.tsx',
  'app/buyer-order-detail.tsx',
  'app/buyer-other-profile.tsx',
  'app/buyer-post-comments.tsx',
  'app/buyer-post-viewer.tsx',
  'app/buyer-problem-report.tsx',
  'app/buyer-product-detail.tsx',
  'app/buyer-qr-code.tsx',
  'app/buyer-refund-request.tsx',
  'app/buyer-restricted.tsx',
  'app/buyer-return-request.tsx',
  'app/buyer-saved.tsx',
  'app/buyer-search.tsx',
  'app/buyer-story-create.tsx',
  'app/buyer-story-viewer.tsx',
  'app/story-mention-viewer.tsx',
  'app/c/[collectionId].tsx',
  'app/call-screen.tsx',
  'app/camera-capture.tsx',
  'app/conversation-details.tsx',
  'app/conversation-group-create.tsx',
  'app/create-post.tsx',
  'app/design-ai-photoshoot.tsx',
  'app/design-bg-removal.tsx',
  'app/design-bg-replace.tsx',
  'app/design-brand-assets.tsx',
  'app/design-campaign.tsx',
  'app/design-canvas.tsx',
  'app/design-export.tsx',
  'app/design-garment.tsx',
  'app/design-mockup-preview.tsx',
  'app/design-mockup-to-model.tsx',
  'app/design-project.tsx',
  'app/design-prompt-edit.tsx',
  'app/design-templates.tsx',
  'app/design-upload-sketch.tsx',
  'app/design-versions.tsx',
  'app/design.tsx',
  'app/drafts.tsx',
  'app/edit-profile.tsx',
  'app/freelancer-apply.tsx',
  'app/freelancer-jobs.tsx',
  'app/fulfill-order.tsx',
  'app/help.tsx',
  'app/integrations/index.tsx',
  'app/invite-manufacturer.tsx',
  'app/live-feed.tsx',
  'app/live.tsx',
  'app/login-methods.tsx',
  'app/manufacturer-hub.tsx',
  'app/manufacturer-messages.tsx',
  'app/manufacturer-onboard.tsx',
  'app/manufacturer-profile.tsx',
  'app/meta-ads-manage.tsx',
  'app/navigation-isolation-probe.tsx',
  'app/onboarding.tsx',
  'app/order-detail.tsx',
  'app/plans.tsx',
  'app/product-bundle-edit.tsx',
  'app/product-bundles.tsx',
  'app/product-detail.tsx',
  'app/product-import.tsx',
  'app/product-reviews.tsx',
  'app/product-store.tsx',
  'app/production-detail.tsx',
  'app/quote-compare.tsx',
  'app/quote-detail.tsx',
  'app/quote-request.tsx',
  'app/refund-detail.tsx',
  'app/sample-detail.tsx',
  'app/seller-conversation.tsx',
  'app/seller-drop-preview.tsx',
  'app/seller-go-live.tsx',
  'app/seller-live.tsx',
  'app/seller-profile.tsx',
  'app/seller-settings.tsx',
  'app/setup.tsx',
  'app/share-profile.tsx',
  'app/share-store.tsx',
  'app/shipping.tsx',
  'app/shopping-preferences.tsx',
  'app/sign-in.tsx',
  'app/store-ai-improve.tsx',
  'app/store-builder.tsx',
  'app/store-collections.tsx',
  'app/store-domain.tsx',
  'app/store-editor.tsx',
  'app/store-from-logo.tsx',
  'app/store-from-moodboard.tsx',
  'app/store-from-social.tsx',
  'app/store-generate.tsx',
  'app/store-generating.tsx',
  'app/store-nav.tsx',
  'app/store-pages.tsx',
  'app/store-preview.tsx',
  'app/store-publish.tsx',
  'app/store-sections.tsx',
  'app/store-theme-picker.tsx',
  'app/store-versions.tsx',
  'app/team.tsx',
  'app/thread-cash.tsx',
  'app/vacation-mode.tsx',
  'components/BrandthreadUI.tsx',
  'components/ClerkLoadErrorBoundary.tsx',
  'components/CommerceSignal.tsx',
  'components/DateRangePicker.tsx',
  'components/DesignLayerCompositor.tsx',
  'components/EngagementButton.tsx',
  'components/ErrorFallback.tsx',
  'components/FeedGestureGuide.tsx',
  'components/InlineSlider.tsx',
  'components/MentionPickerSheet.tsx',
  'components/PlanUpsellModal.tsx',
  'components/ProductReviewsSection.tsx',
  'components/SaveToCollectionSheet.tsx',
  'components/SellerDashboardSections.tsx',
  'components/SellerHomeCommerceDashboard.tsx',
  'components/SellerStudioRadialMenu.tsx',
  'components/SellerTutorialOverlay.tsx',
  'components/SetupCelebration.tsx',
  'components/SetupWalkthroughSheet.tsx',
  'components/ShareProfileQrScanner.tsx',
  'components/ShareProfileSheet.tsx',
  'components/ShopProductSheet.tsx',
  'components/StoreContextBanner.tsx',
  'components/StoryMentionSticker.tsx',
  'components/StoryMentionViewerParts.tsx',
  'components/StripeConnectWarning.tsx',
  'components/StyleTagsPicker.tsx',
  'components/SupportChatBubble.tsx',
  'components/TextOverlayEditor.tsx',
  'components/ai/AiComposer.tsx',
  'components/ai/AuroraGlow.tsx',
  'components/ai/MarkdownLite.tsx',
  // components/ai-tools/* — the Mockup to Model / Remove Background / AI
  // Photoshoot shared components (PRs #555/#556/#559), built against the
  // pure-monochrome lib/theme.ts tokens before this Appearance-theme
  // migration reached them — same as most of the app per this file's own
  // ~2,000-hit note above. Not re-themed here; a follow-up can migrate
  // them onto useAppTheme() like the rest of the ratchet.
  'components/ai-tools/AiResultViewer.tsx',
  'components/ai-tools/AiResultsGrid.tsx',
  'components/ai-tools/AiToolButtons.tsx',
  'components/ai-tools/BgRemovalGlowSweep.tsx',
  'components/ai-tools/ReferencePhotoTiles.tsx',
  'components/analytics/AnalyticsKit.tsx',
  'components/buy-now/BuyNowFlow.tsx',
  'components/buy-now/OrderSuccessSheet.tsx',
  'components/buy-now/VariantPickerSheet.tsx',
  'components/buyer-feed/CaptionBlock.tsx',
  'components/buyer-feed/FeedTopBar.tsx',
  'components/buyer-feed/HeartBurstParticles.tsx',
  'components/buyer-feed/LongPressMenu.tsx',
  'components/buyer-feed/RightActionRail.tsx',
  'components/buyer-feed/ShopSideTab.tsx',
  'components/calls/CallAvatarCircle.tsx',
  'components/calls/InCallView.tsx',
  'components/chat/MediaUploadThumb.tsx',
  'components/chat/MediaViewer.tsx',
  'components/chat/ReactionOverlay.tsx',
  'components/checkout/OrderConfetti.tsx',
  'components/checkout/PaymentSection.tsx',
  'components/checkout/StripePayment.web.tsx',
  'components/create-post/MediaGrid.tsx',
  'components/design-studio/CanvasHost.tsx',
  'components/design-studio/ColorPicker.tsx',
  'components/design-studio/LayersPanel.tsx',
  'components/design-studio/SkiaDrawingCanvas.tsx',
  'components/design-studio/SvgDrawingCanvas.tsx',
  'components/design/BgRefineCanvas.tsx',
  'components/discover/DiscoverEntityCard.tsx',
  'components/discover/DiscoverFilterRow.tsx',
  'components/discover/DiscoverPager.tsx',
  'components/discover/DiscoverPeopleRow.tsx',
  'components/discover/DiscoverPostViewer.tsx',
  'components/discover/DiscoverSafetyMenu.tsx',
  'components/discover/DiscoverShopTheLookRail.tsx',
  'components/discover/DiscoverTileView.tsx',
  'components/discover/EditorialTile.tsx',
  'components/feed/UploadProgressPill.tsx',
  'components/illustrations/EmptyStateArt.tsx',
  'components/inbox/FollowerAvatarCard.tsx',
  'components/layout/Header.tsx',
  'components/layout/StickyFooter.tsx',
  'components/live/LiveAvatarRing.tsx',
  'components/live/LiveMoreSheet.tsx',
  'components/live/LiveOverlays.tsx',
  'components/live/LiveProductsSheet.tsx',
  'components/live/LiveStreamOptionsSheet.tsx',
  'components/live/LiveThreadCashSheet.tsx',
  'components/manufacturer/OrderCardBubble.tsx',
  'components/manufacturer/ProductionTimeline.tsx',
  'components/manufacturer/RfqChatCards.tsx',
  'components/media/MediaCropper.tsx',
  'components/onboarding/OnboardingUI.tsx',
  'components/onboarding/SellerPlanRecommendationStep.tsx',
  'components/paywall/SellerPaywallExitDrawer.tsx',
  'components/paywall/SellerPaywallOneTimeOffer.tsx',
  'components/paywall/SellerPlanSelector.tsx',
  'components/products/ProductCard.tsx',
  'components/products/StockEditorSheet.tsx',
  'components/profile/ProfileShell.tsx',
  'components/profile/ProfileStoryAvatar.tsx',
  'components/profile/ProfileTopBar.tsx',
  'components/profile/ProfileVideoGrid.tsx',
  'components/profile/ProfileVideoHeader.tsx',
  'components/search/BrandRow.tsx',
  'components/search/CategoryTile.tsx',
  'components/search/PersonRow.tsx',
  'components/search/SegmentedTabs.tsx',
  'components/search/VideoTile.tsx',
  'components/settings/SettingsKit.tsx',
  'components/share-cards/ShareCardFrame.tsx',
  'components/social/CreateButton.tsx',
  'components/social/PostGrid.tsx',
  'components/social/RemoveFollowerSheet.tsx',
  'components/social/StoryGestureGuide.tsx',
  'components/social/StoryTray.tsx',
  'components/tab-bar/TabBarParts.tsx',
  'components/thread-cash/CashOutSheet.tsx',
  'components/thread-cash/CelebrationHost.tsx',
  'components/thread-cash/ChatAttachThreadCash.tsx',
  'components/thread-cash/ThreadCashStreakRow.tsx',
  'components/ui/ActionSheet.tsx',
  'components/ui/BottomSheet.tsx',
  'components/ui/Button.tsx',
  'components/ui/Glass.tsx',
  'components/ui/IconButton.tsx',
  'components/ui/SegmentedControl.tsx',
  'components/ui/SuccessCheck.tsx',
  'components/web/WebAppShell.tsx',
  'lib/backgroundPalette.ts',
  'lib/canvasPresets.ts',
  'lib/color.ts',
  'lib/colorModel.ts',
  'lib/conversationThemes.ts',
  'lib/growthTools.ts',
  'lib/previewStorefrontHtml.ts',
  'lib/previewStories.ts',
  'lib/videoEditing.ts',
]);

describe('no hardcoded black/white theme colors outside the theme files', () => {
  const sourceFiles = ['app', 'components', 'contexts', 'hooks', 'constants', 'lib']
    .map((dir) => path.join(ROOT, dir))
    .filter((dir) => statSync(dir, { throwIfNoEntry: false })?.isDirectory())
    .flatMap((dir) => walk(dir))
    .map(rel)
    .filter((file) => !TOKEN_FILES.has(file));

  it('flags every file with a hardcoded theme color not already tracked', () => {
    const offenders = sourceFiles.filter((file) => hasHardcodedThemeColor(readFileSync(path.join(ROOT, file), 'utf8'), file));
    const newOffenders = offenders.filter((file) => !HARDCODED_THEME_COLOR_ALLOWLIST.has(file));

    expect(newOffenders).toEqual([]);
  });

  it('stale: every allowlisted file still needs to be there', () => {
    const stale = [...HARDCODED_THEME_COLOR_ALLOWLIST].filter((file) => {
      if (!sourceFiles.includes(file)) return true; // deleted/moved
      return !hasHardcodedThemeColor(readFileSync(path.join(ROOT, file), 'utf8'), file);
    });

    expect(stale).toEqual([]);
  });
});
