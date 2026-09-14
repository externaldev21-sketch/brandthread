---
name: Expo tunnel fallback
description: Resilient Brandthread development startup when Expo's Ngrok tunnel provider is unavailable.
---

Prefer Expo tunnel mode for normal native-device access, but let the managed artifact workflow fall back to LAN mode on an ordinary tunnel startup failure. Keep the injected port and external packager hostname in both modes. Do not start the fallback when the first process exits because of a shutdown signal.

**Why:** Expo's tunnel command can fail before Metro starts when Ngrok returns an invalid or unavailable response. Repeating the same workflow restart leaves the artifact down even though Metro and the Replit artifact proxy work correctly without that tunnel.

**How to apply:** Preserve a guarded tunnel-to-LAN fallback in the mobile development command. Continue honoring the workflow-provided port; never hardcode or replace the managed artifact workflow.