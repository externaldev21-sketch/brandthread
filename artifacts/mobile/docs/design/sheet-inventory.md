# Sheet inventory

Every bottom sheet, half-screen, modal, action sheet and overlay in the mobile
app, generated from the source (`<Modal>`, `BottomSheet`, `OptionSheet`,
`SuccessSheet`, `useSheetTransition`, `showActionSheet`). Line numbers are
from `dev` at the time of the sheet-system PR.

**Status key**

- **Shared engine**: already runs on `useSheetTransition`, so it picks up the
  new spring, rubber-band, flick-dismiss, haptics, raised surface and grabber
  from the foundation PR with no per-screen change.
- **Raw `<Modal>`**: its own slide/fade animation. Each one moves onto
  `<Sheet>` in its area's PR (messages/social, commerce, seller tools,
  settings/account), with its content rebuilt after one reference app.
- **Owned by another session**: in an area another session is actively
  building. Left alone here; they can adopt `<Sheet>` once it is on `dev`.
- **Not a sheet**: full-screen viewers, gates and overlays that are not
  half-screens. Out of scope.

`showActionSheet(...)` menus (18 call sites) all render through the one
`ActionSheetHost`, so they are covered by the foundation PR as a group.


## Messages & social (46)

| File | Line | Today |
|---|---|---|
| `app/(buyer)/inbox.tsx` | 1761 | raw `<Modal>` (slide) |
| `app/(buyer)/inbox.tsx` | 1841 | raw `<Modal>` (slide) |
| `app/(buyer)/profile.tsx` | 137 | raw `<Modal>` (none) |
| `app/(buyer)/profile.tsx` | 1030 | `BottomSheet` (shared engine) |
| `app/(tabs)/feed.tsx` | 3530 | raw `<Modal>` (fade) |
| `app/(tabs)/profile.tsx` | 777 | raw `<Modal>` (fade) |
| `app/admin-reports.tsx` | 370 | raw `<Modal>` (fade) |
| `app/buyer-conversation.tsx` | 2605 | raw `<Modal>` (fade) |
| `app/buyer-conversation.tsx` | 2644 | raw `<Modal>` (slide) |
| `app/buyer-notifications.tsx` | 584 | `BottomSheet` (shared engine) |
| `app/buyer-other-profile.tsx` | 576 | raw `<Modal>` (slide) |
| `app/buyer-post-comments.tsx` | 453 | raw `<Modal>` (fade) |
| `app/buyer-post-viewer.tsx` | 519 | raw `<Modal>` (fade) |
| `app/buyer-post-viewer.tsx` | 544 | raw `<Modal>` (fade) |
| `app/connections.tsx` | 427 | `OptionSheet` (shared engine) |
| `app/conversation-details.tsx` | 354 | raw `<Modal>` (fade) |
| `app/manufacturer-messages.tsx` | 469 | raw `<Modal>` (slide) |
| `app/manufacturer-messages.tsx` | 489 | raw `<Modal>` (fade) |
| `app/seller-conversation.tsx` | 1977 | raw `<Modal>` (fade) |
| `app/seller-conversation.tsx` | 2006 | raw `<Modal>` (fade) |
| `app/seller-conversation.tsx` | 2075 | raw `<Modal>` (fade) |
| `app/seller-conversation.tsx` | 2134 | raw `<Modal>` (fade) |
| `app/seller-conversation.tsx` | 2197 | raw `<Modal>` (fade) |
| `app/seller-profile.tsx` | 760 | raw `<Modal>` (slide) |
| `components/MentionPickerSheet.tsx` | 79 | raw `<Modal>` (slide) |
| `components/ShareProfileSheet.tsx` | 259 | raw `<Modal>` (Platform) |
| `components/ThreadShareSheet.tsx` | 263 | raw `<Modal>` (fade) |
| `components/buyer-feed/LongPressMenu.tsx` | 34 | raw `<Modal>` (fade) |
| `components/chat/ConversationSettingsSheet.tsx` | 143 | raw `<Modal>` (fade) |
| `components/chat/ThemePickerSheet.tsx` | 32 | raw `<Modal>` (fade) |
| `components/discover/DiscoverSafetyMenu.tsx` | 31 | raw `<Modal>` (fade) |
| `components/live/LiveCommentActionsSheet.tsx` | 46 | raw `<Modal>` (fade) |
| `components/live/LiveMoreSheet.tsx` | 85 | raw `<Modal>` (fade) |
| `components/live/LiveProductsSheet.tsx` | 38 | raw `<Modal>` (fade) |
| `components/live/LiveStreamOptionsSheet.tsx` | 33 | raw `<Modal>` (fade) |
| `components/live/LiveThreadCashSheet.tsx` | 117 | raw `<Modal>` (fade) |
| `components/notifications/QuietHoursRow.tsx` | 50 | `OptionSheet` (shared engine) |
| `components/profile/ImageSourceSheet.tsx` | 10 | `BottomSheet` (shared engine) |
| `components/profile/ImageSourceSheet.tsx` | 119 | `BottomSheet` (shared engine) |
| `components/profile/ProfileMenuSheet.tsx` | 39 | raw `<Modal>` (slide) |
| `components/safety/ReportSheet.tsx` | 51 | `useSheetTransition` (shared engine) |
| `components/safety/ReportSheet.tsx` | 62 | raw `<Modal>` (none) |
| `components/social/RemoveFollowerSheet.tsx` | 36 | raw `<Modal>` (fade) |
| `components/social/StoryQuestionResponsesSheet.tsx` | 27 | raw `<Modal>` (slide) |
| `components/thread-cash/CashOutSheet.tsx` | 85 | raw `<Modal>` (fade) |
| `components/thread-cash/ChatAttachThreadCash.tsx` | 306 | raw `<Modal>` (fade) |

## Commerce & checkout (16)

| File | Line | Today |
|---|---|---|
| `app/buyer-collection.tsx` | 244 | raw `<Modal>` (fade) |
| `app/buyer-product-detail.tsx` | 1376 | `BottomSheet` (shared engine) |
| `app/buyer-product-detail.tsx` | 1587 | `BottomSheet` (shared engine) |
| `app/buyer-saved.tsx` | 384 | `BottomSheet` (shared engine) |
| `app/buyer-saved.tsx` | 413 | raw `<Modal>` (fade) |
| `components/ProductReviewsSection.tsx` | 117 | raw `<Modal>` (fade) |
| `components/SaveToCollectionSheet.tsx` | 57 | `useSheetTransition` (shared engine) |
| `components/SaveToCollectionSheet.tsx` | 112 | raw `<Modal>` (none) |
| `components/ShopProductSheet.tsx` | 489 | `useSheetTransition` (shared engine) |
| `components/ShopProductSheet.tsx` | 949 | raw `<Modal>` (none) |
| `components/ShopProductSheet.tsx` | 1663 | raw `<Modal>` (fade) |
| `components/buy-now/BuyNowFlow.tsx` | 234 | raw `<Modal>` (fade) |
| `components/buy-now/VariantPickerSheet.tsx` | 130 | raw `<Modal>` (slide) |
| `components/checkout/CheckoutPrimitives.tsx` | 261 | raw `<Modal>` (slide) |
| `components/products/CompleteTheFit.tsx` | 192 | `BottomSheet` (shared engine) |
| `components/search/FilterSheet.tsx` | 137 | `BottomSheet` (shared engine) |

## Seller tools (32)

| File | Line | Today |
|---|---|---|
| `app/(tabs)/products.tsx` | 186 | raw `<Modal>` (fade) |
| `app/(tabs)/products.tsx` | 274 | raw `<Modal>` (fade) |
| `app/(tabs)/products.tsx` | 339 | raw `<Modal>` (fade) |
| `app/(tabs)/products.tsx` | 395 | raw `<Modal>` (fade) |
| `app/add-product.tsx` | 2193 | `SuccessSheet` (shared engine) |
| `app/analytics-goals.tsx` | 117 | `BottomSheet` (shared engine) |
| `app/discounts.tsx` | 442 | raw `<Modal>` (slide) |
| `app/discounts.tsx` | 683 | raw `<Modal>` (slide) |
| `app/locations.tsx` | 230 | raw `<Modal>` (slide) |
| `app/manufacturer-hub.tsx` | 919 | raw `<Modal>` (slide) |
| `app/meta-ads-manage.tsx` | 213 | raw `<Modal>` (fade) |
| `app/product-import.tsx` | 386 | raw `<Modal>` (slide) |
| `app/product-launches.tsx` | 124 | raw `<Modal>` (slide) |
| `app/product-launches.tsx` | 146 | raw `<Modal>` (slide) |
| `app/sales.tsx` | 281 | raw `<Modal>` (slide) |
| `app/sales.tsx` | 350 | raw `<Modal>` (slide) |
| `app/sales.tsx` | 369 | raw `<Modal>` (slide) |
| `app/seller-drop-create.tsx` | 639 | raw `<Modal>` (slide) |
| `app/seller-giveaway-create.tsx` | 105 | `OptionSheet` (shared engine) |
| `app/seller-giveaway-create.tsx` | 109 | `OptionSheet` (shared engine) |
| `app/seller-push-broadcast.tsx` | 201 | `OptionSheet` (shared engine) |
| `app/store-builder.tsx` | 496 | raw `<Modal>` (fade) |
| `app/store-nav.tsx` | 382 | raw `<Modal>` (fade) |
| `app/team.tsx` | 441 | raw `<Modal>` (fade) |
| `components/PlanUpsellModal.tsx` | 80 | raw `<Modal>` (slide) |
| `components/SellerListHeader.tsx` | 148 | raw `<Modal>` (fade) |
| `components/SetupWalkthroughSheet.tsx` | 61 | `useSheetTransition` (shared engine) |
| `components/SetupWalkthroughSheet.tsx` | 104 | raw `<Modal>` (none) |
| `components/paywall/SellerPaywallExitDrawer.tsx` | 77 | raw `<Modal>` (none) |
| `components/paywall/SellerPaywallOneTimeOffer.tsx` | 62 | raw `<Modal>` (none) |
| `components/products/ProductImportPreview.tsx` | 35 | raw `<Modal>` (slide) |
| `components/products/StockEditorSheet.tsx` | 127 | raw `<Modal>` (fade) |

## Settings & account (18)

| File | Line | Today |
|---|---|---|
| `app/(buyer)/edit-profile.tsx` | 78 | raw `<Modal>` (fade) |
| `app/buyer-archive.tsx` | 165 | raw `<Modal>` (slide) |
| `app/buyer-highlights-manager.tsx` | 57 | raw `<Modal>` (fade) |
| `app/buyer-privacy-settings.tsx` | 300 | `OptionSheet` (shared engine) |
| `app/buyer-privacy-settings.tsx` | 308 | `OptionSheet` (shared engine) |
| `app/buyer-privacy-settings.tsx` | 316 | `OptionSheet` (shared engine) |
| `app/buyer-privacy-settings.tsx` | 324 | `OptionSheet` (shared engine) |
| `app/buyer-privacy-settings.tsx` | 332 | `OptionSheet` (shared engine) |
| `app/buyer-privacy-settings.tsx` | 340 | `OptionSheet` (shared engine) |
| `app/buyer-restricted.tsx` | 112 | raw `<Modal>` (fade) |
| `app/freelancer-profile.tsx` | 369 | raw `<Modal>` (fade) |
| `app/help.tsx` | 283 | raw `<Modal>` (slide) |
| `app/login-methods.tsx` | 450 | raw `<Modal>` (slide) |
| `app/login-methods.tsx` | 546 | raw `<Modal>` (slide) |
| `app/seller-settings.tsx` | 361 | raw `<Modal>` (fade) |
| `components/AccountSwitcherSheet.tsx` | 218 | `BottomSheet` (shared engine) |
| `components/DateRangePicker.tsx` | 393 | raw `<Modal>` (fade) |
| `components/settings/SettingsKit.tsx` | 284 | raw `<Modal>` (fade) |

## Owned by another session (57)

| File | Line | Today | Owner |
|---|---|---|---|
| `app/(tabs)/orders.tsx` | 509 | raw `<Modal>` (fade) | Order tracking / auto-refunds session |
| `app/(tabs)/orders.tsx` | 549 | raw `<Modal>` (fade) | Order tracking / auto-refunds session |
| `app/ai-studio.tsx` | 248 | raw `<Modal>` (fade) | AI Design session |
| `app/buyer-order-detail.tsx` | 288 | raw `<Modal>` (fade) | Order tracking / auto-refunds session |
| `app/buyer-order-detail.tsx` | 1285 | raw `<Modal>` (slide) | Order tracking / auto-refunds session |
| `app/buyer-order-detail.tsx` | 1314 | raw `<Modal>` (slide) | Order tracking / auto-refunds session |
| `app/buyer-story-create.tsx` | 1384 | raw `<Modal>` (slide) | TikTok/Instagram create flow session |
| `app/buyer-story-create.tsx` | 1430 | raw `<Modal>` (slide) | TikTok/Instagram create flow session |
| `app/buyer-story-create.tsx` | 1829 | raw `<Modal>` (fade) | TikTok/Instagram create flow session |
| `app/buyer-story-create.tsx` | 1964 | raw `<Modal>` (fade) | TikTok/Instagram create flow session |
| `app/buyer-story-create.tsx` | 1988 | raw `<Modal>` (fade) | TikTok/Instagram create flow session |
| `app/buyer-story-create.tsx` | 2017 | raw `<Modal>` (fade) | TikTok/Instagram create flow session |
| `app/buyer-story-create.tsx` | 2045 | raw `<Modal>` (slide) | TikTok/Instagram create flow session |
| `app/buyer-story-create.tsx` | 2104 | raw `<Modal>` (slide) | TikTok/Instagram create flow session |
| `app/buyer-story-create.tsx` | 2145 | raw `<Modal>` (slide) | TikTok/Instagram create flow session |
| `app/buyer-story-create.tsx` | 2182 | raw `<Modal>` (fade) | TikTok/Instagram create flow session |
| `app/community-members.tsx` | 410 | raw `<Modal>` (slide) | Community group chats session |
| `app/community-members.tsx` | 457 | `BottomSheet` (shared engine) | Community group chats session |
| `app/community.tsx` | 317 | `BottomSheet` (shared engine) | Community group chats session |
| `app/design-bg-replace.tsx` | 427 | raw `<Modal>` (slide) | Remove Background session |
| `app/design-canvas.tsx` | 4279 | raw `<Modal>` (fade) | Design Studio mechanics session |
| `app/design-canvas.tsx` | 4293 | raw `<Modal>` (fade) | Design Studio mechanics session |
| `app/design-canvas.tsx` | 4334 | raw `<Modal>` (fade) | Design Studio mechanics session |
| `app/design-canvas.tsx` | 4357 | raw `<Modal>` (fade) | Design Studio mechanics session |
| `app/design-canvas.tsx` | 4387 | raw `<Modal>` (fade) | Design Studio mechanics session |
| `app/design-canvas.tsx` | 4469 | raw `<Modal>` (fade) | Design Studio mechanics session |
| `app/design-canvas.tsx` | 4543 | raw `<Modal>` (fade) | Design Studio mechanics session |
| `app/design-canvas.tsx` | 4612 | raw `<Modal>` (fade) | Design Studio mechanics session |
| `app/design-canvas.tsx` | 4643 | raw `<Modal>` (fade) | Design Studio mechanics session |
| `app/design-canvas.tsx` | 4704 | raw `<Modal>` (fade) | Design Studio mechanics session |
| `app/design-canvas.tsx` | 4746 | raw `<Modal>` (fade) | Design Studio mechanics session |
| `app/design-canvas.tsx` | 4797 | raw `<Modal>` (fade) | Design Studio mechanics session |
| `app/design-canvas.tsx` | 5151 | raw `<Modal>` (fade) | Design Studio mechanics session |
| `app/design-canvas.tsx` | 5626 | raw `<Modal>` (fade) | Design Studio mechanics session |
| `app/design-mockup-to-model.tsx` | 420 | raw `<Modal>` (slide) | AI Design session |
| `app/design-text-to-design.tsx` | 452 | raw `<Modal>` (slide) | AI Design session |
| `app/design.tsx` | 161 | raw `<Modal>` (slide) | AI Design / Design Studio sessions |
| `app/design.tsx` | 572 | `useSheetTransition` (shared engine) | AI Design / Design Studio sessions |
| `app/design.tsx` | 576 | raw `<Modal>` (none) | AI Design / Design Studio sessions |
| `app/design.tsx` | 890 | raw `<Modal>` (fade) | AI Design / Design Studio sessions |
| `app/design.tsx` | 950 | raw `<Modal>` (fade) | AI Design / Design Studio sessions |
| `app/design.tsx` | 1326 | `useSheetTransition` (shared engine) | AI Design / Design Studio sessions |
| `app/design.tsx` | 1339 | raw `<Modal>` (none) | AI Design / Design Studio sessions |
| `app/design.tsx` | 1390 | `useSheetTransition` (shared engine) | AI Design / Design Studio sessions |
| `app/design.tsx` | 1394 | raw `<Modal>` (none) | AI Design / Design Studio sessions |
| `app/lifestyle-images.tsx` | 398 | raw `<Modal>` (slide) | AI Photoshoot session |
| `app/order-detail.tsx` | 930 | raw `<Modal>` (fade) | Order tracking / auto-refunds session |
| `app/order-detail.tsx` | 992 | raw `<Modal>` (slide) | Order tracking / auto-refunds session |
| `components/SellerCreateFAB.tsx` | 89 | raw `<Modal>` (fade) | TikTok/Instagram create flow session |
| `components/SellerStudioRadialMenu.tsx` | 1457 | raw `<Modal>` (none) | Studio menu session (also the seller swipe/glow; never touched) |
| `components/StoreContextBanner.tsx` | 178 | raw `<Modal>` (fade) | Studio menu session |
| `components/TextOverlayEditor.tsx` | 199 | raw `<Modal>` (fade) | TikTok/Instagram create flow session |
| `components/ai-tools/AiResultViewer.tsx` | 46 | raw `<Modal>` (fade) | AI Design session |
| `components/orders/ReorderFlow.tsx` | 117 | `BottomSheet` (shared engine) | Order tracking / auto-refunds session |
| `components/orders/SellerDelivery.tsx` | 142 | raw `<Modal>` (slide) | Order tracking / auto-refunds session |
| `components/profile/ProfileCover.tsx` | 182 | raw `<Modal>` (fade) | Studio covers session |
| `components/social/StoryStickerComposer.tsx` | 30 | raw `<Modal>` (slide) | TikTok/Instagram create flow session |

## Not a sheet (25)

| File | Line | What it is |
|---|---|---|
| `app/buyer-story-viewer.tsx` | 1076 | full-screen story viewer |
| `components/ErrorFallback.tsx` | 102 | full-screen error fallback |
| `components/ModalSafeArea.tsx` | 2 | safe-area helper used inside other modals |
| `components/ModalSafeArea.tsx` | 5 | safe-area helper used inside other modals |
| `components/ModalSafeArea.tsx` | 11 | safe-area helper used inside other modals |
| `components/ModalSafeArea.tsx` | 19 | safe-area helper used inside other modals |
| `components/ModalSafeArea.tsx` | 22 | safe-area helper used inside other modals |
| `components/SellerTutorialOverlay.tsx` | 48 | coach-mark overlay |
| `components/SetupCelebration.tsx` | 39 | full-screen celebration |
| `components/StoryMentionViewerParts.tsx` | 162 | full-screen story viewer part |
| `components/SupportChatBubble.tsx` | 196 | full-screen support chat |
| `components/chat/MediaViewer.tsx` | 123 | full-screen media viewer |
| `components/chat/ReactionOverlay.tsx` | 110 | in-place reaction overlay (long-press bubble) |
| `components/chat/ThemePreviewScreen.tsx` | 34 | full-screen theme preview |
| `components/chat/VideoMessageViewer.tsx` | 28 | full-screen video viewer |
| `components/discover/DiscoverPostViewer.tsx` | 158 | full-screen post viewer |
| `components/legal/LegalAcceptanceGate.tsx` | 110 | full-screen legal gate |
| `components/motion/SheetRise.tsx` | 7 | legacy rise helper (RN Animated) |
| `components/motion/SheetRise.tsx` | 17 | legacy rise helper (RN Animated) |
| `components/security/AppLockGate.tsx` | 123 | full-screen app-lock gate |
| `components/ui/ActionSheet.tsx` | 82 | the shared action sheet itself |
| `components/ui/ActionSheet.tsx` | 96 | the shared action sheet itself |
| `components/ui/BottomSheet.tsx` | 182 | the shared sheet itself |
| `components/ui/BottomSheet.tsx` | 248 | the shared sheet itself |
| `components/ui/SuccessSheet.tsx` | 43 | shared success sheet (on BottomSheet) |
