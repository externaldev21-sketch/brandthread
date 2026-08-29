---
name: Expo dependency repair
description: Safe recovery when an interrupted pnpm relink leaves Expo packages present in the store but absent from the mobile workspace
---

If Expo packages exist in pnpm’s store but mobile imports, config plugins, or the Expo CLI suddenly cannot resolve, verify the workspace package links before treating the failure as a tunnel or device issue. A forced relink must be allowed to finish; an interrupted run can temporarily remove direct dependency links and executable shims.

**Why:** Repeated foreground repairs were terminated by command time limits after pnpm had removed old links but before it recreated them. Metro stayed alive from the old process, which made the tunnel look healthy while fresh bundles failed to resolve Expo Router and Expo Font.

**How to apply:** Run a frozen, mobile-filtered pnpm repair as a background process when it may exceed command limits. Wait for a successful exit, verify the Expo CLI and key direct dependencies resolve from the mobile workspace, then restart the managed Expo workflow. Confirm Expo Doctor, TypeScript, tests, tunnel readiness, and an external HTTP response before blaming Expo Go or the network.