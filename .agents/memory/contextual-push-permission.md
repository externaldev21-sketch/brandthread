---
name: Contextual push permission
description: When Brandthread may request native notification permission.
---

Native push permission must never be requested at app launch or during onboarding. Register an already-granted token silently, but show the OS prompt only once per Clerk user after a successful server-backed value event: buyer follow/save, or seller new order/inbound buyer message.

**Why:** An early denial is difficult to reverse and loses the notification channel before the user understands its value. Local/demo actions are not trustworthy prompt boundaries.

**How to apply:** Keep prompt state user-scoped, block web/signed-out/pre-onboarding calls, honor `canAskAgain`, and invoke the shared helper only after the relevant authenticated API action or poll succeeds.