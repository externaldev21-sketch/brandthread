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

**Critical rule:** Do NOT redeclare any theme constant locally — Metro bundler throws "Duplicate declaration" at runtime even if TypeScript doesn't catch it (Babel scope check). Always import from '@/lib/theme'.

## Shared Components (components/BrandthreadUI.tsx)
style props accept StyleProp<ViewStyle> (not ViewStyle) — arrays work fine.

## Products System
### Foundation files
- `services/productTypes.ts` — all typed models: Product, ProductMedia, ProductVariant, ProductOption, ProductInventory, ProductPricing, ProductPreorderSettings, ProductFulfillment, ProductManufacturing, ProductStoreSettings, ProductSEO, ProductAnalytics, ProductCollection, ProductTag, ProductDraft, ProductFilter, ProductSearchQuery, SalesModel enum, PRODUCT_CATEGORIES, SIZE_PRESETS, COLOR_PRESETS
- `services/productService.ts` — async CRUD + demo data: getProducts, getProduct, getProductById, createProduct, updateProduct, publishProduct, scheduleProduct, archiveProduct, unarchiveProduct, deleteProduct, duplicateProduct, adjustInventory, getProductAnalytics, getCollections, saveDraft, loadDraft, deleteDraft, getTaggableProducts, getProductStats. AsyncStorage-backed. DEMO_FULL_PRODUCTS (4 products).
- `lib/productUtils.ts` — pure utils: calcPricing (guards against division by zero, compareAtPrice=0 treated as undefined), formatCurrency, formatPercent, generateVariantCombinations, buildVariantTitle, calcTotalInventory, isLowStock, isOutOfStock, validateForPublish

### createProduct id pattern
id is assigned at top of object literal — do NOT add a second `id` field at the bottom (TS1117 duplicate property error).

### getProducts filter values
'all' | 'active' | 'draft' | 'scheduled' | 'archived' | 'pre-order' | 'pre-made' | 'low-stock' | 'out-of-stock'
'pre-made' matches salesModel === 'pre-made' OR salesModel === 'both'.

## Screens
### add-product.tsx (10-step flow)
- Draft load on mount: useEffect reads params.editId → loadDraft → restores all state
- publishing state prevents double-tap; Publish button disabled while publishing
- handleSaveDraftInPlace() — header save: saves, shows Alert, does NOT navigate away
- handleSaveDraftAndExit() — step-10 save: saves + router.back()
- handlePublish: validates (empty name, negative price, compare-at ≤ retail, date order, duplicate SKUs), then createProduct, then routes to /product-detail?id=... 
- Variant qty totals feed into inventory.totalStock/availableStock before publish
- Step 4 variant rows have delete button (trash icon)
- Step 6 pre-order has minOrderQty, maxOrderQty, productionStartDate fields

### product-detail.tsx (8-tab detail)
- Tab param: reads params.tab and sets initial activeTab
- Inventory tab: doAdjust(delta, reason) calls adjustInventory then reloads product
- Variant tab: bulk edit price/inventory via updateProduct; NOT a placeholder
- Analytics: lazy-loaded when tab becomes active; bar heights scaled by maxRev
- Store page tab: "Open full preview" → /product-store?id=...
- Edit FAB → /add-product?editId=...
- Back: always router.back()

### products.tsx tab
- loadStats called inside loadProducts (not separate useEffect)
- Filter chips show live counts from stats: "Active (3)", "Draft (1)", etc.
- 10 action sheet actions: Edit, View store page, Create content, Tag in post, Duplicate, Share, Send to manufacturer, View analytics, Archive/Unarchive, Delete
- Product card renders actual cover image (Image from react-native) if URI starts with 'http'

### product-store.tsx (buyer page)
- Loads via getProduct(id), falls back to DEMO_FULL_PRODUCTS[0]
- Variant selection updates effectivePrice = selectedVariant.price ?? product.pricing.price
- Pre-order section: shows openDate, closeDate, estimatedShippingDate, funding progress
- Add to cart: haptics + Alert (demo mode)
- Back: router.back()

### product-import.tsx
- CSV: template content shown in Alert (no file system needed)
- Shopify: "coming soon" notice
- Manual bulk: saveDraft called per product name, importing state prevents double-tap

### seller-profile.tsx
- Products tab: loads from getProducts({ filter: 'active' }), falls back to DEMO_PRODUCTS
- isOwner=true → /product-detail?id=...; isOwner=false (buyer) → /product-store?id=...
- Product card: renders media[0].uri if valid URL, otherwise LinearGradient placeholder

## Content tagging
- create-post.tsx: uses getTaggableProducts() from productService (NOT DEMO_PRODUCTS_FOR_TAG)
- Post preview shows shopping bag badge if productTags.length > 0

## Buyer Thread
- feed.tsx handleShop: routes to /product-store?id=productId (NOT /checkout)
- SpotlightItem.productId field used as product identifier

## Navigation routes in _layout.tsx
- add-product (slide_from_right)
- product-detail (slide_from_right)
- product-store (slide_from_right)
- product-import (modal from bottom)

## Design rule
GREEN is ONLY for: revenue, success states, completed tasks, available status, positive analytics. NEVER for buttons or tab bar. Purple/Cyan are primary.
