---
name: Design Studio Architecture
description: Brandthread Design Studio service boundaries, image-reference contract, Metro crash rules, and navigation wiring.
---

## Service files
- `services/designTypes.ts` — all 20+ string union types, all interfaces, all constants (GARMENT_TYPES, GARMENT_TEMPLATES, CANVAS_PRESETS, AI_STYLES, MODEL_STYLES, SCENE_STYLES, LIGHTING_STYLES, CAMPAIGN_FORMATS, BRAND_ASSET_TYPES, PROJECT_STATUS_LABELS, PROJECT_TYPE_LABELS, DEFAULT_TRANSFORM)
- `services/designService.ts` owns AsyncStorage CRUD and every AI/provider call. Image-based tools convert source URIs to data URLs and send them as references; provider failures must surface instead of returning mock image URIs.

## Screens (all in app/)
design (home), design-project (6-step wizard), design-canvas (main editor, rewrite of old green canvas), design-garment, design-templates, design-brand-assets, design-text-to-design, design-upload-sketch, design-mockup-to-model, design-ai-photoshoot, design-prompt-edit, design-bg-removal (Studio version; separate from existing bg-removal.tsx), design-bg-replace, design-campaign, design-mockup-preview, design-export, design-versions

## Navigation
- All 17 design-* routes registered in _layout.tsx
- design-export uses presentation: 'modal'
- studio.tsx (tabs) loads getProjects() and shows recent designs section
- more.tsx has CREATIVE section: Design Studio, AI Photoshoot, Background Removal, Campaign Generator, Brand Assets

## Critical rules (same as Store Builder)
1. No local const named BG, SURFACE, CARD, BORDER, FG, MUTED, PURPLE, CYAN, etc. — Metro "Duplicate declaration" crash
2. No dynamic await import() — static top-level imports only
3. Keep AI/provider logic in designService, never in screen files. Any image-based operation must forward the real source image; text-only regeneration is not an acceptable fallback.
4. DesignLayerData uses textColor not color (DesignTextLayer.textColor), fillColor not fill (DesignShapeLayer.fillColor)

The primary editor must remain fully usable in stock Expo Go and on web; do not add a custom native canvas dependency or let device-only APIs load on unsupported platforms.

**Why:** Brandthread relies on stock Expo Go for device testing, while the same route must keep booting on web. Platform-specific creative features can pass TypeScript yet still crash at module load.

**How to apply:** Isolate device-only capabilities behind platform boundaries, fail explicitly when a format is unsupported, and verify both device-oriented behavior and web boot after editor changes.

**Why:** design-canvas.tsx was previously using hardcoded local color constants with theme names — rewritten to use @/lib/theme imports throughout.

The reference-image rule exists because multiple Studio tools accepted an uploaded URI but silently called text-only generation, making the upload irrelevant and displaying decorative placeholders instead of provider output.

**How to apply:** Convert local/remote source images before authenticated requests, use image editing when a reference exists, preserve the source subject explicitly in prompts, validate bytes server-side, and render returned image data directly.

Precision effects must use Expo-compatible SVG behavior and one shared render contract. Distort and Warp are explicit affine/vector approximations, not claimed as per-pixel mesh deformation; every persisted transform, curve, and liquify value must render identically in the editor, exports, and gallery.

**Why:** Tool panels can appear functional while saved effects disappear outside the editor. Absolute-positioned primitives also jump if an affine matrix adds their origin twice.

**How to apply:** Fit transforms from absolute source coordinates, include every visible control point, test non-origin layers, and route all render surfaces through the same effect helpers.

Per-design timers start only after project restoration while the app is active. Backgrounding and normal Back navigation must pause the timer, mark the project dirty, and persist before leaving.

**Why:** Persisted active timestamps are intentionally discarded on restore; saving before pausing silently loses elapsed design time.

**How to apply:** Treat timer pause and the following coordinated save as one ordered operation. Never start a default timer while project loading is pending.

Every project JSON entry point, including clipboard paste, must use the same byte limit and strict layer sanitizer before persistence.

**Why:** Hardening only the document picker leaves alternate import surfaces able to store malformed or unbounded layer data.

**How to apply:** Validate raw bytes first, sanitize layers second, bound canvas dimensions, and persist only the sanitized result.

Master exports always use the exact integer logical canvas or crop dimensions. PNG is the lossless default; optional JPEG cannot go below 95% quality. Encoded dimensions must be verified before download, media save, sharing, product-photo use, or post use.

**Why:** Screen-size fallbacks, silent dimension rounding, crop fractions, and resize caps can make a high-resolution project export blurry, smaller than designed, or impossible to export.

**How to apply:** Rasterize only from the off-screen logical SVG, reject invalid geometry instead of resizing it, never pass PNG through a lossy encoder, and keep gallery thumbnail sizing isolated from editable layers and master assets.
