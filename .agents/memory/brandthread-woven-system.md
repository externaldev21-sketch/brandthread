---
name: Brandthread design system
description: The clean app-wide visual language that replaced the decorative Woven presentation
---

**Rule:** The Brandthread design-system artifact remains the visual authority, but thread/weaving decoration is retired. Dividers are solid, avatars use clean circular borders, loaders are simple spinners, badges are pills, and tab indicators are plain accent bars.

**Why:** Decorative stitched rings, hang-tag silhouettes, thread loaders, tension lines, and Thread Pull motion conflicted with the requested premium, direct interface.

**How to apply:** Keep compatibility export names when removing decoration so existing imports do not break. New buyer and seller UI should use clean primitives, runtime theme surfaces, system fonts, native platform icons, normal-case labels, and flat cards without decorative borders. Navigation is direct; do not add decorative seam or thread transitions.

**Rule:** Preserve the seller tab bar's existing swipe and glow motion when applying the new design foundation. The owner approved faster active-pill movement on both seller and buyer bars as a timing-only exception; shape, size, color and glow must remain identical.

**Why:** The owner approved the system-font/native-icon/flat-card foundation while protecting navigation appearance, then explicitly authorized faster active-pill speed and timing only.

**How to apply:** Preserve the approved faster timing during later merges. Apply the foundation elsewhere without restyling the bars or changing their swipe or glow behavior.

**Rule:** Crisp/no-blur styling is approved, but glow hairlines retain the original full-strength accent (full white in the default seller theme), not the standard translucent border color.

**Why:** The owner approved the broader crisp pass while explicitly rejecting its dimmed glow-outline change.

**How to apply:** Preserve the original accent-colored hairlines when importing shared card changes. Keep the seller tab bar's swipe/glow implementation and appearance untouched.