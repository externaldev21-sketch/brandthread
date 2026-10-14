---
name: Expo screen layouts and route context
description: Navigation context boundaries in Expo screen wrappers and development previews
---

Expo Router's navigator `screenLayout` wrapper does not have access to the per-screen `useRoute()` context, even when its child scene does. Pass the callback's `route` argument into the wrapper as a prop instead.

**Why:** A route-aware preview guard initially used `useRoute()` inside the layout wrapper; web preview crashed before rendering with “Couldn't find a route object.”

**How to apply:** When a screen-level wrapper needs the destination name before mounting its children, get it from `screenLayout={({ route, children }) => ...}` rather than reading route context inside the wrapper.

Reusable dashboard content must also work without a per-screen navigation context when rendered by the development preview root.

**Why:** A Live Map's React Navigation focus hook passed typechecking but crashed the fresh seller preview because that preview renders the dashboard directly, outside a screen navigator.

**How to apply:** Use Expo Router's optional focus lifecycle for preview-reusable content; let local preview data remain independent of authenticated websocket focus. Do not introduce required navigator hooks solely to track background work.