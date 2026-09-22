---
name: Expo proxied device startup
description: Reliable Brandthread device startup through Replit's managed Expo proxy without an Ngrok-first handoff.
---

Start Brandthread's managed artifact workflow in Expo LAN mode while keeping Replit's injected port, external packager hostname, and packager proxy URL. Replit's managed Expo domain provides external device access; do not add an Ngrok-first handoff unless the managed proxy stops serving manifests or native bundles.

**Why:** Expo's tunnel command repeatedly failed before Metro with an invalid Ngrok response. Its later LAN fallback served a valid manifest and full iOS bundle, but the failed handoff left Expo Go showing a white screen. Direct proxied LAN startup removed that race.

**How to apply:** Keep direct LAN startup in the managed mobile development command. Continue honoring the workflow-provided port and proxy environment variables; never hardcode or replace the managed artifact workflow. Verify the public Expo endpoint serves a manifest and native launch bundle after startup.