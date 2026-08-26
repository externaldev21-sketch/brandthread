---
name: Runtime app themes
description: The app-wide accent theme choice is a user-scoped setting shared by buyer and seller interfaces.
---

**Rule:** App themes change accent/chrome colors only, while the application retains its dark base surfaces and semantic status colors. The selected theme must be stored per signed-in user and applied by the one shared runtime theme provider across buyer and seller routes.

**Why:** A person can move between buyer and seller experiences, so role-specific keys would produce conflicting colors in the same account. Keeping dark surfaces stable protects readability for finishes such as Silver and Champagne.

**How to apply:** New shared buttons, selected states, gradients, highlights, focus rings, badges, and navigation chrome must read their default accent from the runtime theme hook. Explicit semantic colors (error, success, warning) and deliberate one-off content colors remain untouched.