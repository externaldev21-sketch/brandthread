---
name: Store Builder Architecture
description: Brandthread AI Store Builder — file list, storage keys, Metro crash rules, service constraints.
---

## Files
- `services/storeTypes.ts` — all 23 typed models + BUILTIN_THEMES (18), SECTION_TYPE_LABELS, COLOR_PRESETS, BRAND_STYLES, BRAND_MOODS, HOMEPAGE_PRIORITIES, TARGET_CUSTOMERS, STORE_FEATURES, STORE_CONTENT_OPTIONS, TYPOGRAPHY_STYLES, AI_SUGGESTION_POOL
- `services/storeService.ts` — AsyncStorage CRUD; key: `bt:store:v1`, `bt:store:draft_answers:v1`; exports StoreValidationResult (NOT in storeTypes); mock AI generation separated into pure functions
- 20 store-*.tsx screens in app/

## Screens
store-builder (entry/home), store-generate (10-step wizard), store-generating (animated generation),
store-theme-picker (18-theme library), store-preview (phone-frame preview), store-editor (section/branding/header/footer tabs),
store-sections (add section picker), store-collections (CRUD), store-pages (CRUD), store-nav (menu management),
store-settings, store-policies (AI policy draft), store-seo, store-domain, store-publish (validate+publish flow),
store-versions, store-from-logo, store-from-moodboard, store-from-social, store-ai-improve

## Routes in _layout.tsx
All 19 store-* routes registered. store-generating, store-publish, store-ai-improve use presentation: 'modal'.

## Navigation integrations
- more.tsx STORE section: Store Builder→/store-builder, Collections→/store-collections, Domains→/store-domain
- store-builder accessible from seller home, more, setup checklist

## Critical rules
1. **NO dynamic `await import()`** in storeService.ts — Metro Babel crashes on duplicate binding for destructured names (BORDER, SECTION_TYPE_LABELS, etc.). Use top-level static imports only.
2. **StoreValidationResult** is exported from storeService, NOT storeTypes. Import from storeService.
3. **COLOR_PRESETS** is NOT exported from storeService. Import from storeTypes.
4. **BrandMood** does NOT include 'minimal' — valid values: premium, clean, bold, futuristic, cozy, dark, colorful, editorial, exclusive, playful, raw, artistic.
5. Same Metro crash rule for all screen files: no local const with same name as @/lib/theme exports.

**Why:** Dynamic imports compile to function-scoped `const { X } = require(...)` which Babel sees as duplicate when X is also in module scope. Static imports are always safe.
