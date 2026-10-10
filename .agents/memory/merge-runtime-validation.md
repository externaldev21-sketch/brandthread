---
name: Merge runtime validation
description: Verification boundaries when incoming PRs mix TypeScript screens with JavaScript hosting scripts.
---

After resolving an upstream merge, check every tracked runtime source for conflict markers and syntax errors, not just the files covered by TypeScript.

**Why:** Typechecking passed while conflict markers remained in the separate JavaScript browser-hosting server. The runtime-server tests caught an error the TypeScript projects could not see.

**How to apply:** Scan tracked JavaScript and TypeScript sources after all merges, syntax-check changed JavaScript entry points, and distinguish those results from mobile and API typechecks.
