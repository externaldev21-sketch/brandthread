---
name: Git provider vs connector authentication
description: Distinguishing repository push credentials from the GitHub API integration
---

Git push authentication in the workspace can fail even while the GitHub API integration successfully authenticates. Treat these as separate credential paths; do not reauthorize a healthy connector to repair the Git remote.

**Why:** An HTTPS push was rejected as an invalid username or token, while the connected GitHub API returned a successful authenticated response. Neither GitHub CLI nor SSH offered an authenticated fallback.

**How to apply:** Leave committed work local, avoid force pushes and credential workarounds, and have the user reconnect GitHub under Replit account settings → Git Providers. Then fetch and retry the ordinary push, checking remote divergence before doing so.