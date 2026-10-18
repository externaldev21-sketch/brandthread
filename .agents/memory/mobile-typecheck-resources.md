---
name: Mobile typecheck resource envelope
description: Distinguishing compiler resource exhaustion from real mobile TypeScript diagnostics.
---

Run the complete mobile TypeScript check with an 8 GB V8 heap and avoid overlapping memory-heavy compiler runs.

**Why:** A 4 GB compiler process exhausted its heap and exited with status 134 before producing source diagnostics. The larger heap completed the check and exposed the actual errors. Counting diagnostic lines alone would incorrectly call the aborted run clean.

**How to apply:** Set the Node heap limit for the compiler process, preserve its actual exit code in the verification log, and distinguish resource/setup failures from source errors. Keep Expo and the API running while checking; do not consume the remaining memory with concurrent baseline compilers.
