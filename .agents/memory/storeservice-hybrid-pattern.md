---
name: StoreService Hybrid Pattern
description: storeService.ts uses AsyncStorage as local truth for complex UI state, with fire-and-forget API sync for publishable data.
---

## Pattern
storeService.ts has 40+ functions managing a deeply nested `Storefront` type (sections, collections, pages, menus, undo/redo, etc.). Rewriting the entire service to use real API would require changing all 18+ screen imports.

**Solution:** hybrid approach:
1. AsyncStorage = primary store for all complex UI state (undo/redo, collections, pages, menus).
2. `getStorefront()` loads from AsyncStorage, then overlays server state (publishStatus, publishedAt, slug).
3. `saveStorefront()` saves to AsyncStorage AND fires a best-effort API sync (title, theme, branding, sections, seo).
4. `publishStore()` / `unpublishStore()` call real API after local save.
5. AI generation functions (generateStoreFromAnswers, generateFromLogo, generateFromMoodBoard) try real API first, fall back to local mock if it fails.

**Why:** Keeps all 18+ store-builder screen imports unchanged. No function signatures changed. The Storefront type is too complex to map 1:1 to the DB schema.

## API sync payload (saveStorefront)
Syncs: title, description, theme (primaryColor, secondaryColor, backgroundColor, textColor, fontFamily, borderRadius), branding (tagline, logoUrl, targetAudience), sections (type, title, enabled, settings), seo (metaTitle, metaDescription).

Does NOT sync: collections, pages, policies, menus, undo/redo stacks, aiSuggestions. These are AsyncStorage-only.

## AI endpoints
`generateStoreFromAnswers` → `POST /api/store/ai/generate`
`generateFromLogo` → `POST /api/store/ai/from-logo`
`generateFromMoodBoard` → `POST /api/store/ai/from-moodboard`

All use generateText from @workspace/integrations-openai-ai-server/text (not vision client).
