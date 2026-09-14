---
name: Transparent navigation isolation
description: Preventing retained transparent Expo Router scenes from painting or receiving touches through the active route
---

**Rule:** Root stack content and every buyer/seller tab scene must be opaque near-black. Ordinary full pages use card presentation; retained modal/full-screen-modal routes must declare an explicit opaque content surface. Do not mount a shared full-screen background inside each route scene. Detach and freeze inactive buyer and seller tabs as an additional native optimization.

**Why:** Transparent nested tab scenes remain mounted on Expo web even when native detachment options are enabled, so prior tabs can show through. Per-route background mounts also coexist during transitions and add unnecessary full-screen layers.

**How to apply:** Keep root Stack `contentStyle`, its scene wrapper, both Tabs `sceneStyle` values, and the seller tab bar opaque. Classify each route individually: cards for full pages, modals only for genuine immersive/overlay flows with opaque content. Use replacement for ownership transfers and `dismissTo` when a completed flow must unwind to an existing root.