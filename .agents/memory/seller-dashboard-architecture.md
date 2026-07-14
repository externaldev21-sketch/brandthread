---
name: Seller Dashboard Architecture
description: Seller-side screen inventory, color system, service layer, shared component system, and navigation patterns for Brandthread mobile app.
---

## Design System (lib/theme.ts)
Single source of truth — all seller screens MUST import from here, no local color redefinitions.
- BG='#07070F', SURFACE='#0C0C17', CARD='#12121F', CARD_ELEVATED='#18182E'
- BORDER='rgba(255,255,255,0.07)', BORDER_ACTIVE='rgba(139,92,246,0.45)'
- FG='#F4F4FF', MUTED='rgba(244,244,255,0.50)', SUBTLE='rgba(244,244,255,0.28)'
- PURPLE='#8B5CF6', CYAN='#22D3EE' — primary brand accents (NOT green)
- SUCCESS='#10B981', GREEN_BRIGHT='#39FF88' — green ONLY for revenue/success/completion
- GRAD_PRIMARY=['#8B5CF6','#22D3EE'] — primary button gradient
- GRAD_CARD_GLOW=['rgba(139,92,246,0.12)','rgba(34,211,238,0.04)'] — card glow

**Why:** Do NOT redeclare any theme constant locally — Metro bundler throws "Duplicate declaration" at runtime even if TypeScript doesn't catch it (Babel scope check). Always import from '@/lib/theme'.

## Shared Components (components/BrandthreadUI.tsx)
All screens must use these — never create one-off buttons or cards in screens.
Components: BrandthreadScreen, BrandthreadHeader, BrandthreadCard, GradientCard, PrimaryButton, SecondaryButton, IconButton, SearchBar, FilterChip, StatusBadge, EmptyState, SectionHeader, StatCard, QuickActionCard, GuidedTip, NewFeatureBadge, FormInput, ProgressCard, NavigationCard, LoadingSkeleton, Toast, SheetHandle
style props accept StyleProp<ViewStyle> (not ViewStyle) — arrays work fine.

## Products System (services/productTypes.ts + services/productService.ts + lib/productUtils.ts)
- **productTypes.ts** — all Product data model types: Product, ProductMedia, ProductVariant, ProductOption, OptionValue, ProductInventory, InventoryLocation, InventoryAdjustment, ProductPricing, ProductPreorderSettings, ProductFulfillment, ProductManufacturing, ProductStoreSettings, ProductSEO, ProductAnalytics, ProductCollection, ProductTag, ProductDraft, ProductFilter, ProductSearchQuery
- **productService.ts** — demo CRUD: getProducts, getProduct, createProduct, updateProduct, publishProduct, scheduleProduct, archiveProduct, unarchiveProduct, deleteProduct, duplicateProduct, adjustInventory, getProductAnalytics, getCollections, saveDraft, loadDraft, getTaggableProducts, getProductStats. AsyncStorage-backed with realistic DEMO_FULL_PRODUCTS (4 products).
- **productUtils.ts** — pricing calculations: calcPricing, formatCurrency, formatPercent, generateVariantCombinations, buildVariantTitle, calcTotalInventory, isLowStock, isOutOfStock, validateForPublish

## Setup Store (lib/setupStore.ts)
AsyncStorage-backed seller setup progress. 12 tasks from brand_profile → publish_store.
Functions: getSetupState, markSetupStarted, dismissWelcome, completeTask, skipTask, dismissTip, markFeatureOpened, completionPercent, nextTask, nextBestAction, resetSetupState

## Tab layout (seller)
`(tabs)/` group: Home (index) · Studio · Products · Orders · More
Tab bar: purple active indicator, PURPLE accent for active tab, dark BG '#07070F'

## Screen inventory (seller-specific)
- `(tabs)/index.tsx` — Seller home: welcome card, next-best-action, setup progress, stats, quick actions, "Go to" command menu, global search modal
- `(tabs)/studio.tsx` — Creative hub: tool cards (Design, Content, AI Photoshoot, Mockup to Model, BG Removal, Brand Kit), recent projects, templates
- `(tabs)/products.tsx` — Products tab: 9-filter strip, 6 summary stat cards, full product cards (image/status/price/variants/sales/action menu), action sheet with 10 actions, search, import, add
- `(tabs)/orders.tsx` — Orders: stat strip, search/filter, order cards with status actions
- `(tabs)/more.tsx` — Organized sections: Operations · Growth · Store · Account + sign out
- `(tabs)/profile.tsx` — "My Brand" dashboard (uses OLD green tokens — migrate to theme.ts when updating)
- `app/setup.tsx` — Guided setup: 12-task checklist, progress bar, skip/complete/save-and-exit
- `app/add-product.tsx` — 10-step product creation: Basic Info · Media · Pricing · Variants · Inventory · Sales Model · Fulfillment · Manufacturing · Storefront · Review & Publish
- `app/product-detail.tsx` — 8-tab detail: Overview · Variants · Inventory · Orders · Production · Content · Analytics · Store page
- `app/product-store.tsx` — Buyer product page preview: media gallery, variant selector, pre-order info, CTA, description accordion, related products
- `app/product-import.tsx` — Import: CSV · Shopify placeholder · Manual bulk entry + import history
- `app/seller-profile.tsx` — PUBLIC brand profile (buyers see this; sellers via isOwner=true)
- `app/create-post.tsx` — Full content creation flow (10 steps)
- `app/post-analytics.tsx` — Per-post analytics with animated charts
- `app/content.tsx` — Content management hub
- `app/edit-profile.tsx` — Edit seller brand profile
- `app/brand.tsx` — AI Brand Creation tool

## Registered routes in _layout.tsx (seller)
- seller-profile (slide_from_right)
- create-post (fullScreenModal from bottom)
- post-analytics (slide_from_right)
- setup (modal from bottom)
- add-product (slide_from_right)
- product-detail (slide_from_right)
- product-store (slide_from_right)
- product-import (modal from bottom)

## Thread eligibility rule
`getThreadEligiblePosts()` in sellerContent.ts filters: status=published + isSellerContent=true + scheduled date ≤ now. Buyer posts must NEVER appear in Thread.

## Navigation gotchas
- `router.push('/dynamic-string' as never)` — use `as never` for dynamically constructed paths to satisfy expo-router's typed routes. Otherwise TS2345 errors.
- `router.back()` triggers GO_BACK warning in dev when no stack history — dev-only, not a crash.
- Route groups: `/(tabs)/` for seller, `/(buyer)/` for buyer — do not mix them.
- `(tabs)/profile.tsx` still uses OLD green design tokens — next migration: update to use theme.ts + BrandthreadUI.

## Key design rule
Seller tabs use PURPLE/CYAN as primary (matches onboarding). GREEN is ONLY for: success states, revenue growth, completed tasks, available status, positive analytics. Never use green as a button color or tab bar color.

**Why:** July 2026 full visual unification of seller app with onboarding design system.
