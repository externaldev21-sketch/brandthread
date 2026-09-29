---
name: Expo web chat focus
description: Diagnosing briefly focused but unusable web chat inputs
---

An Expo web TextInput may receive a genuine pointer tap and focus event, yet immediately blur when the same click bubbles into an ancestor press handler that calls Keyboard.dismiss. Checking only the element at the tap point or waiting for an input to become visible will not catch this; verify that focus persists after the click.

**Why:** On the web preview, the input was visually clear of the consent notice and received pointer and focus events, but a later click handler dismissed the keyboard during that same tap.

**How to apply:** For web-only focus regressions in nested navigation or pressable surfaces, trace focus/blur and click propagation before altering layout. Stop click propagation at the affected interactive control without blocking native touch behavior.