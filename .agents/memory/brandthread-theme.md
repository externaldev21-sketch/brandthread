---
name: Brandthread theme — canonical palette
description: Which color system is canonical in the mobile app, which older palettes are retired, and how to catch stragglers after any rebrand
---

**Canonical system:** dark base tokens remain in `lib/theme.ts` (BG `#07070F`, SURFACE, CARD, FG `#F4F4FF`, FONT/FS/SP/RADIUS scales). The app is **dark-only**, but its primary accent is now selected at runtime through the shared app-theme provider. Buyer and seller sides must use that same provider for chrome rather than assuming fixed purple/cyan.

**Retired palettes — do not resurrect:**
- "Vault Archive" bone/ink/blood-orange palette (`#F5F1E7`/`#F2EEE3` cream, `#EDE7D9`, `#17140F`, `#121110`, rust/orange primaries) — an older rebrand that survived in stragglers long after the purple system replaced it.
- Green accents `#00C853`/`#39FF88` as UI chrome (GREEN_BRIGHT remains a token strictly for revenue highlights; per-seller `brandColor`/`avatarColor` fields in demo data may be any hue as small accents only).
- `constants/colors.ts` + `useColors()` light palette — still in the repo but unused by screens; don't build new screens on it.

**Why:** the buyer side shipped with three palettes at once (purple tokens, Vault Archive cream/green leftovers, and a bespoke Discover palette), which read as two different apps. Stale theme memory describing an old rebrand as current made this worse.

**How to apply:** base surfaces and typography come from `lib/theme.ts`; runtime accent/chrome values come from the shared app-theme provider. After a rebrand, grep for stale fixed accent hexes across ALL screens — including secondary screens reachable one tap away (search, edit-profile, settings-type screens); tab screens get attention, stragglers hide behind buttons. Verify text-on-accent contrast: low-opacity "subtle" tokens are unreadable on solid accent surfaces.
