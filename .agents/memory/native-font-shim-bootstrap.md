---
name: Font bootstrap and readiness
description: Preserve native font bootstrap safety; web Inter is an approved exception, and browser font readiness needs real verification.
---

A React Native export shim must publish its forwarded native exports before loading helpers that themselves import React Native. Defer those helpers until the wrapped component is accessed.

**Why:** The actual iOS Metro bundle resolved the font helper's React Native import back to the partially initialized shim despite the intended resolver exemption. An eager helper load therefore reached `Platform.select` with no Platform export and crashed Expo Go at launch. Web's per-component resolution and ordinary mocked screen tests did not expose the cycle.

**How to apply:** Preserve lazy native getters, text weight mapping, input statics and animation functions. Check the actual native bundle's dependency graph and module initialization, not just successful bundle compilation or web rendering. Do not claim a physical-device launch from a host-stubbed bootstrap check.

**Rule:** Web app text uses bundled Inter; native app text retains the system-font policy.

**Why:** The owner explicitly requested reliable Inter delivery for web chat and app text. This is a web-only exception to the design foundation, not approval to change native typography.

**How to apply:** Preserve native lazy font initialization and system fonts. On web, put an ordinary Latin text fallback before emoji families so a failed text-font download cannot produce emoji-width spaces.

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

Compound web text stacks must put a real Latin/system font before emoji fallbacks; normalize native font aliases before concatenating them.

**Why:** An unregistered native weight alias followed by emoji fonts let an emoji font supply ordinary spaces. Text looked justified despite start alignment and zero CSS word spacing.

**How to apply:** Inspect the computed family and measure whitespace with a browser canvas. Left alignment alone cannot correct fallback-glyph widths; preserve emoji support after a valid Latin/system family.
