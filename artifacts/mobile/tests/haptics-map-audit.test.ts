/**
 * Haptics map audit (buyer + seller). Every file below was audited against
 * HAPTIC_MAP in lib/haptics.ts: its haptics are named events
 * (`haptic('like')`, `haptic('purchaseSuccess')`, …) or `hapticFollow`. This
 * keeps raw expo-haptics calls and the old tier helpers from creeping back in
 * (they can't say *why* a haptic plays, which is how plain taps, navigation
 * and scroll ended up buzzing).
 *
 * Areas owned by other in-flight work (create flow, Design Studio/AI, checkout,
 * Discover search, profiles, tab bars, sheets, chats, community, order
 * tracking) are not listed yet; their raw calls still respect the Settings
 * switch and the one-per-action rule through shims/expo-haptics.ts.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..');

// Buyer-side files (3/4). Seller-side files are added in 4/4.
const AUDITED = [
  'app/(buyer)/cart.tsx',
  'app/(buyer)/edit-profile.tsx',
  'app/(buyer)/friends.tsx',
  'app/(buyer)/inbox.tsx',
  'app/(buyer)/orders.tsx',
  'app/(tabs)/feed.tsx',
  'app/access-code.tsx',
  'app/account-type-settings.tsx',
  'app/account-type.tsx',
  'app/activity-center.tsx',
  'app/appearance.tsx',
  'app/biometric-unlock.tsx',
  'app/buyer-addresses.tsx',
  'app/buyer-archive.tsx',
  'app/buyer-blocked.tsx',
  'app/buyer-close-friends.tsx',
  'app/buyer-collection.tsx',
  'app/buyer-download-data.tsx',
  'app/buyer-drafts.tsx',
  'app/buyer-drop-detail.tsx',
  'app/buyer-drops.tsx',
  'app/buyer-friend-requests.tsx',
  'app/buyer-highlight-stories.tsx',
  'app/buyer-highlights-manager.tsx',
  'app/buyer-invite.tsx',
  'app/buyer-live.tsx',
  'app/buyer-muted.tsx',
  'app/buyer-my-sizes.tsx',
  'app/buyer-notifications.tsx',
  'app/buyer-payment-methods.tsx',
  'app/buyer-personal-details.tsx',
  'app/buyer-post-comments.tsx',
  'app/buyer-post-viewer.tsx',
  'app/buyer-problem-report.tsx',
  'app/buyer-product-detail.tsx',
  'app/buyer-qr-code.tsx',
  'app/buyer-restricted.tsx',
  'app/buyer-saved.tsx',
  'app/buyer-settings-menu.tsx',
  'app/buyer-settings.tsx',
  'app/buyer-story-viewer.tsx',
  'app/connections.tsx',
  'app/delete-account.tsx',
  'app/find-friends-contacts.tsx',
  'app/first-run-tips-settings.tsx',
  'app/forgot-password.tsx',
  'app/hashtag/[tag].tsx',
  'app/help.tsx',
  'app/languages.tsx',
  'app/live-feed.tsx',
  'app/live-replays.tsx',
  'app/live.tsx',
  'app/location/[placeId].tsx',
  'app/muted-words.tsx',
  'app/notification-channels.tsx',
  'app/onboarding.tsx',
  'app/product-detail.tsx',
  'app/product-store.tsx',
  'app/push-notifications.tsx',
  'app/share-profile.tsx',
  'app/shopping-preferences.tsx',
  'app/sign-in.tsx',
  'app/story-mention-viewer.tsx',
  'app/thread-explainer.tsx',
  'components/AccountSwitcherSheet.tsx',
  'components/ActivityBellButton.tsx',
  'components/BrandDropsCard.tsx',
  'components/SaveHeart.tsx',
  'components/SaveToCollectionSheet.tsx',
  'components/ShareProfileQrScanner.tsx',
  'components/ShareProfileSheet.tsx',
  'components/ShopProductSheet.tsx',
  'components/SupportChatBubble.tsx',
  'components/SwipeActionRow.tsx',
  'components/buyer-feed/CaptionBlock.tsx',
  'components/buyer-feed/FeedTopBar.tsx',
  'components/buyer-feed/LongPressMenu.tsx',
  'components/buyer-feed/RightActionRail.tsx',
  'components/buyer-feed/ShopSideTab.tsx',
  'components/calls/CallEndedView.tsx',
  'components/calls/CallLogBubble.tsx',
  'components/drops/DropsCalendar.tsx',
  'components/inbox/InboxSwipeRow.tsx',
  'components/legal/LegalConsent.tsx',
  'components/live/LiveCommentActionsSheet.tsx',
  'components/live/LiveMoreSheet.tsx',
  'components/live/LiveOverlays.tsx',
  'components/live/LiveStreamOptionsSheet.tsx',
  'components/live/LiveThreadCashSheet.tsx',
  'components/onboarding/SizesStep.tsx',
  'components/onboarding/WelcomeStep.tsx',
  'components/onboarding/onboardingTokens.ts',
  'components/products/CompleteTheFit.tsx',
  'components/products/LaunchCountdown.tsx',
  'components/products/ProductCard.tsx',
  'components/security/LoginActivity.tsx',
  'components/social/CreateButton.tsx',
  'components/social/LocationPicker.tsx',
  'components/social/LocationTag.tsx',
  'components/thread-cash/CashOutSheet.tsx',
  'components/thread-cash/CelebrationHost.tsx',
  'components/thread-cash/ChatAttachThreadCash.tsx',
  'components/ui/Chip.tsx',
  'components/ui/QuantityStepper.tsx',
  'components/ui/SegmentedControl.tsx',
  'components/ui/SuccessCheck.tsx',
  'hooks/useVoiceRecorder.ts',
  'lib/calls/CallSessionContext.tsx',
  'lib/useBlockAction.ts',
  'lib/useReportFlow.ts',
];

const RAW = /\bHaptics\.(impactAsync|selectionAsync|notificationAsync)\(/;
const LEGACY = /\bhaptic(Light|Medium|Success|Error|Warning|PrimaryAction|SuccessAction|DestructiveConfirm|Toggle|TabChange|Selection)\(/;

describe('haptics map audit', () => {
  it.each(AUDITED)('%s uses named haptic events only', (file) => {
    const src = readFileSync(resolve(ROOT, file), 'utf8');
    const lines = src.split('\n');
    const offenders = lines
      .map((line, i) => ({ line: line.trim(), n: i + 1 }))
      .filter(({ line }) => !line.startsWith('//') && !line.startsWith('*') && (RAW.test(line) || LEGACY.test(line)));
    expect(offenders, `${file} — use haptic('<event>') from lib/haptics`).toEqual([]);
  });

  it('shared controls play no haptic on a plain tap', () => {
    for (const file of ['components/ui/Button.tsx', 'components/ui/ListRow.tsx', 'components/ui/IconButton.tsx', 'components/ui/Card.tsx']) {
      const src = readFileSync(resolve(ROOT, file), 'utf8');
      expect(/haptic|Haptics/.test(src), file).toBe(false);
    }
    const ui = readFileSync(resolve(ROOT, 'components/BrandthreadUI.tsx'), 'utf8');
    // Only FilterChip (selection) and HapticSwitch (selection) tick.
    expect(ui.match(/\bhaptic\w*\(/g)).toEqual(['hapticSelection(', 'hapticSelection(']);
  });
});
