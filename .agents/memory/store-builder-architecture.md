---
name: Store Builder Architecture
description: Durable Store Builder constraints, including Thread Theme and Metro safety rules.
---

## Thread Theme
Thread Theme is the sole starting template for new Brandthread storefronts. Keep it original to Brandthread: editorial typography, generous whitespace, full-bleed monochrome imagery, and restrained product chrome.

**Why:** The product intentionally replaced the template chooser with one recognizable Brandthread storefront foundation.

**How to apply:** Logo, moodboard, social, and other AI tools may personalize imagery, copy, and sections, but must preserve the grayscale palette and Thread Theme identity. Keep those tools optional inside the editor, not as competing entry paths.

## Critical rules
1. **NO dynamic `await import()`** in storeService.ts — Metro Babel crashes on duplicate binding for destructured names (BORDER, SECTION_TYPE_LABELS, etc.). Use top-level static imports only.
2. **StoreValidationResult** is exported from storeService, NOT storeTypes. Import from storeService.
3. **COLOR_PRESETS** is NOT exported from storeService. Import from storeTypes.
4. **BrandMood** does NOT include 'minimal' — valid values: premium, clean, bold, futuristic, cozy, dark, colorful, editorial, exclusive, playful, raw, artistic.
5. Same Metro crash rule for all screen files: no local const with same name as @/lib/theme exports.

**Why:** Dynamic imports compile to function-scoped `const { X } = require(...)` which Babel sees as duplicate when X is also in module scope. Static imports are always safe.
