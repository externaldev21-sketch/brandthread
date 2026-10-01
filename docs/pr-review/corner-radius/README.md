# Corner-radius pass — before/after (393x852)

Radius only. `before` = origin/dev at 296ff62, `after` = this branch, both exported with the store-screenshots preview harness (frozen clock, demo accounts), 60 routes captured; the table lists the routes with radius changes. Each route has `screens/<id>.before.png`, `.after.png` and `.diff.png` (red = changed pixel inside a corner region of an element whose radius changed, orange = behind the tab-bar blur, blue = animation noise measured between two captures of the same BEFORE build). `zoom/` has 3x crops of both tab bars, filter chips and a button row.

## Pixel / DOM proof
Per route: every element's box and paint-relevant computed style (size, padding, margin, colour, border, shadow, opacity, font, transform, z-index, layout) is compared before vs after. Only `border-*-radius` may differ. Pixels that change must lie in the corner squares of an element whose radius changed (plus its shadow reach), or behind a backdrop blur. Reproduce: `node scripts/radius-before-after-screenshots.mjs capture|compare ...`.

| route | radius-changed elements | changed px | in corners | behind tab-bar blur | animation noise | unexplained | non-radius DOM diffs |
|---|---|---|---|---|---|---|---|
| buyer-activity | 8 | 2191 | 2191 | 0 | 0 | 0 | 0 |
| buyer-archive | 2 | 730 | 730 | 0 | 0 | 0 | 0 |
| buyer-cart | 14 | 1812 | 1812 | 0 | 0 | 0 | 0 |
| buyer-checkout | 3 | 1168 | 1166 | 0 | 0 | 2 | 0 |
| buyer-close-friends | 2 | 604 | 604 | 0 | 0 | 0 | 0 |
| buyer-friends | 10 | 1830 | 1830 | 0 | 0 | 0 | 0 |
| buyer-inbox | 12 | 5193 | 2395 | 0 | 2798 | 0 | 22 |
| buyer-orders | 17 | 3781 | 3781 | 0 | 0 | 0 | 0 |
| buyer-profile | 15 | 1988 | 1981 | 6 | 0 | 1 | 0 |
| buyer-qr-code | 1 | 562 | 562 | 0 | 0 | 0 | 0 |
| buyer-saved | 2 | 644 | 644 | 0 | 0 | 0 | 0 |
| help | 5 | 0 | 0 | 0 | 0 | 0 | 0 |
| manufacturer-compare | 14 | 2772 | 2772 | 0 | 0 | 0 | 0 |
| manufacturer-hub | 26 | 9030 | 9030 | 0 | 0 | 0 | 0 |
| onboarding | 2 | 1220 | 1220 | 0 | 0 | 0 | 0 |
| production-detail | 14 | 2772 | 2772 | 0 | 0 | 0 | 5 |
| rfq-list | 14 | 2772 | 2772 | 0 | 0 | 0 | 0 |
| rfq-post | 24 | 6333 | 6333 | 0 | 0 | 0 | 0 |
| seller-add-product | 19 | 329 | 329 | 0 | 0 | 0 | 0 |
| seller-analytics-sales | 19 | 4528 | 4528 | 0 | 0 | 0 | 0 |
| seller-brand | 25 | 6531 | 6531 | 0 | 0 | 0 | 0 |
| seller-content | 19 | 4870 | 4870 | 0 | 0 | 0 | 0 |
| seller-create-post | 17 | 530 | 530 | 0 | 0 | 0 | 0 |
| seller-customers | 17 | 3698 | 3698 | 0 | 0 | 0 | 0 |
| seller-dashboard | 24 | 6159 | 6159 | 0 | 0 | 0 | 0 |
| seller-design-canvas | 14 | 0 | 0 | 0 | 0 | 0 | 0 |
| seller-design | 14 | 2772 | 2772 | 0 | 0 | 0 | 0 |
| seller-drop-create | 83 | 6885 | 6885 | 0 | 0 | 0 | 0 |
| seller-following | 14 | 6220 | 6220 | 0 | 0 | 0 | 0 |
| seller-go-live | 14 | 0 | 0 | 0 | 0 | 0 | 0 |
| seller-inbox | 16 | 3180 | 3180 | 0 | 0 | 0 | 0 |
| seller-live | 14 | 0 | 0 | 0 | 0 | 0 | 0 |
| seller-locations | 15 | 2887 | 2887 | 0 | 0 | 0 | 0 |
| seller-marketing | 14 | 6910 | 6910 | 0 | 0 | 0 | 0 |
| seller-more | 14 | 4269 | 4269 | 0 | 0 | 0 | 0 |
| seller-orders | 29 | 8333 | 8241 | 0 | 86 | 6 | 8 |
| seller-payments | 14 | 2772 | 2772 | 0 | 0 | 0 | 0 |
| seller-products | 20 | 9751 | 9751 | 0 | 0 | 0 | 0 |
| seller-settings | 14 | 3601 | 3601 | 0 | 0 | 0 | 0 |
| seller-shipping | 15 | 3679 | 3679 | 0 | 0 | 0 | 0 |
| seller-store-builder | 18 | 5484 | 5484 | 0 | 0 | 0 | 0 |
| seller-store-editor | 14 | 2772 | 2772 | 0 | 0 | 0 | 0 |
| seller-store-generate | 26 | 3420 | 3420 | 0 | 0 | 0 | 0 |
| seller-studio | 15 | 3888 | 3888 | 0 | 0 | 0 | 0 |
| seller-team | 14 | 3007 | 3007 | 0 | 0 | 0 | 0 |
| share-profile | 2 | 1146 | 1146 | 0 | 0 | 0 | 0 |
| shopping-preferences | 11 | 560 | 560 | 0 | 0 | 0 | 0 |
| sign-in | 4 | 1076 | 1052 | 0 | 24 | 0 | 0 |
| subscription | 14 | 5588 | 5588 | 0 | 0 | 0 | 0 |
| tech-pack | 14 | 2788 | 2788 | 0 | 0 | 0 | 0 |
| thread-cash | 14 | 3612 | 3612 | 0 | 0 | 0 | 0 |

Caveats: 46 routes are fully clean (0 unexplained px, 0 non-radius DOM diffs). buyer-feed and buyer-discover are video/carousel driven and unstable even between two BEFORE captures, so they are not claimed. buyer-inbox, seller-orders, production-detail differ only by animated values (sub-pixel transform/opacity, spinner rotation); buyer-checkout/buyer-profile have 1–2 unexplained px (max channel delta ≤2, AA). Some routes bounce back to / in the demo harness; the script retries until it lands.

## Text-fit scan (new dev rule)
The script now flags text with scrollWidth > clientWidth, ellipsis, parent overflow or screen-edge cut-off. Result: 93 findings on dev before, 95 after; the 2 'introduced' are off-screen carousel items in the unstable discover capture. Radius changes cannot introduce text overflow, and nothing was fixed here because the brief for this PR is radius only. Pre-existing findings (full list in report.json `textFitFindingsAfterList`) include clipped chip rows at the screen edge (Returns, Archived, Low Stock, Drops, Story Reel…) and overflowing subtitles/prices in account-center, seller-dashboard, seller-more, seller-team. These need copy/layout changes — a separate PR.

## Not changed (listed, not done)
Non-interactive badges/status pills/toasts/progress bars/handles, text inputs and composers (search bars, reply pills, AI composer), cards (RADIUS.xl), true circles, switch tracks. Say the word to bring inputs/composers to radius.md.

## Files changed (artifacts/mobile)
- `app/(buyer)/cart.tsx`
- `app/(buyer)/inbox.tsx`
- `app/(buyer)/profile.tsx`
- `app/(tabs)/feed.tsx`
- `app/(tabs)/studio.tsx`
- `app/activity-center.tsx`
- `app/add-product.tsx`
- `app/admin-reports.tsx`
- `app/ai-mockup-chat.tsx`
- `app/ai-photography-chat.tsx`
- `app/boost.tsx`
- `app/brand.tsx`
- `app/buyer-archive.tsx`
- `app/buyer-close-friends.tsx`
- `app/buyer-conversation.tsx`
- `app/buyer-live.tsx`
- `app/buyer-other-profile.tsx`
- `app/buyer-product-detail.tsx`
- `app/buyer-qr-code.tsx`
- `app/buyer-story-create.tsx`
- `app/buyer-story-viewer.tsx`
- `app/c/[collectionId].tsx`
- `app/camera-capture.tsx`
- `app/community-chat.tsx`
- `app/connections.tsx`
- `app/content.tsx`
- `app/create-post.tsx`
- `app/customers.tsx`
- `app/delete-account.tsx`
- `app/design-ai-photoshoot.tsx`
- `app/design-bg-removal.tsx`
- `app/design-bg-replace.tsx`
- `app/design-brand-assets.tsx`
- `app/design-campaign.tsx`
- `app/design-canvas.tsx`
- `app/design-garment.tsx`
- `app/design-mockup-preview.tsx`
- `app/design-project.tsx`
- `app/design-prompt-edit.tsx`
- `app/design-templates.tsx`
- `app/dispute-detail.tsx`
- `app/fulfill-order.tsx`
- `app/invite-manufacturer.tsx`
- `app/ip-report.tsx`
- `app/live-feed.tsx`
- `app/live.tsx`
- `app/locations.tsx`
- `app/manufacturer-compare.tsx`
- `app/meta-ads-manage.tsx`
- `app/meta-ads-setup.tsx`
- `app/muted-words.tsx`
- `app/onboarding.tsx`
- `app/order-detail.tsx`
- `app/product-bundle-edit.tsx`
- `app/product-reviews.tsx`
- `app/quote-request.tsx`
- `app/refund-detail.tsx`
- `app/request-sample.tsx`
- `app/rfq-post.tsx`
- `app/sample-detail.tsx`
- `app/seller-conversation.tsx`
- `app/seller-drop-create.tsx`
- `app/seller-go-live.tsx`
- `app/seller-inbox.tsx`
- `app/seller-live.tsx`
- `app/share-profile.tsx`
- `app/shipping.tsx`
- `app/shopping-preferences.tsx`
- `app/store-builder.tsx`
- `app/store-editor.tsx`
- `app/store-generate.tsx`
- `app/store-preview.tsx`
- `app/store-sections.tsx`
- `app/store-settings.tsx`
- `app/store-theme-picker.tsx`
- `app/story-mention-viewer.tsx`
- `app/team.tsx`
- `app/u/[username].tsx`
- `components/BrandthreadUI.tsx`
- `components/FinanceMoneyFlow.tsx`
- `components/MentionPickerSheet.tsx`
- `components/ModeSwitcher.tsx`
- `components/SellerDashboardChart.tsx`
- `components/SellerDashboardTrafficSources.tsx`
- `components/SellerGlobalTabBar.tsx`
- `components/SellerStudioRadialMenu.tsx`
- `components/SetupCelebration.tsx`
- `components/SetupWalkthroughSheet.tsx`
- `components/ShareProfileQrScanner.tsx`
- `components/ShareProfileSheet.tsx`
- `components/StoryMentionViewerParts.tsx`
- `components/StyleTagsPicker.tsx`
- `components/TextOverlayEditor.tsx`
- `components/ai-tools/AiToolButtons.tsx`
- `components/analytics/AnalyticsKit.tsx`
- `components/buyer-feed/FeedTopBar.tsx`
- `components/buyer-nav/BuyerTabBar.tsx`
- `components/chat/ReactionBar.tsx`
- `components/chat/VoiceMessageBubble.tsx`
- `components/checkout/PaymentSection.tsx`
- `components/community-chat/CommunityMessageRow.tsx`
- `components/community/CommunityRow.tsx`
- `components/design-studio/ColorPicker.tsx`
- `components/design-studio/LayersPanel.tsx`
- `components/design/BgRefineCanvas.tsx`
- `components/discover/DiscoverFilterRow.tsx`
- `components/discover/DiscoverPager.tsx`
- `components/discover/DiscoverPostViewer.tsx`
- `components/feed/UploadProgressPill.tsx`
- `components/layout/EmptyState.tsx`
- `components/legal/LegalDocument.tsx`
- `components/live/LiveEmptyState.tsx`
- `components/live/LiveOverlays.tsx`
- `components/live/LiveProductsSheet.tsx`
- `components/live/LiveThreadCashSheet.tsx`
- `components/onboarding/BrandsToFollowStep.tsx`
- `components/onboarding/OnboardingUI.tsx`
- `components/onboarding/SellerPlanRecommendationStep.tsx`
- `components/orders/OrderProgressTimeline.tsx`
- `components/profile/ProfileControls.tsx`
- `components/profile/ProfileCover.tsx`
- `components/profile/ProfileVideoHeader.tsx`
- `components/safety/DmSafety.tsx`
- `components/search/FilterSheet.tsx`
- `components/search/PersonRow.tsx`
- `components/search/SegmentedTabs.tsx`
- `components/settings/SettingsKit.tsx`
- `components/social/CreateButton.tsx`
- `components/tab-bar/TabBarParts.tsx`
- `components/thread-cash/CashOutSheet.tsx`
- `components/thread-cash/ChatAttachThreadCash.tsx`
- `components/thread-cash/SellerThreadCashCard.tsx`
- `components/ui/Button.tsx`
- `components/ui/Chip.tsx`
- `components/ui/MotionPrimitives.tsx`
- `components/ui/QuantityStepper.tsx`
- `components/ui/SegmentedControl.tsx`
- `constants/radii.ts`
- `scripts/radius-before-after-screenshots.mjs`
- `tests/buyer-thread-chrome.test.ts`
- `tests/no-pill-radius-on-controls.test.ts`
- `tests/onboarding-visual-structure.test.ts`
