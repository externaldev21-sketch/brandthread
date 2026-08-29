---
name: Manufacturer favorites boundary
description: Defines how lightweight seller favorites differ from Manufacturer Hub relationship records.
---

Manufacturer favorites are a seller-scoped, server-authoritative collection. Favoriting or unfavoriting a manufacturer must not create, update, archive, or remove a Manufacturer Hub relationship.

**Why:** “My Manufacturers” represents an active workflow relationship with statuses and operational data, while a favorite is only a lightweight browsing bookmark. Combining them would make a heart action change business workflow state.

**How to apply:** Use the dedicated favorites API for heart controls and Favorites views. Reserve relationship APIs for My Manufacturers, invitations, quotes, samples, production, and messaging workflows.