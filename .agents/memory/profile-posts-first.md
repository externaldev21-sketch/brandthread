---
name: Posts-first profile visits
description: Product requirement for default profile tabs and visit-local selection.
---

Every buyer and seller profile, including one's own and the official account, opens on Posts. Existing Products tabs stay second; do not add a shop to profiles that do not sell.

**Why:** The owner explicitly wants videos and slideshows to be the profile entry point, not a catalog. A previous seller-specific default switched visitors to Products after profile metadata loaded.

**How to apply:** Keep explicit tab choices only for the current focused visit. Reset on a new visit or identity change; metadata refreshes within the visit must not overwrite the user's selection. Do not persist a Products default or change other profile layout.
