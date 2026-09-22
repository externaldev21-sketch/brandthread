# Brandthread design rules

These rules are enforceable. Every change to `artifacts/mobile` (and, where noted, `artifacts/manufacturer-portal`) must follow them. A reviewer can reject a PR by pointing to a rule number.

The bar is Apple, Instagram, TikTok and Depop. Nothing laggy, glitchy or foggy.
If a rule blocks something good, change the rule in this file in the same PR. Don't work around it.

> Where these rules come from: `lib/theme.ts` (static tokens), `contexts/AppThemeContext.tsx` (12 runtime presets), `components/BrandthreadUI.tsx` (primitives) and the app-wide audit in [`punch-list.md`](./punch-list.md). The numbers below were measured on `dev` @ `7e0f547`.

---

## 0. The ten commandments (print this)

1. **Colour comes from the theme, never a literal.** Use `useColors()` or `useAppTheme()`. Don't use `'#fff'`, `rgba(…)`, or static `BG`/`FG`/`CARD`/`MUTED`/`BORDER` in screens.
2. **One of each:** one button family, one header, one sheet, one toast, one empty state, one skeleton. See §9.
3. **Every tap answers within 100 ms:** a scale press plus a haptic, via `PressableScale`. New code never uses `TouchableOpacity`.
4. **No list longer than about 20 items in a `ScrollView`.** Use `FlatList` (or FlashList).
5. **No `Alert.alert` for good news.** Success goes in a toast. Alerts are only for destructive confirmations.
6. **Skeletons, not spinners,** for anything with a known shape. Spinners go inside buttons only.
7. **Text never drops below 11 pt, and body text never below 13 pt.** Contrast must be at least 4.5 : 1.
8. **Animate only `transform` and `opacity`, on the native driver** (or Reanimated). Take 150–350 ms, with no bounce.
9. **Respect the safe area.** Nothing goes under the notch, Dynamic Island, home indicator or tab bar.
10. **Use sentence case, verb-first buttons, and no jargon.** Errors say what happened and what to do next.

---

## 1. Colour and theme

| Rule | Detail |
|---|---|
| 1.1 | Screens and components read colour only from `useColors()` or `useAppTheme().theme`. The static exports in `lib/theme.ts` (`BG`, `CARD`, `FG`, `MUTED`, `SUBTLE`, `BORDER`, `ACCENT`, …) are **deprecated for colour** and may only be used inside `lib/theme.ts`, `constants/colors.ts` and `AppThemeContext.tsx`. |
| 1.2 | No hex or `rgba()` literals in `app/**` or `components/**`. Allowed exceptions: pure black or white **scrims over media** (`rgba(0,0,0,x)` on top of photos or video), brand logos and third-party brand buttons (e.g. Sign in with Apple), and colour swatches that are user data. Mark each exception with `// theme-exempt: <reason>`. |
| 1.3 | Text roles: `text` for primary, `muted` for secondary, `subtle` for tertiary. **Never lower text opacity on top of `muted` or `subtle`.** Stacked opacity is what makes text look "foggy". |
| 1.4 | Status colours come from the theme: `success`, `warning`, `error` (`useColors().success`/`.warning`/`.destructive`). Never use the static `RED`, `ORANGE` or `SUCCESS` for text on coloured themes. |
| 1.5 | **Pair accent surfaces correctly.** On a solid `accent` or `primaryGradient` fill, text and icons use `theme.onAccent`. **Never use `'#fff'` or `ON_DARK` there:** every one of the 12 presets has a *light* accent, so white on accent is invisible. The audit found about 30 such spots, including the Buy now button, the share-store QR code and chat bubbles. On a tinted `accentDim` fill, text uses `theme.accentLight`, not `onAccent`, which comes out dark on dark (the FilterChip active state measures 1.6–2.8 : 1). Don't add a text shadow to dark text on a light fill. It blurs the glyphs. |
| 1.5a | **`useColors().muted` is a surface colour, not a text colour.** It resolves to `surfaceGlass`. Secondary text uses `useColors().mutedForeground` (or `theme.muted`). The audit found 30 call sites that use `colors.muted` for text, at about 1.05 : 1. Rename the key to `mutedSurface` so this can't recur. |
| 1.6 | Gradients must pass contrast at **both stops**, not just at the midpoint. Today the Leopard red, Maroon and Navy `primaryGradient` left stops fail against `onAccent` (2.3–3.4 : 1). Darken those stops, or use a flat `accent` for buttons. |
| 1.7 | Every new or changed screen is checked on **Monochrome, Purple, Olive and Maroon** before merging. On web dev, use `?bt_theme=<id>`. A black patch on a coloured theme fails review. |

**Why:** 192 of 241 screens import static colours, and there are 811 hex literals. The static `MUTED` (white at 58%) measures **3.5 : 1 on the Olive, Silver and Emerald cards**, which fails AA. The runtime `theme.muted` measures at least 5.4 : 1 on every preset.

## 2. Contrast

| Element | Minimum (WCAG 2.2) |
|---|---|
| Body text and anything under 17 pt | **4.5 : 1** against the surface it actually sits on |
| Large text (17 pt+ semibold, or 22 pt+) | 3 : 1 |
| Icons that carry meaning, and input outlines | 3 : 1 |
| Placeholder text | 4.5 : 1. Use `muted`, never `subtle` or opacity. |
| Disabled controls | Exempt. Show disabled as **40% opacity on the whole control**, not by greying the label only. |
| Text over photo or video | Needs a scrim (`rgba(0,0,0,0.35–0.55)` gradient). Never text on raw media. |

## 3. Spacing (4-pt grid)

- **Allowed values:** `4, 8, 12, 16, 20, 24, 32, 40, 48, 64`. Anything else (3, 5, 6, 7, 9, 10, 13, 14, 18) needs a comment explaining it.
  - Add `SP.smd = 12` and `SP.mdl = 20` to `lib/theme.ts`. They're already used more than 500 times as raw numbers.
- **Screen gutter:** 16 on iPhone and 24 on iPad. Use one value per screen. Don't mix 14, 16 and 20 on the same screen.
- **Vertical rhythm:** 8 between related elements, 16 between groups, 24–32 between sections.
- **Card padding:** 16 (compact 12). **List row:** at least 52 tall, with 16 horizontal padding.
- **Bottom of scroll content** on tab screens: `tabBarHeight + insets.bottom + 24`. On stack screens with a sticky CTA: `ctaHeight + insets.bottom + 24`.
- **iPad:** reading and form content has a max width of **680**, centred. Grids gain columns (2 → 3–4) instead of stretching. Full-width buttons have a max width of **480**.

## 4. Type scale (Inter)

| Token | Size / line height | Weight | Use |
|---|---|---|---|
| `largeTitle` | 30 / 36 | 700, tracking −0.4 | Tab-root titles only |
| `title1` | 26 / 32 | 700, −0.3 | Hero numbers, profile names |
| `title2` | 22 / 28 | 700, −0.3 | Pushed-screen titles in large mode, section heroes |
| `title3` | 19 / 24 | 600 | Card titles |
| `headline` | 17 / 22 | 600 | Header titles, list primary text |
| `body` | 15 / 21 | 400 | Paragraphs, inputs |
| `callout` | 15 / 20 | 500 | Buttons (600 for secondary, 700 for primary) |
| `footnote` | 13 / 18 | 400–500 | Secondary lines, helper text |
| `caption` | 11 / 14 | 500–600, +0.2 | Badges, timestamps and tab labels only. **Never sentences.** |

- The only weights are 400, 500, 600 and 700. `FONT.thin`/`light`/`extrabold` are aliases. Don't use them.
- Don't use 12 or 14 pt in new code. Snap to 11, 13 or 15. The audit found 222 uses of 12 pt and 181 of 14 pt, which makes the hierarchy mushy.
- ALL CAPS is allowed only for ≤2-word eyebrow labels (11 pt, 600, +0.8 tracking). Never on buttons.
- Any text that can grow (names, titles, prices, addresses) sets `numberOfLines` and handles truncation.
- Support Dynamic Type up to at least 1.3×. Don't put fixed `height` on a container that holds text.

## 5. Shape: radii and borders

| Token | Value | Use |
|---|---|---|
| `RADIUS.xs` | 6 | Badges, small tags |
| `RADIUS.sm` | 10 | Thumbnails, small inputs inside cards |
| `RADIUS.md` | 14 | **Buttons, inputs, list-group containers** |
| `RADIUS.lg` | 18 | **Cards, tiles, media** |
| `RADIUS.xl` | 24 | **Bottom-sheet top corners**, modals |
| `RADIUS.pill` | 999 | Chips, segmented controls, pills |
| circle | size/2 | Avatars, icon buttons |

- Nested radius equals the outer radius minus the padding. A 14-radius button inside an 18-radius card with 4 padding is fine. The same button inside a card with 16 padding should be 14, never 18.
- The audit found about 25 distinct radius values. Anything not in this table is a finding.

**Borders**

| Weight | Use |
|---|---|
| `StyleSheet.hairlineWidth` | Dividers between list rows only |
| **1** | Cards, inputs, secondary buttons, chips. **This is the default.** |
| 1.5 | Focused input, selected chip or card |
| 2 | Story rings, selected colour swatch. Nothing else. |

- The border colour for interactive outlines is `theme.border` (white at 17%). Dividers use `theme.borderSubtle`. **Never use a 4–7% white border on anything tappable.** It reads as fog, not as an outline.
- Don't combine a border and a heavy shadow on the same element. Pick one.

## 6. Touch targets and press feedback

- **Minimum 44 × 44 pt hit area.** Use `hitSlop` to reach it when the visual is smaller (e.g. a 28-pt icon).
- At least 8 pt between adjacent targets.
- All tappables use `PressableScale` (scale 0.97, opacity 0.85) or a component built on it.
  - `TouchableOpacity` is banned in new code: its default 0.2-opacity flash reads as a glitch. It's used in 242 files today.
  - `Pressable` without a pressed style is banned.
- **Haptics** (`lib/haptics.ts`):

| Moment | Haptic |
|---|---|
| Tab switch, chip or segment change, toggle, picker tick | `hapticSelection` |
| Secondary button, icon button, row tap that opens something | `hapticLight` |
| Primary commit (Post, Pay, Save, Publish, Add to bag) | `hapticMedium` on press |
| Result of an async action | `hapticSuccess` / `hapticError` when it resolves |
| Like, double-tap like, follow | `hapticLight` |

- Never fire two haptics for one gesture, and never fire one on scroll.

## 7. Motion

| Token | Duration | Easing | Use |
|---|---|---|---|
| `instant` | 100 ms | `Easing.out(Easing.quad)` | Press in and out, toggles |
| `fast` | 150 ms | `Easing.out(Easing.cubic)` | Fades, content swapping in after load, toasts out |
| `normal` | 250 ms | `Easing.bezier(0.2, 0, 0, 1)` | Enter and exit, tab content, expanding rows |
| `slow` | 350 ms | `Easing.bezier(0.2, 0, 0, 1)` | Sheets, full-screen overlays |
| spring | — | `damping 20, stiffness 220, mass 1` (Reanimated) | Drag release, sheet snap. **Overshoot ≤ 2%.** |

- **The maximum for any UI transition is 400 ms.** The audit found 10 animations at 700 ms and several at 600–950 ms. Only ambient loops (live dot, shimmer) may run longer.
- Animate `transform` and `opacity` only. `useNativeDriver: true` is mandatory. For layout, colour or height animation, use **Reanimated** (it's installed, and currently used in 0 files). The audit found `useNativeDriver: false` in 10 places.
- Exits are about 30% faster than enters.
- Stagger lists by at most 30 ms per item, and at most 6 items (180 ms total). Never stagger on re-render or on returning to a screen.
- **No layout jumps.** Reserve the height of async content: a skeleton with the same size, or a fixed media aspect ratio.
- **No spinner flash.** Delay loaders by 300 ms. If data arrives sooner, show content directly.
- Screen transitions use `slide_from_right` for push, `slide_from_bottom` for modal flows, and `fade` only for auth/role switches and splash to app. Gestures stay enabled except mid-payment or mid-upload.
- Respect **Reduce Motion** (`AccessibilityInfo.isReduceMotionEnabled` or Reanimated's `useReducedMotion`). Replace slides and scales with a 150 ms fade.
- Nothing bounces forever. Pulsing CTAs and wiggling icons are banned, except live indicators.

## 8. Performance budgets

| Rule | Budget |
|---|---|
| 8.1 Lists | Any list that can hold more than 20 items, or is unbounded, uses `FlatList`/FlashList with `keyExtractor`, memoized rows (`React.memo`) and stable callbacks. `ScrollView` + `.map` is allowed only for ≤20 known items. |
| 8.2 Images | `expo-image` everywhere, with `cachePolicy="memory-disk"`, `transition={150}`, a tinted placeholder, and a size that fits the container (request thumbnails, not originals). RN `Image` is banned in new code (20 files today). |
| 8.3 Video | Muted autoplay only while ≥ 60% visible. Pause and release when off-screen or when the app is backgrounded. At most one playing video at a time. |
| 8.4 First paint | A tab-root screen shows its skeleton in < 100 ms and content in < 1 s on a warm cache. No `await` before the first render. |
| 8.5 Mount work | No synchronous parse, sort or format of more than 500 items in render. Memoize it (`useMemo`) or do it on the server. |
| 8.6 Timers | Every `setInterval`, poll, listener or subscription is cleared on unmount and paused when the screen is blurred (`useFocusEffect`). |
| 8.7 File size | A screen file over **800 lines** must be split before new features are added to it. There are 45 such files today, and `design-canvas.tsx` alone is 5,387 lines. |
| 8.8 Gestures | Drag, pinch and rotate (canvas, text overlay, sheets) run on the UI thread with `react-native-gesture-handler` and Reanimated, not `PanResponder` with `setState`. |
| 8.9 Frame rate | 60 fps on iPhone 12 (120 fps on ProMotion) while scrolling feeds and grids. Anything that drops frames in a Release build is a P1. |

## 9. The canonical component set

| Pattern | Use this | Don't use this |
|---|---|---|
| Primary action | `PrimaryButton` (52 h, radius 14, 700 / 15 pt, `onAccent` text, `loading` state) | Bespoke `TouchableOpacity` + `LinearGradient` |
| Secondary action | `SecondaryButton` (1 pt `theme.border` outline) | — |
| Text action | `TertiaryButton` | — |
| Destructive action | `SecondaryButton` with `accent={colors.destructive}` | Filled red buttons (except in a final confirm sheet) |
| Icon action | `IconButton` (44 × 44) | — |
| Pushed-screen header | `ScreenHeader` | Bespoke header rows. `BrandthreadHeader` and `ScreenHeader` must merge into one. |
| Tab-root header | `ScreenHeader` large-title variant (to add) | — |
| Bottom sheet | One new `BottomSheet` in BrandthreadUI, built from `ShopProductSheet`'s motion: radius 24 top, internal handle, a 72% scrim that **fades** separately (it never slides up with the sheet), `slow` spring, swipe to dismiss, keyboard-aware, bottom inset | Raw `<Modal animationType="slide">` per screen (50 files today) |
| Success / info feedback | Rename `UndoToastProvider` to `ToastProvider`, exposing `showToast({ message, variant, action? })`. Show it above the tab bar and safe area, for 2.5 s, with the haptic that matches the variant. | `Toast`, `FeedToastProvider` and `Alert.alert('Success', …)`. Four toast systems exist today. |
| Inline error | `InlineFeedback` under the field or section | Red text styled locally |
| Destructive confirm | Native action sheet, or the `Sheet` confirm variant | `Alert.alert` with three buttons |
| Empty state | `EmptyState` (icon, title ≤ 5 words, one-sentence body, one primary action) | Centred grey "No data" text |
| Loading (content) | `LoadingSkeleton` / `FeedSkeleton` / `ProductGridSkeleton` / `CheckoutSkeleton`. Fill is **8% white, pulsing 0.55↔1**; today's 5% fill measures 1.1 : 1 and is effectively invisible. The skeleton must match the final layout's shape. | `ActivityIndicator` in the middle of the screen (124 files today); ad-hoc `SkeletonBlock`s |
| Loading (blocking, > 1 s) | `BrandedLoadingState` with a real message | Bare spinners, "Loading..." |
| Text input | `FormInput` (52 h, radius 14, 1 pt border, 1.5 pt focus border, label above, helper and error below) | Placeholder-as-label |
| List row | `NavigationCard` / a settings `Row` (≥ 52 h, 16 padding, chevron `muted`) | Bespoke rows per settings screen |
| Chips | `FilterChip` (active label `accentLight`) | `OptionChip` and other local chips |
| Badges | `StatusBadge`, plus one `orderStatusBadge(status)` map shared by every order screen | `components/Badge.tsx`, `NewFeatureBadge`, `LockBadge` (merge these in as variants), locally coloured status pills |
| Tab bar | One `FloatingTabBar` shared by buyer and seller: 11 pt labels, a pressed state and `hapticSelection`, `navigate` rather than `replace`, scroll to top on re-tap, `maxWidth: 560` on iPad | The separate seller full-width band and buyer capsule |
| Images | `CachedImage` (expo-image) with a neutral dark placeholder | RN `Image`, and the colourful demo blurhash as the default placeholder |
| Icons | `Feather` (outline, 1.5–2 stroke) at `ICON` sizes (16/20/24) | Mixing Ionicons, MaterialIcons or emoji as UI icons |

## 10. Layout and safe area

- Every root view handles `useSafeAreaInsets()` (or `BrandthreadScreen`). Don't use hardcoded top paddings like 44, 47, 50 or 59.
- Sticky bottom CTAs sit at `bottom: insets.bottom + 12` over a `background`-coloured fade. They must never touch the home indicator.
- Keyboard: every screen with inputs uses `KeyboardAwareScrollViewCompat` (or `react-native-keyboard-controller`). The focused input and the submit button must stay visible.
- On landscape iPad, respect the left and right insets. Split views must not clip.
- Web: honour the same max widths. No horizontal page scroll at 360 px.

## 11. Copy and voice

**Voice:** confident, fashion-forward, concise and human. Depop's warmth with Apple's restraint. The user is a creator, so talk to them like one.

| Rule | Do | Don't |
|---|---|---|
| Casing | Sentence case everywhere: "Add to bag", "Order details" | "Add To Cart", "ORDER DETAILS" |
| Buttons | Verb first, 1–3 words: "Post", "Save changes", "Share store" | "Click here", "Submit", "OK" (as a CTA) |
| Titles | Nouns, 1–3 words: "Orders", "Payouts" | "Manage Your Orders Dashboard" |
| Errors | What happened, then what to do: "Couldn't load orders. Pull to refresh." | "Error", "Something went wrong", "Failed to fetch", raw `error.message` |
| Empty states | Why, then the next step: "No drops yet. Post your first piece and it lands here." with the button [Create post] | "No data", "Nothing here", "Empty" |
| Success | Past tense, ≤ 4 words: "Saved", "Order shipped", "Link copied" | "Successfully saved!", "Success!" |
| Destructive | Name the consequence: "Delete product? This can't be undone." with the buttons [Delete] and [Cancel] | "Are you sure?" |
| Loading | Say what's happening: "Loading orders…", "Building your store…" | "Please wait…", "Stitching things together…" on a 200 ms load |
| Punctuation | "…" (the real ellipsis). No "!!" or "?!". At most one "!" per flow, for real celebration. | "..." and exclamation spam |
| Numbers | "$1,240.00", "1.2k", "3 items". Use `lib/money.ts` / `lib/format.ts`. | "$1240", "1 items", "NaN", "$undefined" |
| Jargon | "AI-generated", "Remove background" | "Nano Banana", "Gemini", "model", "endpoint", "API", "payload", "webhook", "SKU sync", "null" |
| Pronouns | "Your store", "your orders" | "My Store" in one place and "Your Store" in another |
| "Please" | Only when you're asking a favour | "Please enter your email" (use "Enter your email") |

**Glossary (one word per concept)**

| Concept | Use | Never |
|---|---|---|
| Shopping container | **Bag** | Cart, basket. The code splits about 80/80 today, so pick one. |
| Seller's shop | **Store** | Shop, storefront (in UI copy) |
| Social post | **Post** | Thread (except for the "Thread" feature), content piece |
| Limited release | **Drop** | Launch, release |
| Money out to seller | **Payout** | Withdrawal, transfer |
| Buyer account type | **Shopper** in marketing, **Buyer** in settings | Customer (reserve that for the seller's view of buyers) |
| Seller plan | **Plan** | Subscription tier, package |

## 11a. Honesty rules (no fake UI)

These are the most common P0 in the audit. There are more than 150 of them.

- **Never claim success without a successful API response.** Nothing that shows "Saved", "Link copied", "Export complete" or "Deleted" may run before, or instead of, the real call.
- **No dead controls.** A button with no `onPress`, or one that only fires a haptic, is not allowed to ship. Hide it or remove it. For a real roadmap item, use a disabled row with the caption "Coming soon", and never in a primary flow.
- **No demo, seed or placeholder data outside `__DEV__`.** This covers fake names ("Jordan", "Maya Chen"), fake bank accounts, fake metrics and fake integrations shown as "Connected".
- **Errors are never shown as empty states.** A failed fetch shows an `InlineError` with a retry, not "No orders yet" and never "$0.00 · All caught up".
- **No fake progress.** Progress bars reflect real progress. If progress is unknown, show an indeterminate state and honest copy ("Usually under a minute").
- **Never show raw `error.message`** or server strings to users. Map them to human copy (§11) and log the original.
- **Screens with no route to them are deleted,** not polished.

## 12. Accessibility minimums

- Every icon-only button has an `accessibilityLabel` written as a verb ("Close", "Share post").
- Custom toggles and chips set `accessibilityState`.
- Focus order follows visual order. Modals trap focus.
- Colour is never the only signal. Status badges carry a label.

## 13. Enforcement

Run these from `artifacts/mobile` in CI or before opening a PR. A PR that increases any count fails review.

```bash
# 1.2 hex literals in screens and components (should trend to 0)
grep -rhoE "'#[0-9A-Fa-f]{3,8}'" app components --include=*.tsx | wc -l          # baseline 811
# 1.1 static colour imports
grep -rlE "\b(BG|CARD|FG|MUTED|SUBTLE|BORDER|ACCENT)\b.*from '@/lib/theme'" app --include=*.tsx | wc -l
# 6 TouchableOpacity
grep -rl 'TouchableOpacity' app components --include=*.tsx | wc -l                # baseline 242
# 7 non-native-driver animations
grep -rn 'useNativeDriver: false' app components --include=*.tsx | wc -l         # baseline 10
# 9 success alerts
grep -rnE "Alert.alert\(['\"](Success|Saved|Done|Great)" app --include=*.tsx | wc -l   # baseline 26
# 1.5a `muted` used as a text colour (it's a surface)
grep -rnE "color: (colors|c|palette)\.muted[,} ]" app components --include=*.tsx | wc -l   # baseline 30
# 11a dev/vendor words in UI strings
grep -rnE "Nano Banana|GPT-[0-9]|OpenAI|backend wiring|production build|Server-side enforcement" app components --include=*.tsx | wc -l   # baseline 12 (includes code comments)
# 8.2 RN Image
grep -rlE "\bImage\b.*from 'react-native'" app components --include=*.tsx | wc -l                   # baseline 9 (single-line imports)
# 4 off-scale font sizes
grep -rnoE 'fontSize: ?(12|14)\b' app components --include=*.tsx | wc -l          # baseline ~400
```

Recommended ESLint rules (add them once the other sessions land):
- `no-restricted-imports`: `TouchableOpacity` and `Image` from `react-native`, and colour names from `@/lib/theme`.
- `no-restricted-syntax`: `Literal[value=/^#[0-9a-f]{3,8}$/i]` in `app/**` and `components/**`, and the property `useNativeDriver: false`.

## 14. PR checklist (paste into every UI PR)

- [ ] Checked on iPhone SE (375), iPhone 15 Pro (393), and iPad (1024) portrait
- [ ] Checked on the Monochrome and Purple themes (plus one light-accent theme such as Gold)
- [ ] No new hex literals, static colour imports, `TouchableOpacity` or `Alert.alert` for success
- [ ] Loading shows a skeleton, empty shows `EmptyState`, error shows a retry with human copy
- [ ] Every button gives press feedback and the right haptic, and every async button has a loading state and double-tap protection
- [ ] Long lists are virtualized, images use `expo-image`, and animations use the native driver or Reanimated at ≤ 400 ms
- [ ] Copy follows §11: sentence case, verb-first, no jargon, glossary words
- [ ] No fake success, dead buttons, demo data or raw error text (§11a)
- [ ] Nothing drawn in white on `accent` (§1.5)
- [ ] Nothing is hidden under the notch, home indicator, keyboard or tab bar
