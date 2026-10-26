---
name: Account-only app entry
description: Accounts-only routing supersedes the former guest-browsing and inline-sign-in policy; preview identity stays development-only.
---

The app is accounts-only. A signed-out visitor goes to the existing
Welcome/onboarding/auth flow, never to an app screen with an inline
"Sign in to view" state. Remove guest entry, not the account wall. Retain
legal documents, Apple-first auth and account deletion.

**Why:** The owner explicitly reversed the earlier guest-browsing request
after repeated reports of unwanted inline sign-in screens. Do not restore
the old TikTok-style guest model based on older instructions or tests.

**How to apply:** Gate every app route and withhold private children while
auth resolves/redirects. Existing optimistic action safeguards may remain
but must not open guest sheets or replay actions after authentication.
Do not alter signed-in layouts, fonts, tab bars or seller swipe/glow.

Explicit buyer/seller preview identity persists across preview URLs without
requiring a role query on each visit. This bypass is development/fast-preview
only. The owner's current review defaults to seller until instructed otherwise; a fresh preview browser (or clearing its saved role) defaults to seller,
never Welcome. Only bt_preview=guest selects signed-out Welcome testing;
retain that explicit selection across auth redirects until buyer/seller is
chosen again. URL selection wins over storage. Demo population still requires
the current URL's explicit demo opt-in.

**Why:** The owner explicitly requires every plain workspace preview URL to
open inside the app, even in a new browser, without granting synthetic
authority on published hosts.

**How to apply:** Keep preview bypass ahead of real-session redirects.
Production public entry is separately sealed by the pre-launch policy.
Do not sign out real users on reload or connectivity errors; device session
longevity requires device checks, not just mocked storage tests.
