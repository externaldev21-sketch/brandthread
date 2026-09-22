---
name: Expo dependency repair
description: Safe recovery when an interrupted pnpm relink leaves Expo packages present in the store but absent from the mobile workspace
---

If Expo packages exist in pnpm’s store but mobile imports, config plugins, or the Expo CLI suddenly cannot resolve, verify the workspace package links before treating the failure as a tunnel or device issue. A forced relink must be allowed to finish; an interrupted run can temporarily remove direct dependency links and executable shims. Keep the mobile development command gated by Expo's dependency compatibility check so SDK drift fails before Metro serves a phone bundle.

**Why:** Repeated foreground repairs were terminated by command time limits after pnpm had removed old links but before it recreated them. Metro stayed alive from the old process, which made the tunnel look healthy while fresh bundles failed to resolve Expo Router and Expo Font. Separately, SDK patch drift allowed Metro to start while Expo warned the phone app might fail.

**How to apply:** Run a frozen, mobile-filtered pnpm repair as a background process when it may exceed command limits. Wait for a successful exit, run Expo's SDK-aware compatibility repair/check from the mobile package, verify Expo Doctor and TypeScript, then restart the managed Expo workflow. A managed Expo sign-in warning is a separate startup credential issue; restart the managed workflow to retry it and confirm the warning disappears before debugging application code.