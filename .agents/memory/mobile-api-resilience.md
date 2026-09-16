---
name: Mobile API resilience
description: Rules for global API failure notices and safe retry behavior in the Brandthread mobile app.
---

Classify network failures plus HTTP 5xx and 408 centrally for diagnostics, but never render a global network notice or screen-owned read-failure message in the mobile app. Keep authentication, authorization, validation, and expected business-rule failures separate from read failures.

**Why:** The product requires all buyer and seller pages to avoid visible loading-failure text, warning banners, retry cards, raw API errors, and connection messages. These states repeatedly appeared during normal auth startup and made functional pages look broken. Writes still need explicit outcome feedback because silently retrying or hiding their failure can duplicate side effects or imply success.

**How to apply:** Wait for Clerk readiness before authenticated reads and generation-guard responses across account changes. Successful empty responses use plain empty/zero content. Genuine read failures render blank or the same minimal zero structure—never an unavailable/error placeholder. Mutations keep explicit feedback and retry actions in the owning screen.