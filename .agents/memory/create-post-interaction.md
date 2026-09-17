---
name: Create Post interaction
description: User-confirmed visual direction for Brandthread's post creation flow.
---

Create Post should closely follow a TikTok-like media-first interaction: the opening screen must immediately read as a camera composer, with a sound pill, right-edge tools, shutter, upload, durations, and mode tabs. Follow with an immersive editing canvas and concise details screen with Draft and Post actions. Keep Brandthread branding and commerce features rather than copying TikTok identity.

**Why:** The user supplied a nine-screen TikTok iOS posting reference and rejected a loose interpretation that copied only the general flow. Visual structure and hierarchy need to match the reference closely.

**How to apply:** Keep future Create Post changes focused on media and quick creator actions. Avoid generic upload pages, card-heavy forms, style-tag pickers, announcement-type chips, or unrelated controls that interrupt the selection-to-edit-to-post sequence.

Video and photo-slide text overlays follow the supplied TikTok iOS interaction reference: Aa opens an over-media editor with Done, fonts, alignment, background styles, and colors; completed text remains tappable, draggable, removable, and must be burned into composed media. Slideshow overlays belong to stable individual slides and must not bleed across slide changes.

**Why:** A decorative or preview-only text tool would disappear from the final post and would not satisfy the reference flow.

**How to apply:** Keep overlay coordinates bounded and editable before composition, validate all overlay input server-side, and pass user text through temporary text files rather than interpolating it into FFmpeg filters. Keep draft media private and restore per-slide overlays for later editing.