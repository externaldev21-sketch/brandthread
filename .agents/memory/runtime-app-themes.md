---
name: Runtime app themes
description: The app-wide accent theme choice is a user-scoped setting shared by buyer and seller interfaces.
---

**Rule:** App themes change accent/chrome colors and recolor the focused scene's animated background, while application surfaces remain dark and semantic status colors stay fixed. Chrome is the no-selection/fresh-install default; Purple remains opt-in. Store the selected theme per signed-in user and apply it through one shared runtime provider across buyer and seller routes.

**Why:** A person can move between buyer and seller experiences, so role-specific keys would produce conflicting colors in the same account. Keeping dark surfaces stable protects readability for finishes such as Silver and Champagne.

**How to apply:** Buttons, selected states, progress, gradients, highlights, focus rings, badges, glows, navigation chrome, and every rendered color layer in the focused scene's animated background must read from the runtime theme hook. Derive dark background anchors from the selected hue so readability stays stable without fixed visible black/white stops. Only one focused root scene may run the background animator; retained scenes keep an opaque static plane. Theme changes may recolor ribbons, trails, and particles but must not alter their timing, geometry, layering, or motion. Explicit semantic colors and deliberate content/color-picker colors remain untouched.