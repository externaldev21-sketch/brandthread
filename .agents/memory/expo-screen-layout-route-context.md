---
name: Expo screen layouts and route context
description: Route context availability when wrapping Expo Router navigator screens
---

Expo Router's navigator `screenLayout` wrapper does not have access to the per-screen `useRoute()` context, even when its child scene does. Pass the callback's `route` argument into the wrapper as a prop instead.

**Why:** A route-aware preview guard initially used `useRoute()` inside the layout wrapper; web preview crashed before rendering with “Couldn't find a route object.”

**How to apply:** When a screen-level wrapper needs the destination name before mounting its children, get it from `screenLayout={({ route, children }) => ...}` rather than reading route context inside the wrapper.