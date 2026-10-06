| QA-ID | Screen | Status | Root cause / change |
|---|---|---|---|
| QA-0175 | `/hashtag/streetwear` | invalid | no route file (hashtag/[tag], tag/[tag], p/[postId], place/[placeId], location/[placeId], quote-post, post-captions-edit), nothing links; dev renders +not-found with shared header (no feed/dashboard) |
| QA-0176 | `/hashtag/streetwear` | invalid | no route file (hashtag/[tag], tag/[tag], p/[postId], place/[placeId], location/[placeId], quote-post, post-captions-edit), nothing links; dev renders +not-found with shared header (no feed/dashboard) |
| QA-0177 | `/` | fixed | FeedGestureGuide: BlurView + 38% dim removed -> opaque surface (2x glyph already centered in same 56px slot) |
| QA-0178 | `/account-type` | fixed | account-type: always redirected to /onboarding; signed-in/role previews now go to /account-type-settings (signed-out still onboarding) |
| QA-0179 | `/account-type` | fixed | account-type: always redirected to /onboarding; signed-in/role previews now go to /account-type-settings (signed-out still onboarding) |
| QA-0180 | `/account-type` | fixed | account-type: always redirected to /onboarding; signed-in/role previews now go to /account-type-settings (signed-out still onboarding) |
| QA-0181 | `/account-type` | fixed | account-type: always redirected to /onboarding; signed-in/role previews now go to /account-type-settings (signed-out still onboarding) |
| QA-0189 | `/design` | fixed | /design: signed-out preview getProjects waited ~8s on cloud API then 401 while black-on-black skeleton showed -> designService skips cloud when signed-out preview; empty state gets "New canvas" |
| QA-0190 | `/design` | fixed | demo projects (seedIfEmpty) show immediately; new test design-gallery-preview.service.test.ts |
| QA-0193 | `/more` | fixed | more Edit profile padding |
| QA-0194 | `/p/demo` | invalid | no route file (hashtag/[tag], tag/[tag], p/[postId], place/[placeId], location/[placeId], quote-post, post-captions-edit), nothing links; dev renders +not-found with shared header (no feed/dashboard) |
| QA-0195 | `/p/demo` | invalid | no route file (hashtag/[tag], tag/[tag], p/[postId], place/[placeId], location/[placeId], quote-post, post-captions-edit), nothing links; dev renders +not-found with shared header (no feed/dashboard) |
| QA-0196 | `/p/demo` | invalid | no route file (hashtag/[tag], tag/[tag], p/[postId], place/[placeId], location/[placeId], quote-post, post-captions-edit), nothing links; dev renders +not-found with shared header (no feed/dashboard) |
| QA-0197 | `/place/demo` | invalid | no route file (hashtag/[tag], tag/[tag], p/[postId], place/[placeId], location/[placeId], quote-post, post-captions-edit), nothing links; dev renders +not-found with shared header (no feed/dashboard) |
| QA-0198 | `/place/demo` | invalid | no route file (hashtag/[tag], tag/[tag], p/[postId], place/[placeId], location/[placeId], quote-post, post-captions-edit), nothing links; dev renders +not-found with shared header (no feed/dashboard) |
| QA-0199 | `/place/demo` | invalid | no route file (hashtag/[tag], tag/[tag], p/[postId], place/[placeId], location/[placeId], quote-post, post-captions-edit), nothing links; dev renders +not-found with shared header (no feed/dashboard) |
| QA-0209 | `/account-type-settings` | already fixed on dev | : account-type-settings stops loading w/ 4s fallback; screenshot shows Seller/Buyer cards |
| QA-0210 | `/account-type-settings` | already fixed on dev | : account-type-settings stops loading w/ 4s fallback; screenshot shows Seller/Buyer cards |
| QA-0211 | `/account-type-settings` | already fixed on dev | : account-type-settings stops loading w/ 4s fallback; screenshot shows Seller/Buyer cards |
| QA-0212 | `/account-type-settings` | already fixed on dev | : account-type-settings stops loading w/ 4s fallback; screenshot shows Seller/Buyer cards |
| QA-0220 | `/store-sections` | fixed | store-sections helper line moved inside scroll content |
| QA-0221 | `/store-sections` | fixed | store-sections tab bar inset |
| QA-0222 | `/store-sections` | fixed | store-sections tab bar inset |
| QA-0223 | `/store-sections` | fixed | store-sections helper line moved inside scroll content |
| QA-0229 | `/design-ai-photoshoot` | fixed | AI Photoshoot Generate dock now fixed footer below ScrollView (was floating over Scene cards) |
| QA-0230 | `/design-ai-photoshoot` | already fixed on dev | : progress bar sits above ScrollView; end screenshot shows normal scroll clipping |
| QA-0232 | `/ai-settings` | fixed | ai-settings tab bar inset |
| QA-0238 | `/app-icon` | fixed | app-icon/app-theme redirect to appearance; appearance tab bar inset |
| QA-0239 | `/app-icon` | fixed | app-icon/app-theme redirect to appearance; appearance tab bar inset |
| QA-0240 | `/app-theme` | fixed | app-icon/app-theme redirect to appearance; appearance tab bar inset |
| QA-0241 | `/appearance` | fixed | app-icon/app-theme redirect to appearance; appearance tab bar inset |
| QA-0242 | `/automation` | fixed | automation coming-soon: no entry points link to it; screen now redirects back/dashboard |
| QA-0243 | `/automation` | fixed | automation coming-soon: no entry points link to it; screen now redirects back/dashboard |
| QA-0244 | `/design-bg-replace` | fixed | design-bg-replace ScreenHeader; Generate 52px; Custom hex single line |
| QA-0245 | `/freelancer-apply` | fixed | freelancer-apply footer above tab bar |
| QA-0251 | `/design-brand-assets` | fixed | brand assets Upload asset lifted by tab bar inset, hidden on empty state; sentence case; loading always clears |
| QA-0252 | `/design-brand-assets` | fixed | brand assets Upload asset lifted by tab bar inset, hidden on empty state; sentence case; loading always clears |
| QA-0254 | `/brand` | already fixed on dev | (last card clears bar) + padding hardened to inset |
| QA-0255 | `/brand` | fixed | brand: domain suggested from brand name input (suggestedDomain), input no longer prefilled "Brandthread", green "Available" -> neutral "Suggested" |
| QA-0256 | `/ai-brand-memory` | fixed | ai-brand-memory inset |
| QA-0303 | `/location/demo` | invalid | no route file (hashtag/[tag], tag/[tag], p/[postId], place/[placeId], location/[placeId], quote-post, post-captions-edit), nothing links; dev renders +not-found with shared header (no feed/dashboard) |
| QA-0304 | `/add-product` | fixed | add-product: on web stepper TextInput rendered ~170px wide squeezing label -> fixed width 48 + label 1 line |
| QA-0305 | `/add-product` | fixed | add-product: on web stepper TextInput rendered ~170px wide squeezing label -> fixed width 48 + label 1 line |
| QA-0306 | `/product-editor` | fixed | product-editor redirects to add-product (same fix) |
| QA-0307 | `/post-captions-edit` | invalid | no route file (hashtag/[tag], tag/[tag], p/[postId], place/[placeId], location/[placeId], quote-post, post-captions-edit), nothing links; dev renders +not-found with shared header (no feed/dashboard) |
| QA-0308 | `/post-captions-edit` | invalid | no route file (hashtag/[tag], tag/[tag], p/[postId], place/[placeId], location/[placeId], quote-post, post-captions-edit), nothing links; dev renders +not-found with shared header (no feed/dashboard) |
| QA-0318 | `/product-pairings` | invalid | routes don't exist on dev (product-pairings, product-questions, products-bulk-edit, size-chart-templates, size-chart-template-edit, waitlist-demand) -> +not-found |
| QA-0320 | `/content` | invalid | (demo): no seller posts preview module; signed-out preview no longer calls protected posts API |
| QA-0328 | `/seller-drop-preview` | fixed | seller-drop-preview: MissingItemState for no id; header+error+retry on failure |
| QA-0329 | `/seller-drop-preview` | fixed | seller-drop-preview: MissingItemState for no id; header+error+retry on failure |
| QA-0330 | `/seller-profile` | fixed | seller-profile bare route -> "Profile not found" MissingItemState instead of connection error |
| QA-0335 | `/customer-accounts` | fixed | customer-accounts placeholder: Customers rows (More, Seller Control Center) now open /customers; screen redirects to /customers |
| QA-0336 | `/customer-events` | fixed | customer-events/privacy placeholders: no entry points; redirect to /seller-settings |
| QA-0339 | `/customer-privacy` | fixed | customer-events/privacy placeholders: no entry points; redirect to /seller-settings |
| QA-0340 | `/customers` | fixed | empty-state description shown; demo customers invalid (test requires honest empty state, no module) |
| QA-0341 | `/` | fixed | SellerDashboardSetupCard: card PressableScale role=button wrapped PrimaryButton -> nested <button>; card role none |
| QA-0346 | `/p/demo` | invalid | no route file (hashtag/[tag], tag/[tag], p/[postId], place/[placeId], location/[placeId], quote-post, post-captions-edit), nothing links; dev renders +not-found with shared header (no feed/dashboard) |
| QA-0347 | `/p/demo` | invalid | no route file (hashtag/[tag], tag/[tag], p/[postId], place/[placeId], location/[placeId], quote-post, post-captions-edit), nothing links; dev renders +not-found with shared header (no feed/dashboard) |
| QA-0352 | `/delete-account` | fixed | delete-account inset (Keep my account scrolls clear on 667pt) |
| QA-0371 | `/store-domain` | already fixed on dev | (subdomain card renders) + hardening: local domains shown immediately, preview skips protected store.domains() |
| QA-0372 | `/store-domain` | fixed | "Connect custom domain" single plus |
| QA-0373 | `/store-domain` | already fixed on dev | (subdomain card renders) + hardening: local domains shown immediately, preview skips protected store.domains() |
| QA-0379 | `/edit-profile` | fixed | edit-profile labels fixed width:100 wrapped on web -> minWidth 100, flexShrink 0 |
| QA-0380 | `/store-editor` | fixed | store-editor: web horizontal tab ScrollView stretched (stray bar = stretched underline) -> flexGrow 0 |
| QA-0381 | `/store-editor` | fixed | store-editor: web horizontal tab ScrollView stretched (stray bar = stretched underline) -> flexGrow 0 |
| QA-0382 | `/store-editor` | fixed | same + disabled undo/redo legible (MUTED) |
| QA-0383 | `/store-editor` | fixed | same + list bottom padding = tab bar inset |
| QA-0384 | `/design-prompt-edit` | fixed | design-prompt-edit ScreenHeader |
| QA-0385 | `/design-prompt-edit` | fixed | design-prompt-edit ScreenHeader |
| QA-0386 | `/design-prompt-edit` | fixed | flex:1 went to PressableScale inner view -> buttons full-width equal |
| QA-0391 | `/design-export` | fixed | design-export: no/unknown projectId -> MissingItemState; real project renders DesignLayerCompositor thumbnail |
| QA-0392 | `/design-export` | fixed | design-export: no/unknown projectId -> MissingItemState; real project renders DesignLayerCompositor thumbnail |
| QA-0393 | `/featured-slot` | invalid | routes don't exist on dev (seller-push-broadcast(-results), featured-slot, growth-link-detail/new, email-campaign-compose/results, seller-questions) - screenshot = +not-found |
| QA-0400 | `/seller-push-broadcast` | invalid | routes don't exist on dev (seller-push-broadcast(-results), featured-slot, growth-link-detail/new, email-campaign-compose/results, seller-questions) - screenshot = +not-found |
| QA-0401 | `/connections` | fixed | connections tabs: PressableScale didn't pass flex:1 -> wrapped in flex slots + 16px gutter |
| QA-0402 | `/connections` | fixed | connections tabs: PressableScale didn't pass flex:1 -> wrapped in flex slots + 16px gutter |
| QA-0403 | `/connections` | fixed | connections: Clerk never loads in preview -> load() returned early; now "No followers yet" |
| QA-0404 | `/following` | fixed | following: ScreenHeader w/ back; duplicate "No drops yet" status hidden; empty text size standard |
| QA-0405 | `/freelancer-jobs` | fixed | freelancer-jobs: Clerk never loads in signed-out preview -> load() returned early forever; now empty state / error+retry; title "Freelance jobs" |
| QA-0406 | `/freelancer-jobs` | fixed | freelancer-jobs: Clerk never loads in signed-out preview -> load() returned early forever; now empty state / error+retry; title "Freelance jobs" |
| QA-0419 | `/store-from-logo` | fixed | store-from-logo/moodboard: Clerk never loads in signed-out preview -> restore waited forever |
| QA-0420 | `/store-from-moodboard` | fixed | store-from-logo/moodboard: Clerk never loads in signed-out preview -> restore waited forever |
| QA-0421 | `/store-from-moodboard` | fixed | store-from-logo/moodboard: Clerk never loads in signed-out preview -> restore waited forever |
| QA-0422 | `/store-from-moodboard` | fixed | title "Mood board" |
| QA-0423 | `/store-from-moodboard` | fixed | title/spinner/duplicate callout removed; grey Analyze button = correct disabled state (0 images) of shared PrimaryButton |
| QA-0424 | `/store-from-moodboard` | fixed | title "Mood board" |
| QA-0437 | `/help` | already fixed on dev | (Send visible above bar) + padding hardened |
| QA-0443 | `/product-import` | fixed | product-import ScreenHeader "Import products" |
| QA-0444 | `/product-import` | fixed | + spacing, chevrons instead of green pills, Shopify tile neutral |
| QA-0445 | `/store-ai-improve` | already fixed on dev | (suggestions load) + hardening: storeService.getStorefront skips api.store.get in preview; loader shown |
| QA-0446 | `/store-ai-improve` | already fixed on dev | (suggestions load) + hardening: storeService.getStorefront skips api.store.get in preview; loader shown |
| QA-0447 | `/store-ai-improve` | fixed | visible loader while loading |
| QA-0448 | `/store-ai-improve` | already fixed on dev | (suggestions load) + hardening: storeService.getStorefront skips api.store.get in preview; loader shown |
| QA-0449 | `/invite-manufacturer` | fixed | invite-manufacturer: preview skips protected getInvitations (8s config wait) -> "No invites yet"; tab bar inset |
| QA-0450 | `/invite-manufacturer` | fixed | spinner; 'Apple Pay checkbox' invalid (feature bullet, not form field) |
| QA-0451 | `/invite-manufacturer` | fixed | invite-manufacturer: preview skips protected getInvitations (8s config wait) -> "No invites yet"; tab bar inset |
| QA-0460 | `/languages` | fixed | languages: buyers get App language picker (buyer settings), no store copy, no seller API |
| QA-0461 | `/languages` | fixed | languages inset; Arabic native name left aligned |
| QA-0462 | `/languages` | fixed | languages inset; Arabic native name left aligned |
| QA-0463 | `/launch-checklist` | invalid | app/launch-checklist.tsx doesn't exist on dev (Not found screen) |
| QA-0466 | `/growth-link-detail` | invalid | routes don't exist on dev (seller-push-broadcast(-results), featured-slot, growth-link-detail/new, email-campaign-compose/results, seller-questions) - screenshot = +not-found |
| QA-0473 | `/location/demo` | invalid | no route file (hashtag/[tag], tag/[tag], p/[postId], place/[placeId], location/[placeId], quote-post, post-captions-edit), nothing links; dev renders +not-found with shared header (no feed/dashboard) |
| QA-0476 | `/login-methods` | fixed | login-methods: spinner waited on Clerk isLoaded forever -> error+Retry after 4s; title "Login methods" |
| QA-0477 | `/login-methods` | fixed | login-methods: spinner waited on Clerk isLoaded forever -> error+Retry after 4s; title "Login methods" |
| QA-0478 | `/login-methods` | fixed | login-methods: spinner waited on Clerk isLoaded forever -> error+Retry after 4s; title "Login methods" |
| QA-0479 | `/login-methods` | fixed | login-methods: spinner waited on Clerk isLoaded forever -> error+Retry after 4s; title "Login methods" |
| QA-0486 | `/manufacturer` | fixed | (partly invalid) chip row edge-bleed; other overlap is normal list-under-sticky clipping, tabs already faded |
| QA-0487 | `/manufacturer-hub` | fixed | Clear filters only when filters active; list already pads 120 |
| QA-0491 | `/manufacturer-onboard` | fixed | manufacturer-onboard CTA above tab bar |
| QA-0494 | `/metafields` | fixed | title "Metafields" |
| QA-0495 | `/design-mockup-preview` | fixed | design-mockup-preview MissingItemState (padded Go back), "Mockup preview" |
| QA-0497 | `/design-mockup-preview` | fixed | design-mockup-preview MissingItemState (padded Go back), "Mockup preview" |
| QA-0498 | `/design-mockup-to-model` | fixed | mockup-to-model Create photos dock fixed footer below form |
| QA-0500 | `/muted-words` | fixed | muted-words: load() returned early w/o Clerk -> guest list + "No muted words yet"; placeholder "Add a word or #hashtag"; top padding |
| QA-0501 | `/muted-words` | fixed | muted-words: load() returned early w/o Clerk -> guest list + "No muted words yet"; placeholder "Add a word or #hashtag"; top padding |
| QA-0502 | `/muted-words` | fixed | muted-words: load() returned early w/o Clerk -> guest list + "No muted words yet"; placeholder "Add a word or #hashtag"; top padding |
| QA-0503 | `/muted-words` | fixed | muted-words: load() returned early w/o Clerk -> guest list + "No muted words yet"; placeholder "Add a word or #hashtag"; top padding |
| QA-0505 | `/seller-reviews` | fixed | seller-reviews: loading = !clerkLoaded never resolved in preview; error state now rendered w/ retry |
| QA-0506 | `/seller-reviews` | fixed | seller-reviews: loading = !clerkLoaded never resolved in preview; error state now rendered w/ retry |
| QA-0511 | `/store-nav` | fixed | store-nav "Add item" single icon; secondary link only when items exist |
| QA-0512 | `/store-nav` | fixed | store-nav "Add item" single icon; secondary link only when items exist |
| QA-0513 | `/store-nav` | fixed | store-nav "Add item" single icon; secondary link only when items exist |
| QA-0514 | `/product-bundle-edit` | fixed | product-bundle-edit ScreenHeader, 16px margins, Add product hidden until saved, $ inside field |
| QA-0515 | `/email-campaign-compose` | invalid | routes don't exist on dev (seller-push-broadcast(-results), featured-slot, growth-link-detail/new, email-campaign-compose/results, seller-questions) - screenshot = +not-found |
| QA-0516 | `/seller-drop-create` | fixed | seller-drop-create tab bar inset; removed helper paragraph |
| QA-0521 | `/growth-link-new` | invalid | routes don't exist on dev (seller-push-broadcast(-results), featured-slot, growth-link-detail/new, email-campaign-compose/results, seller-questions) - screenshot = +not-found |
| QA-0522 | `/size-chart-template-edit` | invalid | routes don't exist on dev (product-pairings, product-questions, products-bulk-edit, size-chart-templates, size-chart-template-edit, waitlist-demand) -> +not-found |
| QA-0523 | `/size-chart-template-edit` | invalid | routes don't exist on dev (product-pairings, product-questions, products-bulk-edit, size-chart-templates, size-chart-template-edit, waitlist-demand) -> +not-found |
| QA-0548 | `/profile` | fixed | profile stats settle to 0 in preview (authLoaded never set) |
| QA-0551 | `/manufacturer-product` | fixed | manufacturer-product MissingItemState when no ids |
| QA-0552 | `/product-detail` | fixed | product-detail -> ScreenHeader (Edit/... kept) |
| QA-0553 | `/product-detail` | fixed | product-detail -> ScreenHeader (Edit/... kept) |
| QA-0554 | `/product-detail` | fixed | no id -> MissingItemState "Product not found"; real failure keeps retry |
| QA-0559 | `/product-store` | fixed | product-store MissingItemState w/ header; getProduct failure no longer stuck on Loading |
| QA-0560 | `/product-store` | fixed | product-store MissingItemState w/ header; getProduct failure no longer stuck on Loading |
| QA-0567 | `/products` | fixed | via demo catalog rename in lib/previewSellerProducts.ts (names now match photos; see 0759) |
| QA-0570 | `/store/preview_studio` | invalid | app/store/[handle].tsx doesn't exist on dev; route renders standard Not found |
| QA-0571 | `/store/preview_studio` | invalid | app/store/[handle].tsx doesn't exist on dev; route renders standard Not found |
| QA-0572 | `/store/preview_studio` | invalid | app/store/[handle].tsx doesn't exist on dev; route renders standard Not found |
| QA-0573 | `/store/preview_studio` | invalid | app/store/[handle].tsx doesn't exist on dev; route renders standard Not found |
| QA-0577 | `/store-publish` | fixed | (spinner resolves on dev) Copy preview link padding, tab bar inset |
| QA-0578 | `/store-publish` | already fixed on dev | (checklist renders) |
| QA-0581 | `/seller-push-broadcast-results` | invalid | routes don't exist on dev (seller-push-broadcast(-results), featured-slot, growth-link-detail/new, email-campaign-compose/results, seller-questions) - screenshot = +not-found |
| QA-0582 | `/seller-push-broadcast-results` | invalid | routes don't exist on dev (seller-push-broadcast(-results), featured-slot, growth-link-detail/new, email-campaign-compose/results, seller-questions) - screenshot = +not-found |
| QA-0585 | `/product-questions` | invalid | routes don't exist on dev (product-pairings, product-questions, products-bulk-edit, size-chart-templates, size-chart-template-edit, waitlist-demand) -> +not-found |
| QA-0586 | `/product-questions` | invalid | routes don't exist on dev (product-pairings, product-questions, products-bulk-edit, size-chart-templates, size-chart-template-edit, waitlist-demand) -> +not-found |
| QA-0588 | `/seller-questions` | invalid | routes don't exist on dev (seller-push-broadcast(-results), featured-slot, growth-link-detail/new, email-campaign-compose/results, seller-questions) - screenshot = +not-found |
| QA-0589 | `/quote-post` | invalid | no route file (hashtag/[tag], tag/[tag], p/[postId], place/[placeId], location/[placeId], quote-post, post-captions-edit), nothing links; dev renders +not-found with shared header (no feed/dashboard) |
| QA-0590 | `/quote-post` | invalid | no route file (hashtag/[tag], tag/[tag], p/[postId], place/[placeId], location/[placeId], quote-post, post-captions-edit), nothing links; dev renders +not-found with shared header (no feed/dashboard) |
| QA-0593 | `/quote-detail` | fixed | quote-detail: `if(!quoteId) return` never cleared loading -> Quote not found; error -> retry |
| QA-0594 | `/quote-detail` | fixed | quote-detail: `if(!quoteId) return` never cleared loading -> Quote not found; error -> retry |
| QA-0601 | `/ip-report` | fixed | ip-report ScreenHeader |
| QA-0602 | `/ip-report` | fixed | ip-report ScreenHeader |
| QA-0603 | `/ip-report` | fixed | ip-report tab bar inset |
| QA-0606 | `/rfq-post` | fixed | rfq-post footer above tab bar; title sentence case; deadline placeholder example date |
| QA-0607 | `/rfq-post` | fixed | rfq-post footer above tab bar; title sentence case; deadline placeholder example date |
| QA-0608 | `/rfq-post` | fixed | rfq-post footer above tab bar; title sentence case; deadline placeholder example date |
| QA-0609 | `/rfq-post` | fixed | rfq-post footer above tab bar; title sentence case; deadline placeholder example date |
| QA-0616 | `/email-campaign-results` | invalid | routes don't exist on dev (seller-push-broadcast(-results), featured-slot, growth-link-detail/new, email-campaign-compose/results, seller-questions) - screenshot = +not-found |
| QA-0618 | `/admin-reports` | fixed | admin-reports: preview skips protected moderation.me (hung) -> Moderator access required; active chip filled |
| QA-0619 | `/product-reviews` | fixed | product-reviews: no productId -> loading never false; MissingItemState, error+retry, empty state, inset |
| QA-0627 | `/sample-detail` | fixed | sample-detail same root cause |
| QA-0628 | `/sample-detail` | fixed | sample-detail same root cause |
| QA-0637 | `/security` | fixed | security copy "Login activity — Review recent sign-ins"; Download row doesn't exist on dev |
| QA-0638 | `/security` | fixed | security copy "Login activity — Review recent sign-ins"; Download row doesn't exist on dev |
| QA-0639 | `/products-bulk-edit` | invalid | routes don't exist on dev (product-pairings, product-questions, products-bulk-edit, size-chart-templates, size-chart-template-edit, waitlist-demand) -> +not-found |
| QA-0640 | `/products-bulk-edit` | invalid | routes don't exist on dev (product-pairings, product-questions, products-bulk-edit, size-chart-templates, size-chart-template-edit, waitlist-demand) -> +not-found |
| QA-0656 | `/store-seo` | fixed | store-seo duplicate Save SEO removed (header Save remains), tab bar inset |
| QA-0657 | `/store-seo` | fixed | demo store name/handle in Google preview; blue/green -> FG/MUTED tokens |
| QA-0659 | `/seller-settings` | fixed | seller-settings is a stack push -> back arrow (variant modal removed); Sign out not red |
| QA-0662 | `/share-profile` | fixed | share-profile: loading never cleared w/o user -> "No username set"; demo card invalid (no preview seed module) |
| QA-0663 | `/share-store` | fixed | share-store demo identity (Thread & Co) + tab-bar inset, no protected call in preview |
| QA-0664 | `/share-store` | fixed | fresh account -> "Set up your store" empty state; title "Share store" |
| QA-0669 | `/profile-products` | fixed | profile-products: no sellerId -> MissingItemState; ScreenHeader titled seller name/"Shop"/"Your shop" |
| QA-0670 | `/profile-products` | fixed | profile-products: no sellerId -> MissingItemState; ScreenHeader titled seller name/"Shop"/"Your shop" |
| QA-0671 | `/profile-products` | fixed | profile-products: no sellerId -> MissingItemState; ScreenHeader titled seller name/"Shop"/"Your shop" |
| QA-0672 | `/profile-products` | fixed | profile-products: no sellerId -> MissingItemState; ScreenHeader titled seller name/"Shop"/"Your shop" |
| QA-0674 | `/shopping-preferences` | fixed | shopping-preferences save bar inset |
| QA-0675 | `/shopping-preferences` | fixed | shopping-preferences save bar inset |
| QA-0676 | `/shopping-preferences` | invalid | no "My sizes" screen on dev; this is the only size editor |
| QA-0677 | `/shopping-preferences` | fixed | DEFAULT_BUYER_SETTINGS no longer preset M/32/10 |
| QA-0678 | `/shopping-preferences` | fixed | inset + "Your sizes"/"Preferred fit" |
| QA-0679 | `/shopping-preferences` | fixed | shopping-preferences save bar inset |
| QA-0682 | `/product-size-chart` | fixed | product-size-chart ScreenHeader; columns share width (Length fits); header shading from Size |
| QA-0683 | `/product-size-chart` | fixed | product-size-chart ScreenHeader; columns share width (Length fits); header shading from Size |
| QA-0685 | `/size-chart-templates` | invalid | routes don't exist on dev (product-pairings, product-questions, products-bulk-edit, size-chart-templates, size-chart-template-edit, waitlist-demand) -> +not-found |
| QA-0686 | `/size-chart-templates` | invalid | routes don't exist on dev (product-pairings, product-questions, products-bulk-edit, size-chart-templates, size-chart-template-edit, waitlist-demand) -> +not-found |
| QA-0687 | `/c/demo` | fixed | c/[collectionId]: MissingItemState w/ header; error -> Retry (reloadKey); 401/403 = not found |
| QA-0689 | `/c/demo` | fixed | c/[collectionId]: MissingItemState w/ header; error -> Retry (reloadKey); 401/403 = not found |
| QA-0690 | `/c/demo` | fixed | header; demo content invalid (no collection preview seed) |
| QA-0691 | `/c/demo` | fixed | c/[collectionId]: MissingItemState w/ header; error -> Retry (reloadKey); 401/403 = not found |
| QA-0692 | `/c/demo` | fixed | c/[collectionId]: MissingItemState w/ header; error -> Retry (reloadKey); 401/403 = not found |
| QA-0695 | `/store-builder` | fixed | store-builder -> ScreenHeader, headline moved into black content |
| QA-0697 | `/store-builder` | fixed | store-builder -> ScreenHeader, headline moved into black content |
| QA-0704 | `/store-policies` | fixed | store-policies preview skips protected/paid APIs, uses local template |
| QA-0705 | `/store-policies` | fixed | store-policies preview skips protected/paid APIs, uses local template |
| QA-0708 | `/store-settings` | fixed | store-settings scroll padding + tab bar inset |
| QA-0709 | `/store-settings` | fixed | URL suffix minWidth/flexShrink stays inside card |
| QA-0710 | `/store-settings` | fixed | URL suffix minWidth/flexShrink stays inside card |
| QA-0711 | `/store-settings` | fixed | URL suffix minWidth/flexShrink stays inside card |
| QA-0712 | `/store-settings` | fixed | (form loads on dev) header Save disabled while loading |
| QA-0713 | `/store-settings` | fixed | Require Account description wraps 2 lines |
| QA-0714 | `/setup` | fixed | setup paddingTop, 2-line descriptions, tab bar inset, no protected auth.me in preview |
| QA-0718 | `/store-theme-picker` | fixed | theme picker 16px gutter + tab bar inset (+desc wraps) |
| QA-0719 | `/store-theme-picker` | fixed | theme picker 16px gutter + tab bar inset (+desc wraps) |
| QA-0720 | `/store-theme-picker` | partly fixed | gutter, monochrome CURRENT badge, desc wraps; real theme screenshots don't exist in repo (gradient previews kept) |
| QA-0721 | `/store-theme-picker` | fixed | theme picker 16px gutter + tab bar inset (+desc wraps) |
| QA-0722 | `/store-theme-picker` | partly fixed | gutter, monochrome CURRENT badge, desc wraps; real theme screenshots don't exist in repo (gradient previews kept) |
| QA-0723 | `/store-theme-picker` | fixed | theme picker 16px gutter + tab bar inset (+desc wraps) |
| QA-0736 | `/design-templates` | fixed | templates chip ScrollView shrank under flex:1 grid -> flexGrow/Shrink 0 |
| QA-0737 | `/design-templates` | fixed | templates chip ScrollView shrank under flex:1 grid -> flexGrow/Shrink 0 |
| QA-0738 | `/design-templates` | fixed | templates chip ScrollView shrank under flex:1 grid -> flexGrow/Shrink 0 |
| QA-0739 | `/design-templates` | fixed | chips + off-palette gradients -> neutral silver tiles; tab bar inset |
| QA-0740 | `/design-templates` | fixed | chips + off-palette gradients -> neutral silver tiles; tab bar inset |
| QA-0748 | `/design-upload-sketch` | fixed | design-upload-sketch ScreenHeader |
| QA-0752 | `/profile-videos` | fixed | profile-videos MissingItemState; shorter message, no orphan |
| QA-0753 | `/profile-videos` | fixed | profile-videos MissingItemState; shorter message, no orphan |
| QA-0754 | `/profile-videos` | fixed | profile-videos MissingItemState; shorter message, no orphan |
| QA-0755 | `/waitlist-demand` | invalid | routes don't exist on dev (product-pairings, product-questions, products-bulk-edit, size-chart-templates, size-chart-template-edit, waitlist-demand) -> +not-found |
| QA-0759 | `/store-preview` | fixed | demo product names match photos; sold-out legible; frame sized to available height |
| QA-0762 | `/hashtag/streetwear` | invalid | no route file (hashtag/[tag], tag/[tag], p/[postId], place/[placeId], location/[placeId], quote-post, post-captions-edit), nothing links; dev renders +not-found with shared header (no feed/dashboard) |
| QA-0763 | `/hashtag/streetwear` | invalid | no route file (hashtag/[tag], tag/[tag], p/[postId], place/[placeId], location/[placeId], quote-post, post-captions-edit), nothing links; dev renders +not-found with shared header (no feed/dashboard) |
| QA-0764 | `/hashtag/streetwear` | invalid | no route file (hashtag/[tag], tag/[tag], p/[postId], place/[placeId], location/[placeId], quote-post, post-captions-edit), nothing links; dev renders +not-found with shared header (no feed/dashboard) |
| QA-0766 | `/tag/streetwear` | invalid | no route file (hashtag/[tag], tag/[tag], p/[postId], place/[placeId], location/[placeId], quote-post, post-captions-edit), nothing links; dev renders +not-found with shared header (no feed/dashboard) |
| QA-0767 | `/tag/streetwear` | invalid | no route file (hashtag/[tag], tag/[tag], p/[postId], place/[placeId], location/[placeId], quote-post, post-captions-edit), nothing links; dev renders +not-found with shared header (no feed/dashboard) |
| QA-0770 | `/` | invalid | clipped text is collapsed Shop strip at opacity 0; expanded strip >=180px, price flexShrink 0 |
| QA-0771 | `/` | fixed | FeedGestureGuide: BlurView + 38% dim removed -> opaque surface (2x glyph already centered in same 56px slot) |
| QA-0775 | `/cookie-banner` | fixed | dashboard Orders tile label carries range (ORDERS TODAY) vs open orders to ship |
| QA-0776 | `/design` | fixed | /design ScreenHeader "Brandthread Studio" |
| QA-0778 | `/forgot-password` | fixed | forgot-password copy "reset code" |
| QA-0786 | `/more` | fixed | more warning-tinted tiles -> neutral muted |
| QA-0787 | `/more` | fixed | more warning-tinted tiles -> neutral muted |
| QA-0788 | `/more` | fixed | more warning-tinted tiles -> neutral muted |
| QA-0789 | `/more` | fixed | Payouts description fits |
| QA-0792 | `/onboarding` | already fixed on dev | : white Get started; no Browse as guest |