---
name: Runtime app themes
description: The app-wide accent theme choice is a user-scoped setting shared by buyer and seller interfaces.
---

**Rule:** App themes change accent/chrome colors only, while the application retains its dark base surfaces and semantic status colors. Chrome is the no-selection/fresh-install default; Purple remains opt-in. The selected theme must be stored per signed-in user and applied by the one shared runtime provider across buyer and seller routes.

**Why:** A person can move between buyer and seller experiences, so role-specific keys would produce conflicting colors in the same account. Keeping dark surfaces stable protects readability for finishes such as Silver and Champagne.

**How to apply:** Buttons, selected states, progress, gradients, highlights, focus rings, badges, glows, and navigation chrome must read from the runtime theme hook. Use each preset's multi-stop primary/hero/glow gradients for polished finishes rather than synthesizing a flat two-color fill. Explicit semantic colors and deliberate content/color-picker colors remain untouched.