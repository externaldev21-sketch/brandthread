---
name: Clerk account switching
description: Identity and onboarding boundaries for switching among multiple Brandthread accounts on one device.
---

Brandthread’s account switcher must list and activate real Clerk sessions registered on the device. Never represent buyer/seller roles, demo records, or local profile objects as separate signed-in accounts.

**Why:** A Clerk identity owns its server profile, onboarding state, role, and private data. Treating a role toggle as account switching can display or overwrite the wrong identity’s information.

**How to apply:** Use Clerk’s session list and active-session APIs for switching. Add-account sign-in/onboarding routes may activate a new real session, but must not restore or persist onboarding drafts under the previously active user. After activation, existing account-scoped routing determines whether the selected identity enters buyer or seller navigation.