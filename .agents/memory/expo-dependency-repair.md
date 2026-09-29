---
name: Expo dependency repair
description: Safe recovery when an interrupted pnpm relink leaves Expo packages present in the store but absent from the mobile workspace
---

If Expo packages exist in pnpm’s store but mobile imports, config plugins, or the Expo CLI suddenly cannot resolve, verify the workspace package links before treating the failure as a tunnel or device issue. A forced relink must be allowed to finish; an interrupted run can temporarily remove direct dependency links and executable shims. Validate SDK compatibility explicitly during dependency upgrades rather than making the development preview depend on Expo's moving online recommendation.

An upstream pull can add a native dependency that is present in the lockfile but absent from local workspace links; synchronizing the lockfile is necessary but not sufficient. Check the installed package against Expo's SDK compatibility map, and align incompatible versions when the package registry permits them.

**Why:** A newly pulled native drawing package first failed TypeScript resolution until the lockfile was installed, then its upstream version passed TypeScript but caused the Expo workflow's compatibility gate to exit before Metro started.

**How to apply:** After a pull that changes mobile dependencies, finish the pnpm sync and check compatibility separately. If the check names an installable expected version, pin it and update the lockfile; do not mistake a failed online recommendation for a Metro failure.

Expo's online install --fix may upgrade only some dependencies and then stop when it tries to add a config plugin to a dynamic app.config.js. This partial success is not a clean compatibility result.

**Why:** The SDK-aware installer advanced several packages, then failed at an automatic plugin edit even though the project already keeps its editable static plugin list in app.json.

**How to apply:** Add the requested plugin to the static Expo config, install any remaining expected SDK versions in their existing dependency group, and rerun both online and offline install --check before restarting.

**Why:** Repeated foreground repairs were terminated by command time limits after pnpm had removed old links but before it recreated them. Metro stayed alive from the old process, which made the tunnel look healthy while fresh bundles failed to resolve Expo Router and Expo Font. Separately, SDK patch drift allowed Metro to start while Expo warned the phone app might fail.

**How to apply:** Run a frozen, mobile-filtered pnpm repair as a background process when it may exceed command limits. Wait for a successful exit, run Expo's SDK-aware compatibility repair/check from the mobile package, verify Expo Doctor and TypeScript, then restart the managed Expo workflow. A managed Expo sign-in warning is a separate startup credential issue; restart the managed workflow to retry it and confirm the warning disappears before debugging application code.

Expo's online dependency check can advance its expected SDK patch versions before the workspace package registry allows those just-published releases. The development preview intentionally skips Expo's startup dependency validation so it remains usable during that delay. Do not weaken the registry's release-age restriction or carry this development-only behavior into production builds.

**Why:** Online Expo validation can block Metro even when the currently installed SDK and dependencies still match; an attempted SDK-aware repair may be rejected by the registry's minimum release age.

**How to apply:** Check the locally installed SDK and TypeScript, then verify a real web preview plus device manifest. When packages mature, update the SDK patch set together and run Expo's online compatibility check separately; do not reintroduce it as a development startup gate.