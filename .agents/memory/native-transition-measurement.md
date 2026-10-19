---
name: Native transition measurement
description: Reliable boundaries for physical-device transition and keyboard performance checks.
---

Do not infer Expo Go's delivered JavaScript size from `--no-dev --minify` alone. Inspect the manifest's actual launch URL and downloaded response, and distinguish minified JavaScript from Hermes bytecode.

**Why:** Expo SDK 57 skips JavaScript minification for Hermes requests carrying `transform.bytecode=1`, expecting a later Hermes compiler pass. The running Expo Go preview returned readable JavaScript on that path even with `dev=false` and `minify=true`; a `transform.bytecode=0` comparison was substantially smaller.

**How to apply:** Report the actual Expo Go launch payload separately from the explicitly minified JS comparison or an exported Hermes bundle. Production-mode Expo Go removes development checks but is not evidence of release-build startup size or native frame rate.

Measure JavaScript scheduling and animation completion inside the app rather than using device-automation request time as a paint metric. Use native screen recordings to detect visible frozen frames, and confirm delayed focus through the input's focus event plus native keyboard visibility. When an animation targets a measured native view, await `measureInWindow` (with a bounded fallback) before mounting or starting a native-driver animation; a late coordinate state update cannot reliably retarget one already in flight.

**Why:** Appium command and accessibility polling latency varies independently of app performance. A timer callback that calls `focus()` also does not prove the input focused or the keyboard opened. Native measurement callbacks are asynchronous, and starting first can lock in a fallback destination or create a visible jump.

**How to apply:** For release-gating mobile transition checks, combine explicitly enabled timing markers with physical-device recordings and native state assertions. Internal minified/release perf builds may enable bounded timing records; preview/auth bypasses must remain development-only.

**Browser benchmark rule:** Timestamp inside the browser's route/frame callbacks, not after awaiting a Playwright action. Reuse/dismiss to an existing navigation root rather than replacing pushed pages with fresh tab groups.

**Why:** Automation can finish well after the relevant paint. Repeated root replacement can accumulate retained tab groups, inflate subsequent timings and exhaust memory; those results describe the harness, not normal app navigation.

**How to apply:** Check source/destination paths, bound each scenario's lifetime, checkpoint results, and label browser route-commit frames separately from physical iPhone compositor frames. A browser comparison cannot establish Hermes performance or a native 60 fps guarantee.

**Root-state caveat:** Private Expo Router root-ref event probes in this project's current version returned internal `__root` snapshots during transitions, not consistently complete focused-leaf trees.

**Why:** Ending the measurement on that event produced placeholder destinations or missed Home even when the visible navigation completed.

**How to apply:** Verify the focused destination before using a state event as a timing boundary. A URL-settle fallback must be labeled a navigation-settle proxy, never visible first-paint evidence.