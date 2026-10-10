---
name: Versioned AI consent
description: Preserve the stronger consent contract when upstream changes introduce timestamp-only compatibility APIs.
---

AI data-sharing permission remains account-scoped and versioned. A legacy user timestamp or device cache alone must not authorize third-party AI requests.

**Why:** Upstream integration introduced a second, timestamp-only consent interface. Treating it as authoritative would bypass renewed permission when the disclosure or provider list changes.

**How to apply:** Keep compatibility endpoints backed by the versioned consent authority. Integration fixtures that need AI access must grant the current version explicitly; do not bypass the production guard to restore old test expectations.
