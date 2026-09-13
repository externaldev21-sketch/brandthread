---
name: Transparent navigation isolation
description: Preventing retained transparent Expo Router scenes from painting or receiving touches through the active route
---

**Rule:** Every root stack scene must own an opaque dark isolation plane beneath its transparent route content. Render the animated background only for the focused root scene. Detach and freeze inactive buyer and seller tab scenes.

**Why:** A single background behind a transparent retained stack lets prior routes remain visible beneath pushed screens. Mounting one full animator per retained route fixes the bleed but creates unbounded animation work as stack depth grows.

**How to apply:** Keep normal push/back history for details and registered modal/full-screen-modal presentations. Use replacement for ownership transfers and `dismissTo` when a completed multi-route flow must unwind to an existing root. Never use transparent modal presentation for ordinary screens.