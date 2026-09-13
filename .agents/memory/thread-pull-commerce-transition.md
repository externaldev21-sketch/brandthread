---
name: Thread-pull commerce transition
description: Scoping and navigation rules for Brandthread's signature buyer purchase-funnel motion
---

**Rule:** Apply the thread-pull transition through dedicated purchase-funnel route aliases, not by disabling native transitions on the shared product-detail and checkout routes.

**Why:** Product detail and checkout are also entered from conversations, seller profiles, drops, and other unrelated surfaces. Global screen-option changes remove expected native motion and gestures from those flows.

**How to apply:** Thread-enabled feed, discovery, search, related-product, cart, and checkout actions use the aliases and shared transition hook. Original routes keep native navigation. Explicit back actions check the current alias before choosing mirrored thread motion or ordinary router back.

**Motion contract:** Keep the route action immediate, total motion near 300ms, runtime accent on the moving strand, pointer events disabled, and forward/back geometry mirrored. Use responsive window dimensions and queue one pending navigation rather than dropping it during an active transition.