---
name: Web interactive containers
description: Avoid nested HTML buttons when native accessibility roles are rendered on Expo web.
---

Keep noninteractive containers noninteractive. Give button semantics and labels to the individual actionable controls, not a surrounding View that contains those controls.

**Why:** React Native Web can render a View with `accessibilityRole="button"` as an HTML button. A card containing labeled pressables then produces nested buttons, hydration warnings, and a development error overlay even though native JSX compiles.

**How to apply:** Check the rendered browser console as well as TypeScript when changing native accessibility roles. Preserve the actual child actions and labels; remove inappropriate container roles rather than suppressing the warning.
