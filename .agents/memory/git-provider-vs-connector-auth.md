---
name: Git provider vs connector authentication
description: Distinguishing repository push credentials from the GitHub API integration
---

Git push authentication in the workspace can fail even while the GitHub API integration successfully authenticates. Treat these as separate credential paths; do not reauthorize a healthy connector to repair the Git remote.

**Why:** An HTTPS push was rejected as an invalid username or token, while the connected GitHub API returned a successful authenticated response. Neither GitHub CLI nor SSH offered an authenticated fallback.

**How to apply:** For ordinary Git pushes, reconnect GitHub under Replit account settings → Git Providers, then check remote divergence before retrying. A user-authorized backup through the connector's Git-data API is a separate option; validate original object hashes and create only the authorized new reference.

Git-data API backups require the OAuth `workflow` scope when local history introduces GitHub Actions workflow files. A healthy connector with `repo` scope can upload ordinary trees and exact commits yet return a misleading 404 for a tree containing a new workflow.

**Why:** Exact object transfer worked until a workflow addition; the granted scopes and available reconnect scope set omitted `workflow`. Repository-level push/admin permissions do not supply missing token scopes.

**How to apply:** Check workflow changes and granted scopes before transferring history. Reconnecting with an unchanged scope set cannot add the missing permission. Never omit workflow files, change commit hashes, or overwrite another branch to bypass this boundary.