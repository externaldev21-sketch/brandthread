---
name: Native transition measurement
description: Reliable boundaries for physical-device transition and keyboard performance checks.
---

Measure JavaScript scheduling and animation completion inside the app rather than using device-automation request time as a paint metric. Use native screen recordings to detect visible frozen frames, and confirm delayed focus through the input's focus event plus native keyboard visibility.

**Why:** Appium command and accessibility polling latency varies independently of app performance. A timer callback that calls `focus()` also does not prove the input focused or the keyboard opened.

**How to apply:** For release-gating mobile transition checks, combine development-only app timing markers with physical-device recordings and native state assertions. Keep production behavior inaccessible through compile-time development guards.