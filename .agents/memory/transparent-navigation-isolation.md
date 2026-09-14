---
name: Transparent navigation isolation
description: Preventing retained transparent Expo Router scenes from painting or receiving touches through the active route
---

**Rule:** Every root stack scene must own an opaque dark isolation plane beneath its transparent route content. Ordinary full pages use card presentation; retained modal/full-screen-modal routes must declare an explicit opaque content surface. Render the animated background only for the focused root scene. Detach and freeze inactive buyer and seller tab scenes.

**Why:** A single background behind a transparent retained stack lets prior routes remain visible beneath pushed screens. Mounting one full animator per retained route fixes the bleed but creates unbounded animation work as stack depth grows.

**How to apply:** Classify each route individually. Use card presentation for settings, details, editors, and workflows that replace the prior page. Reserve modal presentation for genuine immersive or overlay flows, and require an opaque content style even when their inner root is transparent. Use replacement for ownership transfers and `dismissTo` when a completed multi-route flow must unwind to an existing root.