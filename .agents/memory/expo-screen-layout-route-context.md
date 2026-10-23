---
name: Expo screen layouts and route context
description: Navigation context boundaries in Expo screen wrappers and development previews
---

Expo Router's navigator `screenLayout` wrapper does not have access to the per-screen `useRoute()` context, even when its child scene does. Pass the callback's `route` argument into the wrapper as a prop instead.

**Why:** A route-aware preview guard initially used `useRoute()` inside the layout wrapper; web preview crashed before rendering with “Couldn't find a route object.”

**How to apply:** When a screen-level wrapper needs the destination name before mounting its children, get it from `screenLayout={({ route, children }) => ...}` rather than reading route context inside the wrapper.

Reusable dashboard content must also work without a per-screen navigation context when rendered by the development preview root.

**Why:** A Live Map's React Navigation focus hook passed typechecking but crashed the fresh seller preview because that preview renders the dashboard directly, outside a screen navigator.

**How to apply:** For reusable content mounted in a pager or preview root, pass visibility from the parent and use an effect for load/polling cleanup, rather than navigation-context hooks. Let local preview data remain independent of authenticated websocket focus. Ignore pending results after deactivation or identity changes.

The buyer feed's LIVE directory is pager content, not a navigation screen.

**Why:** A navigation focus hook crashed LIVE inside the feed even though its standalone route had a valid navigator.

**How to apply:** Keep the directory's lifecycle driven by its active prop. Opening a show already uses the Expo Router push helper; do not add a required navigation hook to the embedded directory or its children.