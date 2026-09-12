---
name: Brandthread theme — canonical palette
description: Which color system is canonical in the mobile app, which older palettes are retired, and how to catch stragglers after any rebrand
---

**Canonical system:** dark base tokens remain in `lib/theme.ts` (BG `#07070F`, SURFACE, CARD, FG `#F4F4FF`, FONT/FS/SP/RADIUS scales). The app is **dark-only** and defaults to a black/white/silver Chrome finish. Its primary accent remains selectable at runtime through the shared app-theme provider. Purple is an opt-in preset, never the default.

**Retired palettes — do not resurrect:**
- "Vault Archive" bone/ink/blood-orange palette (`#F5F1E7`/`#F2EEE3` cream, `#EDE7D9`, `#17140F`, `#121110`, rust/orange primaries) — an older rebrand that survived in stragglers long after the purple system replaced it.
- Green accents `#00C853`/`#39FF88` as UI chrome (GREEN_BRIGHT remains a token strictly for revenue highlights; per-seller `brandColor`/`avatarColor` fields in demo data may be any hue as small accents only).
- `constants/colors.ts` light palette — do not use it directly. `useColors()` is a compatibility bridge that remaps accent and info tokens to the live app theme.

**Why:** the buyer side shipped with three palettes at once (purple tokens, Vault Archive cream/green leftovers, and a bespoke Discover palette), which read as two different apps. Stale theme memory describing an old rebrand as current made this worse.

**How to apply:** base surfaces and typography come from `lib/theme.ts`; the compatibility `useColors()` background and onboarding must resolve to the same canonical BG (`#07070F`) so buyer, seller, and auth flows never split into navy and near-black variants. Runtime accent/chrome values and multi-stop action gradients come from the shared app-theme provider. Static accent exports are chrome-only startup fallbacks, not screen styling APIs. After a rebrand, grep every route for stale fixed accent hexes, including onboarding and secondary screens. Preserve semantic status colors and intentional artwork/color-picker choices.

**Onboarding visual-background rule:** Matching onboarding's flat `BG` token does not reproduce onboarding's appearance. Its visible silk ribbons, metallic gradients, trails, and particles come from `AnimatedGradientBackground`, currently mounted only by auth/onboarding routes.

**Why:** A prior app-wide background request changed `#07080A` to onboarding's `#07070F`, but the difference was visually negligible and left buyer/seller screens flat because they did not render the layered background component.

**How to apply:** When asked to make app screens look like onboarding, treat it as shared background-layer work, not a hex-token replacement. Mount an appropriate shared layer and ensure route roots do not paint an opaque background over it; verify onboarding and representative buyer/seller screenshots side by side.

**Accent contrast rule:** Text, icons, and loading indicators directly on runtime accent fills use the preset's `onAccent`. Labels on runtime gradients also use the shared inverse text-shadow helper.

**Why:** Chrome and other metallic gradients cross dark and light stops inside one control, so a fixed white label—or even an unshadowed theme foreground—can lose contrast within the same button.

**How to apply:** Use the runtime primary/hero gradients for branded actions, `onAccent` for every direct foreground, and the shared on-accent text style for gradient labels. Do not apply this rule to translucent accent-dim surfaces, semantic status colors, artwork, or arbitrary user-selected colors.
