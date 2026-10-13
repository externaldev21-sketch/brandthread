---
name: Merge runtime validation
description: Verification boundaries when incoming PRs mix TypeScript screens with JavaScript hosting scripts.
---

After resolving an upstream merge, check every tracked runtime source for conflict markers and syntax errors, not just the files covered by TypeScript.

**Why:** Typechecking passed while conflict markers remained in the separate JavaScript browser-hosting server. The runtime-server tests caught an error the TypeScript projects could not see.

**How to apply:** Scan tracked JavaScript and TypeScript sources after all merges, syntax-check changed JavaScript entry points, and distinguish those results from mobile and API typechecks.

Make failed validation stop a batch shell command before it can stage or commit.

**Why:** A shell continued past a failing conflict-marker check and committed a partly resolved file; the overall command still reported success because its final command succeeded.

**How to apply:** Use `set -e` or explicit success chaining for validation and commit commands. Check both unstaged and staged diffs, and inspect every conflict block rather than relying on truncated search output.

After removing a feedback call, inspect its surrounding conditional rather than deleting only the call expression.

**Why:** An emptied destructive-only branch can legally capture the next action callback. TypeScript still passes, while ordinary buttons animate but never perform their actions.

**How to apply:** Keep action dispatch independent of optional feedback. Renderer-test enabled, disabled, and loading controls across every shared button variant; syntax and source audits alone cannot verify click behavior.
