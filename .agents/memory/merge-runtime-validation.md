---
name: Merge runtime validation
description: Verification boundaries when incoming PRs mix TypeScript screens with JavaScript hosting scripts.
---

After resolving an upstream merge, check every tracked runtime source for conflict markers and syntax errors, not just the files covered by TypeScript.

**Why:** Typechecking passed while conflict markers remained in the separate JavaScript browser-hosting server. The runtime-server tests caught an error the TypeScript projects could not see.

**How to apply:** Scan tracked JavaScript and TypeScript sources after all merges, syntax-check changed JavaScript entry points, and distinguish those results from mobile and API typechecks.

When a feature PR edits older, separate screen implementations, preserve the current shared screen and port the feature into it. Also inspect marker-free merge overlaps for duplicated or incomplete method bodies.

**Why:** Independent PRs can target obsolete screen copies. Keeping only the current wrapper silently drops the incoming behavior, while restoring the old copy loses newer account, outbox, and navigation safeguards.

**How to apply:** Resolve both behavioral intents in the canonical implementation, then check its changed actions and account boundaries rather than treating a clean merge as proof of compatibility.

Make failed validation stop a batch shell command before it can stage or commit.

**Why:** A shell continued past a failing conflict-marker check and committed a partly resolved file; the overall command still reported success because its final command succeeded.

**How to apply:** Use `set -e` or explicit success chaining for validation and commit commands. Check both unstaged and staged diffs, and inspect every conflict block rather than relying on truncated search output.

After removing a feedback call, inspect its surrounding conditional rather than deleting only the call expression.

**Why:** An emptied destructive-only branch can legally capture the next action callback. TypeScript still passes, while ordinary buttons animate but never perform their actions.

**How to apply:** Keep action dispatch independent of optional feedback. Renderer-test enabled, disabled, and loading controls across every shared button variant; syntax and source audits alone cannot verify click behavior.

Treat upstream “dead component” deletions as claims about the branch's original base, not the current integrated tree.

**Why:** Newer screens can load supposedly unused components through dynamic `require()` calls that an import-only audit misses.

**How to apply:** Search all tracked references, including lazy imports and `require()`, before accepting deletions. Retain live dependencies and use typechecking to catch unresolved modules.

Verify browser-facing access restrictions with browser-style requests, not a bare HTTP client request.

**Why:** A bare request returned 404 while the same app route served an interactive app shell with `Accept: text/html`. That 404 did not prove the pre-launch seal was active.

**How to apply:** Send `Accept: text/html`, disable redirect following, and inspect the response body and Location header. Check the public root, an app route, and legal routes separately against the production-mode build and the published service.
