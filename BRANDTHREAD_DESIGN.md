# BRANDTHREAD_DESIGN.md — the "made by developers, not AI" pass

Put this file at the repo root. Every Claude Code session doing UI work reads it first and follows it. When this file and an older screen disagree, this file wins. When this file and Dev's stated rules disagree, Dev's rules win.

## North star

The seller tab bar is the reference for the whole app. It slides, the glow travels around the bar, and the screen opens. It feels physical, it responds to your thumb, and it isn't decoration. **Do not touch it.** Every other screen must reach the same bar: motion that answers a touch, flat confident layout, real content up front.

## Hard constraints (Dev's rules, unchanged)

- Don't change app structure, tabs, navigation, flows, or features. This pass is restyling only.
- The seller tab bar mechanism stays exactly as it is. The buyer tab bar keeps its look (medium end rounding only).
- Palette: black, white, silver. Thread Cash keeps its green bill. On/off switches use the green track.
- Buttons use the shared button component, with medium corner rounding (not pills, not sharp).
- No content under the notch or Dynamic Island. No translucent bars over the tab bar or content.
- Photos are never cropped badly. Discover keeps 3:4 tiles.
- Screen titles sit in the same spot at the same size everywhere.
- Review everything at 390×844 (iPhone size), never the wide browser view.
- UI changes get a screenshot recap for Dev **before** merging.

## What makes it look AI right now (found in the code)

1. **Inter everywhere.** Inter is the default font of AI-built apps. It's an imitation of Apple's system font, so the app reads as "web app pretending to be iOS."
2. **Every surface is a black box with a thin silver border.** `CARD`, `SURFACE`, and `SELLER_DASHBOARD_GLASS` are all black plus a `BORDER` hairline. Content chopped into identical bordered cards is the #1 AI-kit look.
3. **Tracked-out ALL-CAPS micro-labels** above sections and values (dashboard hero label, balance label, section headers).
4. **Feather icons.** This is the default icon set in generated React Native code. Thin, generic, and not native.
5. **Decorative motion.** Count-up numbers, fade/scale-in on everything, `PressableScale` on non-buttons. Motion that nobody asked for.
6. **Generic copy and chrome.** Sparkles, "AI"-branded everything, upbeat empty states, middle-dot meta strings ("A · B · C"), arrows appended to buttons.
7. **Neon revenue green** (`GREEN_BRIGHT #39FF88`) on a black background. Black plus one acid accent is a known generated look. Thread Cash green is Dev's call and stays; the neon revenue highlight goes.

## The new rules

### Type
- **Use the platform system font** (SF Pro on iOS, Roboto on Android) for all UI text. Remove the Inter font loading. Native apps built by real teams use the system font, and iOS gets Dynamic Type and proper optical sizing for free.
- Scale (iOS-native): Large title 34 bold, title 28 bold, title2 22 bold, headline 17 semibold, body 17 regular, callout 16, subhead 15, footnote 13, caption 12. Use `fontVariant: ['tabular-nums']` on all prices, counts, and money.
- **No all-caps labels.** Section headers are sentence case, 17 semibold, white, left-aligned (see Shopify and Sora). The only exception is SSENSE-style product navigation text on the product page, if Dev wants that editorial touch.
- Hierarchy comes from size and weight, never from letter-spacing or caps.

### Surfaces
- **Kill the bordered card as the default container.** Content sits directly on black. Groups are separated by spacing (24–32pt) and full-width hairline dividers between list rows (Shopify, Telegram).
- Borders are allowed only on: text inputs, secondary/outline buttons, and the selected state of a chip or size option.
- Lists are lists. Rows are 52–60pt tall, have a leading icon or avatar, title + optional subtitle, a trailing value or chevron, and an inset hairline divider. No row is its own card.
- Product and post photos go **edge to edge** in grids with 1–2pt gaps and **no rounded corners** (GOAT, Sora, Savee). Rounding is for avatars, buttons, and sheets.
- ⚠️ **One decision for Dev:** real dark-mode apps (Telegram, Sora, Snapchat, Apple) use **one** elevated near-black grey for inputs, sheets, and grouped rows. That's a big part of why they look finished. Your current rule bans grey fills. This spec respects the rule (inputs use a hairline border instead). If you lift the rule for inputs and bottom sheets only, the app will look noticeably more native.

### Buttons
- One primary (solid white, black text) per screen, maximum. Secondary is a white hairline outline. Tertiary is plain text.
- 50pt tall, medium radius, the label is a plain verb ("Add to bag", "Follow", "Save"). No icons inside buttons unless the icon is the meaning (Apple Pay). No trailing arrows.
- Profile action pairs follow Sora and Cosmos: primary + outline side by side, equal width.

### Icons
- Replace Feather with **SF Symbols on iOS** (via `expo-symbols`) and a matched Material Symbols fallback on Android/web. Use one weight (medium) and sizes 17/20/24 only. This alone removes a big chunk of the "generated" feel.

### Glass
- Real blur (`expo-blur`, or iOS liquid glass where available) is used **only** for floating circular controls over photos/video: back, share, and close on the product page, story viewer, and post viewer (Apple TV, Luma). Never a bar, never over the tab bar.

### Motion
- Keep motion that answers a touch: press feedback on real buttons, sheet presents, the tab bar, and a **shared-element transition** from a product tile to its product page (the photo grows into place, the most "developer-built" moment you can add).
- Remove: count-up numbers, staggered fade-ins on load, and scale effects on non-interactive content. Content appears already there.
- One spring for everything, matched to the tab bar's feel. No mixed timings.

### Copy
- Sentence case, plain verbs, no sparkles/emoji in UI chrome, no exclamation marks.
- Empty states: one line saying what goes here + one action. ("No orders yet." / button: "Share your store".) No illustrations.
- Errors say what happened and what to do. They don't apologize.
- Stop labeling features "AI" in navigation. Name them by what they do ("Photoshoot", "Tech pack"), not how they work.

### Color usage
- Black `#000000` background. White `#FFFFFF` primary text. Silver `#C0C0C0` secondary text. `#8E8E93` tertiary/disabled. Hairlines at white 12–15%.
- Thread Cash green for Thread Cash only. Red only for errors, live, and destructive actions. Delete `GREEN_BRIGHT` and gradient revenue washes.

## Screen references (Mobbin)

**Buyer feed / grids / Discover** — GOAT: products straight on black, no card backgrounds, tiny captions under each tile. [grid](https://mobbin.com/screens/47143e59-4095-4fca-806d-1497f4a7aa32), [editorial full-bleed](https://mobbin.com/screens/0d29eda9-9f99-4d40-ae48-940ae4d6d109), [browse](https://mobbin.com/screens/3d088b98-6516-48b9-a855-c901ad76b360). Savee: [dark photo grid](https://mobbin.com/screens/f12cbd4c-1e38-4d51-ba5c-f818dfabff80).

**Product page** — SSENSE: photo fills the screen, name/brand/price in plain type, sharp primary button + text secondary. [link](https://mobbin.com/screens/b14e5f34-422a-4c21-bbb1-42296092ba2d). Depop for the seller row + offer pattern: [link](https://mobbin.com/screens/7b14cda0-6cae-4ab2-be1a-f77f38546646). lululemon for size selector + Apple Pay: [link](https://mobbin.com/screens/4e0cdcbd-5c18-4544-9bf6-57ba535f309b).

**Profiles (buyer + seller)** — Sora: centered avatar, plain stat row, primary + outline buttons, icon tabs with underline, edge-to-edge grid. [link](https://mobbin.com/screens/4e4e97f4-c2ac-4165-b38b-f80e694487e2). Cosmos: left-aligned variant. [link](https://mobbin.com/screens/95ff49cd-dfe1-452e-a06b-86e9dc0c5365). TikTok for the stat spacing: [link](https://mobbin.com/screens/eb3abdee-6e6c-45d7-921f-29e40926dc7e).

**Messages** — Telegram: "My Story" at top, segmented filter, plain rows with hairlines, time on the right. [link](https://mobbin.com/screens/9d39f706-8ccb-44ef-b6ca-71055f0bb7bc). Clubhouse for story circle + unread dots: [link](https://mobbin.com/screens/036d469f-e8e1-49b0-aa5e-625d9db8d124). Feeld for the minimal story row: [link](https://mobbin.com/screens/c1364cd0-e636-473e-b1f9-0c6a392f9872).

**Seller dashboard / products / orders / settings** — Shopify: list rows and sections, not cards. [setup list](https://mobbin.com/screens/f03c2354-e96b-4351-8ab8-38522d5472ea), [customers](https://mobbin.com/screens/ee48860f-dbd6-4328-8625-6f75b3a42a22), [empty orders](https://mobbin.com/screens/e769d7ab-285f-492a-9eed-676ab780c9d7) (copy pattern only, no illustration). Dashboard hero: big number in plain bold, delta in silver beneath, chart with no gridlines or card around it.

**Onboarding / auth** — Locket (dark): one question per screen, big centered title, one primary button pinned at the bottom above the keyboard. [flow](https://mobbin.com/flows/34fc1d2c-eefd-4f6d-ba82-53df1a21ba09). Netflix for sign-in field labels inside the field: [flow](https://mobbin.com/flows/7a1de398-3e67-4f97-b0d3-322773699692).

**Floating glass controls** — Apple TV: [link](https://mobbin.com/screens/de782436-595d-4d13-ba0e-6d0624cffe44). Luma: [link](https://mobbin.com/screens/633bd9c8-5d58-40db-a0ef-540f0718a941).

## How to run it (Claude Code)

**Session 0 (runs first, everything depends on it): Foundation.**
Update `lib/theme.ts` and the shared components to match this file: system font + type scale, color tokens (remove `GREEN_BRIGHT`, card-glass tokens become plain black with no border by default), shared Button / Input / ListRow / SectionHeader / EmptyState / GlassIconButton components, SF Symbols icon wrapper replacing Feather, one shared spring. Don't restyle screens yet. Add a lint check that flags `Feather` imports, `textTransform: 'uppercase'`, and `letterSpacing > 0.2` in new code. Then merge.

**Sessions 1–5 (run in parallel after Session 0 merges):**
1. Buyer feed, Discover, search, Threads, product grids, product page (with shared-element transition).
2. Buyer + seller profiles, story viewer, post viewer.
3. Messages (buyer + seller), conversations, chat cards.
4. Seller dashboard, Products, Orders, Add Product, Payouts / Thread Cash screens.
5. Onboarding, sign-in, account creation, Settings (buyer + seller), Appearance.

Prompt for each session:
> Read BRANDTHREAD_DESIGN.md first and follow it exactly. Restyle [screens] only. Do not change structure, flows, tabs, or the seller tab bar. Use the shared components from the foundation pass, not one-offs. Base each screen on the Mobbin references listed for it, reskinned in Brandthread's black/white/silver. Check every screen at 390×844 in both fresh (empty) and demo data states. Do not merge. Post a before/after screenshot recap for Dev to approve.

## Dev's addendum (overrides "One decision for Dev" above)

Text inputs and bottom sheets may use ONE solid, opaque near-black gray (`#1C1C1E`). Never glass or translucent fills; everything else stays on pure black.
