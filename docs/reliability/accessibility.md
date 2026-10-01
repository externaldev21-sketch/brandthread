# Accessibility

What the app does for screen readers (VoiceOver, TalkBack) and for people who
raise their system text size, how to test it, and what is still missing.
Everything here is additive: at the default text size with no screen reader the
app looks and behaves exactly as before (checked by a 393x852 screenshot diff,
see "Regression checks").

## What is covered

### Labels, roles and state (fixed in shared primitives)

| Where | What |
| --- | --- |
| `components/ui/IconButton.tsx` | `accessibilityLabel` is now optional. When omitted or blank it is derived from the icon name (`arrow-left` Back, `x` Close, `heart` Like, `send` Send, `more-horizontal` More options, `search`, `plus`, `share`, `shopping-bag` Cart, ...). An explicit label always wins. |
| `components/BrandthreadUI.tsx` | Legacy `IconButton` uses the same mapping (it used to speak "arrow left"). `PressableScale` forwards `disabled` to `accessibilityState`. `BrandthreadHeader` back button is labeled "Back" and its title is a header. `SectionHeader` title is a header. `Toast` is a live region (assertive for errors). Button labels are font-scale capped. |
| `lib/a11y/iconLabels.ts` | The icon-name to label table (unit tested). |
| `components/ScreenHeader.tsx`, `components/SectionHeader.tsx` | Titles use `accessibilityRole="header"`; the section action link has a role and label. |
| `components/ui/ListRow.tsx` | The toggle switch inside a row is labeled with the row title. |
| `components/ui/BottomSheet.tsx`, `ActionSheet.tsx` | Sheet container marked modal (`accessibilityViewIsModal` on native, `aria-modal` on web, via `lib/a11y/modal.ts`) so focus stays inside. |
| `components/ui/Snackbar.tsx` | Already a live region; the decorative thumbnail is now hidden from assistive tech. |
| `components/CachedImage.tsx` | An image with `alt` or `accessibilityLabel` is exposed; one without is treated as decorative (`accessible={false}`) so cards are not announced twice. Pass `alt={product.name}` for product imagery. |
| Already in place (unchanged) | Tab bars (`role=tab`, `selected`), `Chip`/`FilterChip` (`selected`, `disabled`), `SegmentedControl`, `HapticSwitch` (`role=switch`, `checked`), `Button` (`disabled`, `busy`), `QuantityStepper`, `UndoToast` live region. |

### Top-journey screens (props only)

Icon-only controls and unlabeled inputs that primitives cannot fix: sign-in
(email/phone, password, code), forgot password (back, show/hide password, all
inputs), onboarding (inputs, show/hide password), Discover feed header
(search, close search, notifications), post viewer (repost, save, report,
share), product detail (edit), edit profile (username input, copy link),
seller conversation (close picker), friends feed (open comments), chat media
viewer (close, share, save), support chat (close, send, open).

### Dynamic type

React Native text already follows the OS text size with no upper bound. The
change is a cap, `maxFontSizeMultiplier`, from `lib/dynamicType.ts`:

- 1.3 for dense UI: headers, section headers, buttons, chips, badges, toast text, display/title/headline/caption roles.
- 1.6 for body, callout and footnote text (`AppText`, `ListRow`).
- `SegmentedControl` (1.2) and the tab-bar badge (1.1) keep their existing caps.

The cap never applies at the default size, so nothing moves. The caps are what
keep text inside the fixed-height buttons and chips: the tallest label
(headline 22 line height at 1.3) still fits the 36/44/52pt button heights.
Those fixed `height` values were deliberately NOT changed to `minHeight`: a
trial showed it is not pixel-identical, because a `height` can flex-shrink
inside a constrained parent (the product page's "Add to cart" bar) while a
`minHeight` cannot, so the button grew from its current look.

Why per element and not one global default: the app builds with React's
automatic JSX runtime, which ignores `Text.defaultProps` (React 19 dropped it
for function components, and React Native's `Text` is one), so a global
default is a silent no-op. Screens that use RN `Text` directly keep uncapped
OS scaling, as before.

## How to test

### VoiceOver (iOS)
Settings > Accessibility > VoiceOver (or triple-click the side button if set as the shortcut). Swipe right through each screen: every icon button should be announced with a verb ("Back, button", "Like, button"), tabs as "Home tab, selected", headings as "heading", switches as "on/off". Open a sheet: focus should stay in the sheet. Trigger an error toast: it should be read without moving focus.

### TalkBack (Android)
Settings > Accessibility > TalkBack. Swipe right to walk the screen; double-tap to activate. Same expectations as above ("Back, button", "Selected" on tabs, "Heading").

### Dynamic Type (iOS)
Settings > Accessibility > Display & Text Size > Larger Text, turn on Larger Accessibility Sizes and drag to the maximum. Reopen the app. Check: Discover header, tab bar, a product card, cart row, checkout button, inbox row, profile header. Text should grow up to the caps above and wrap or truncate; buttons grow taller; nothing should overlap the tab bar or fall under the notch. Return the slider to the default when done.

### Font scale (Android)
Settings > Display > Font size and style > Font size, set the largest step (and "Display size" largest as a second pass). Same checks.

### Automated
- `pnpm --filter @workspace/mobile exec vitest run tests/a11y-primitives.test.ts tests/a11y-icon-only-lint.test.ts`
- `node artifacts/mobile/scripts/a11y-visual-diff.mjs build|capture|compare` renders 16 screens at 393x852 and reports the pixel diff between two builds.

Web has no OS text scaling hook, so enlarged-text behavior can only be checked
on a device; the caps are unit tested as `scaledFontSize(base, osScale, cap)`.

## Regression checks

- `tests/a11y-icon-only-lint.test.ts` statically finds pressables that contain an icon and no text and have no `accessibilityLabel`. It compares against `docs/audit/a11y-icon-only-baseline.json` (per-file counts) and fails if any file gets worse. Lower the numbers as screens are fixed; regenerate with `A11Y_UPDATE_BASELINE=1`.
- The screens fixed in this PR are pinned at zero.

## iPad

Left as it is: `ios.supportsTablet: true`. Setting it to `false` would run the
app as a letterboxed iPhone app but it (1) changes the native fingerprint, so
with `runtimeVersion.policy = "fingerprint"` OTA updates stop reaching already
installed builds, (2) changes the App Store device families, and (3)
contradicts `docs/app-store/ipad-release-checklist.md` and a test in
`scripts/app-store-config.test.ts` that pin iPad support. The app also has
tablet-aware layout (`components/buyer-nav/buyerTabBarMetrics.ts`,
`components/layout/useBreakpoint.ts`, `app/ai-brain.tsx`). Web is unchanged:
the phone layout stays centered at wider widths.

## Known gaps

- About 130 icon-only pressables in other screens still lack labels (mostly the Design Studio and store editor screens owned by other work); they are listed in the baseline file.
- Most screens render text with RN `Text` directly, so they have no cap and can grow past 1.6x at the largest accessibility sizes. Migrating to `AppText` fixes that screen by screen.
- Many product and post images have no `alt`. Pass the product name where a card image is the only content.
- No focus management on route change and no `announceForAccessibility` on skeleton-to-loaded transitions yet.
- Custom gestures (swipe to delete, swipe to reply, feed pager) have no alternative action exposed to screen readers.
- Color contrast is governed by the design rules, not audited here.
