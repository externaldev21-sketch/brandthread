---
name: Dev API base URL for mobile
description: Rule for pointing the Expo app at the api-server in development
---

# Dev API base URL

The mobile app's API base URL must be the dev domain ROOT; the proxy forwards `/api/*` verbatim. Pointing it at a path prefix fails silently: unknown paths return the SPA's HTML with HTTP 200, so requests look successful while every consumer receives HTML instead of JSON.

**Why:** this silent-200 trap cost hours of debugging.

**How to apply:** if API responses won't parse, check what base URL the RUNNING app actually has (Metro bakes env at bundle time — the shell's env is not the app's) and probe whether the response body is JSON or HTML.
