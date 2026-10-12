---
name: Native font shim bootstrap
description: Prevent import-time circular dependencies in the React Native font shim.
---

A React Native export shim must publish its forwarded native exports before loading helpers that themselves import React Native. Defer those helpers until the wrapped component is accessed.

**Why:** The actual iOS Metro bundle resolved the font helper's React Native import back to the partially initialized shim despite the intended resolver exemption. An eager helper load therefore reached `Platform.select` with no Platform export and crashed Expo Go at launch. Web's per-component resolution and ordinary mocked screen tests did not expose the cycle.

**How to apply:** Preserve lazy native getters, text weight mapping, input statics and animation functions. Check the actual native bundle's dependency graph and module initialization, not just successful bundle compilation or web rendering. Do not claim a physical-device launch from a host-stubbed bootstrap check.
