---
name: Premium image acceptance
description: Quality and fidelity boundary for customer-facing Brandthread AI image generation and edits.
---

Every customer-facing AI image generation or edit must use the provider's premium quality mode and pass operation-specific visual QA before it is returned. Visual QA must compare available references and the written brief, and it must fail closed when verification is unavailable.

**Why:** Plausible fashion imagery is not sufficient when it changes model identity, garment construction, artwork, typography, materials, or scene continuity. Returning an unverified output damages the seller's source asset and brand trust.

**How to apply:** Add new image operations through the shared fashion prompt and QA orchestration boundary. Permit at most one internal correction using evaluator reasons. Never silently return a second failure; preserve independently accepted batch items and expose retryable failures for rejected items.