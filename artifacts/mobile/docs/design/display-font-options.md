# Display font options — Typography/Hierarchy/Copy round

Item 3 asks for "one editorial display face for large headings only" (Discover
section titles, profile name, Thread Cash balance), loaded through
`expo-font`, body text staying on the current sans (Inter). Two options were
installed and evaluated on device at the three call sites:

## Option A — Fraunces (SemiBold, 600) — **chosen**

A high-contrast serif with a slightly warm, editorial feel — closer to
SSENSE/Vogue-adjacent fashion editorial type than a typical app display face.

- Package: `@expo-google-fonts/fraunces`, weight used: `Fraunces_600SemiBold`.
- Reads confidently at both small sizes (profile name, ~20–24pt) and large
  ones (Thread Cash balance, ~34–40pt) without needing italics or optical
  sizing tricks.
- Pairs well against Inter body copy — the serif/sans contrast reads as
  intentional editorial hierarchy rather than a mismatched font pickup.
- Stays monochrome-compatible: no color dependency, renders cleanly in every
  theme's text color.

## Option B — Big Shoulders Display (ExtraBold, 800)

A condensed grotesk (Chicago-style condensed sans) — tall, narrow, very high
contrast against Inter's body weight.

- Package: `@expo-google-fonts/big-shoulders-display`, weight evaluated:
  `BigShouldersDisplay_800ExtraBold`.
- Strong presence at large sizes (Thread Cash balance) but felt tight and a
  little "poster-like" at profile-name sizes — condensed faces lose
  legibility faster as they shrink, and the profile name needs to sit
  comfortably at normal reading sizes next to a username line.
- Reads more streetwear/sport than fashion-editorial, which fit the brand's
  monochrome direction less precisely than Fraunces.

## Decision

**Fraunces_600SemiBold** (`FONT.display` in `lib/theme.ts`) is applied at the
three specified call sites only:

- `app/(buyer)/discover.tsx` — `esh.title` (Discover section titles)
- `app/(buyer)/profile.tsx` — `displayName` (profile display name)
- `app/thread-cash.tsx` — the Thread Cash balance figure (kept on
  `tabularType('display')` for tabular numerals, with `FONT.display` layered
  on top for the typeface)

Both packages remain installed and loaded via `useFonts()` in
`app/_layout.tsx` in case Big Shoulders Display is wanted for a future,
more graphic/campaign-style surface — it is simply not wired into any
component today.
