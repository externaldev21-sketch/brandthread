---
name: Font bootstrap and readiness
description: Avoid native font import cycles and verify actual web icon-font readiness and emitted SPA assets.
---

A React Native export shim must publish its forwarded native exports before loading helpers that themselves import React Native. Defer those helpers until the wrapped component is accessed.

**Why:** The actual iOS Metro bundle resolved the font helper's React Native import back to the partially initialized shim despite the intended resolver exemption. An eager helper load therefore reached `Platform.select` with no Platform export and crashed Expo Go at launch. Web's per-component resolution and ordinary mocked screen tests did not expose the cycle.

**How to apply:** Preserve lazy native getters, text weight mapping, input statics and animation functions. Check the actual native bundle's dependency graph and module initialization, not just successful bundle compilation or web rendering. Do not claim a physical-device launch from a host-stubbed bootstrap check.

Icon-font readiness on web requires the browser's actual face to be loaded,
not just the font library's registration flag. Until then, private-use icon
glyphs must be invisible without changing the ready icon's styles.

**Why:** Slow font delivery can expose missing-glyph squares. Ordinary system
text must not acquire a font-loading subscription or wait on these fonts.

**How to apply:** Preload only used families, keep font dependencies lazy in
the native Text shim, and verify pending/failed faces as well as successful
loads. Keep a bounded splash wait so failed assets cannot strand startup.

Single-output Expo web exports do not apply the custom HTML document.

**Why:** Editing the custom document alone left the generated SPA index with
zero font preloads or block-display rules, despite a successful export.

**How to apply:** Verify the served app index actually contains icon-only
preloads and block-display CSS. Account for the normal root and the fast-preview
base path, and do not make marketing pages preload app icon fonts.

Capture pending-font screenshots without waiting for font readiness.

**Why:** Playwright's normal screenshot call waits for fonts, hiding the
loading state being tested and timing out under deliberate throttling.

**How to apply:** Use CDP's rendered-frame capture for slow-font checks, with
readiness/visibility observations running throughout the walkthrough.
