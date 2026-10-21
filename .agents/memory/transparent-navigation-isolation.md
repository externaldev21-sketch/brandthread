---
name: Transparent navigation isolation
description: Preventing retained transparent Expo Router scenes from painting or receiving touches through the active route
---

**Rule:** Root stack content and every buyer/seller tab scene must be opaque near-black. Ordinary full pages use card presentation; retained modal/full-screen-modal routes must declare an explicit opaque content surface. Do not mount a shared full-screen background inside each route scene. Detach and freeze inactive buyer and seller tabs as an additional native optimization. Transparent modal portals must unmount when hidden and clear visibility when their owner route loses focus.

**Why:** Transparent nested tab scenes remain mounted on Expo web even when native detachment options are enabled, so prior tabs can show through. Per-route background mounts also coexist during transitions and add unnecessary full-screen layers. React Native modals render through a global portal, so a modal owned by a frozen inactive tab can dim unrelated screens.

**How to apply:** Keep root Stack `contentStyle`, its scene wrapper, both Tabs `sceneStyle` values, and the seller tab bar opaque. Classify each route individually: cards for full pages, modals only for genuine immersive/overlay flows with opaque content. For route-owned transparent modals, return null while closed and reset visible state in focus cleanup. Use replacement for ownership transfers and `dismissTo` when a completed flow must unwind to an existing root.

**Web viewport coverage:** Expo's development document does not use the exported custom HTML template. Paint the document canvas and React host from the runtime theme too; a late persisted-theme bootstrap must not overwrite a newer live theme.

**Why:** Static-export background CSS alone does not cover Metro's development preview or account/theme changes. A correctly painted screen is not proof that the browser viewport behind it is painted.

**How to apply:** Check document-root, body, and host backgrounds separately from screen backgrounds when investigating safe-area gaps; do not infer a reproduced device bug from a clean desktop capture.