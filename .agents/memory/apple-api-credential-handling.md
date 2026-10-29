---
name: Apple API credential validation
description: Distinguish PEM formatting failures, valid key material, and actual Apple authentication.
---

Validate the PKCS#8 DER payload before rejecting an Apple private key that has
complete PEM markers but fails the direct PEM parser. Flattened line breaks can
leave the underlying key valid; normalize the envelope without changing key data.

**Why:** Repeatedly requesting replacement secrets for a PEM formatting issue
creates unnecessary work and does not establish whether Apple accepts the key.

**How to apply:** Check for a P-256 EC key locally, then make a signed read-only
Apple API request. Report local preflight results separately from remote
authentication and signing readiness. Materialize private keys outside the
checkout with restricted permissions and delete them after use. Fill submission
credentials transiently at command runtime, not in committed configuration.

EAS API-key injection does not prove non-interactive signing bootstrap is supported.
**Why:** EAS can stop with “Credentials are not set up” before validating a distribution certificate, even with the ASC variables populated.
**How to apply:** Distinguish CLI setup-mode rejection from Apple authorization rejection; do not blame the API-key role or claim an Apple ID login is unavoidable without provider evidence.
