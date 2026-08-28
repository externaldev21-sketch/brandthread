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

**Why:** design-canvas.tsx was previously using hardcoded local color constants with theme names — rewritten to use @/lib/theme imports throughout.

The reference-image rule exists because multiple Studio tools accepted an uploaded URI but silently called text-only generation, making the upload irrelevant and displaying decorative placeholders instead of provider output.

**How to apply:** Convert local/remote source images before authenticated requests, use image editing when a reference exists, preserve the source subject explicitly in prompts, validate bytes server-side, and render returned image data directly.
