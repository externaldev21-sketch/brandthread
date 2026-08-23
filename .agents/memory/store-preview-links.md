---
name: Store preview links
description: Security invariant for shareable, pre-publication storefront preview URLs.
---

Public storefront preview tokens are bearer credentials. Persist only a SHA-256
fingerprint of the current link, require it for public preview access, and clear
it when a seller revokes sharing. Each newly generated share token must contain
fresh entropy, so replacing the fingerprint invalidates every earlier URL.

**Why:** A signed token's expiration alone does not prevent an account holder
from creating many valid public preview links. Storing raw bearer tokens would
create a separate credential-leak risk.

**How to apply:** Keep any future share-link generation, validation, rotation,
or revocation flow aligned with the single-current-fingerprint model. Do not
weaken the public endpoint to accept a signature without matching the stored
fingerprint.