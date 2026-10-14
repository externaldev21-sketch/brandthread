---
name: First App Store launch
description: Owner-approved scope for making Replit's first App Store wizard build possible.
---

Prioritize a wizard-managed first build over optional native surfaces and an
unlinked OTA configuration. Do not invent Expo project IDs or Apple credentials.
Monitoring absence must be disclosed, not silently treated as working.

**Why:** The owner could not start App Store/TestFlight setup and explicitly
approved disabling native extras that could block the first build. A runtime
feature flag alone does not prevent native extension compilation or signing.

**How to apply:** Keep the permanent app identity and seller navigation intact.
Only opt native extras back into a new binary after provisioning their targets
and App Group. Link OTA to the wizard's real project before enabling updates.
Keep web route splitting when replacing dynamic configuration with static JSON.
Do not claim a Publishing-card error is fixed just because local checks pass:
without a Launch session, there is no native build log to attribute the error to.
