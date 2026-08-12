---
name: Brandthread theme — canonical palette
description: Which color system is canonical in the mobile app, which older palettes are retired, and how to catch stragglers after any rebrand
---

**Canonical system:** `lib/theme.ts` module constants (BG `#07070F`, SURFACE, CARD, FG `#F4F4FF`, PURPLE `#8B5CF6`, CYAN, FONT/FS/SP/RADIUS scales). The app is effectively **dark-only**: screens import these constants directly, so there is no runtime light mode. Buyer AND seller sides are both unified on it, including the buyer tab bar, Thread feed, Discover, Search, and Edit Profile.

**Retired palettes — do not resurrect:**
- "Vault Archive" bone/ink/blood-orange palette (`#F5F1E7`/`#F2EEE3` cream, `#EDE7D9`, `#17140F`, `#121110`, rust/orange primaries) — an older rebrand that survived in stragglers long after the purple system replaced it.
- Green accents `#00C853`/`#39FF88` as UI chrome (GREEN_BRIGHT remains a token strictly for revenue highlights; per-seller `brandColor`/`avatarColor` fields in demo data may be any hue as small accents only).
- `constants/colors.ts` + `useColors()` light palette — still in the repo but unused by screens; don't build new screens on it.

**Why:** the buyer side shipped with three palettes at once (purple tokens, Vault Archive cream/green leftovers, and a bespoke Discover palette), which read as two different apps. Stale theme memory describing an old rebrand as current made this worse.

**How to apply:** all UI chrome colors must come from `lib/theme.ts`; if a shade is missing (e.g. ON_DARK_MUTED for secondary text on colored surfaces), add it there once. After any rebrand, grep for the previous palette's hexes across ALL screens — including secondary screens reachable one tap away (search, edit-profile, settings-type screens); tab screens get attention, stragglers hide behind buttons. Verify text-on-accent contrast: low-opacity "subtle" tokens are unreadable on solid accent surfaces.
