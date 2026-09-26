# Buyer settings & account — visual rebuild

Cluster: buyer settings & account, `artifacts/mobile/app/`. Scope, method and
Mobbin research per the session brief; see
[04-buyer-commerce-settings.md](./04-buyer-commerce-settings.md) for the prior
line-item audit of this slice (pre-dates this pass — several items it flags
were already fixed on `dev` before this session started; this doc reflects
the state found and changed here).

**Finding going in:** most of this cluster (`buyer-settings`, `buyer-settings-detail`,
`buyer-account-center`, `buyer-addresses`, `buyer-payment-methods`,
`notifications-settings`, `push-notifications`, `delete-account`, `help`,
`customer-accounts`, `customer-privacy`) already used the shared
`Card`/`ListRow`/`SectionHeader` grouped-list pattern from
`components/ui` and `components/BrandthreadUI.tsx`, already read colors via
`useColors()`/`useAppTheme()`, and already matched the Airbnb/Revolut/Threads
grouped-settings language (section caps header → rounded card → hairline
divider rows → chevron/toggle/destructive text color). Screenshots below
confirm those did not need a rebuild. Effort went into the three screens that
were genuinely weak or broken, plus one new shared primitive used to fix the
worst inconsistency (native `Alert.alert` pickers) at the root.

## Shared component change (visible to other clusters)

**Added** `artifacts/mobile/components/ui/OptionSheet.tsx`, exported from
`components/ui/index.ts`. It is new/additive only — no existing export's
behavior changed, so it is safe for the other three sessions sharing
`components/ui`. It wraps the existing `BottomSheet` + `ListRow` in a
grouped, sentence-case radio-list picker (icon, label, description, trailing
check) — the pattern every reference screen below uses for "who can see/do
X" pickers, replacing native `Alert.alert` button lists (Title Case, no
descriptions, OS chrome that breaks the app's own visual language). Only
`buyer-privacy-settings.tsx` uses it today; any other settings screen with a
single-choice picker can adopt it instead of another one-off `Alert.alert`.

## Screens

| Screen | Mobbin references | What changed | Before | After |
|---|---|---|---|---|
| [buyer-settings.tsx](../../../artifacts/mobile/app/buyer-settings.tsx) | [Linktree Settings](https://mobbin.com/screens/e7c9f732-be29-4018-9d32-4aa29159594c) | Already matched the grouped-list pattern (profile card, search, `SectionHeader` + `Card`/`ListRow` groups, destructive sign-out/delete rows). Left as-is. | [before](../screenshots/buyer-settings/buyer-settings-before-390x844.png) | same |
| [buyer-settings-detail.tsx](../../../artifacts/mobile/app/buyer-settings-detail.tsx) | [Linktree Settings](https://mobbin.com/screens/e7c9f732-be29-4018-9d32-4aa29159594c) | Already `Card`/`ListRow`, theme-aware. Left as-is. | [before](../screenshots/buyer-settings/buyer-settings-detail-before-390x844.png) | same |
| [buyer-account-center.tsx](../../../artifacts/mobile/app/buyer-account-center.tsx) | [Linktree Settings](https://mobbin.com/screens/e7c9f732-be29-4018-9d32-4aa29159594c) | Already `Card`/`ListRow`, theme-aware hero card. Left as-is. | [before](../screenshots/buyer-settings/buyer-account-center-before-390x844.png) | same |
| [buyer-account-control.tsx](../../../artifacts/mobile/app/buyer-account-control.tsx) | — | One-line re-export of `delete-account.tsx` (legacy route alias). Nothing to restyle. | [before](../screenshots/buyer-settings/buyer-account-control-before-390x844.png) | same |
| [buyer-addresses.tsx](../../../artifacts/mobile/app/buyer-addresses.tsx) | [Whatnot Payments & Shipping](https://mobbin.com/screens/648c7bc7-bd10-4999-8a2b-36f09052e25a) | Already a clean grouped card list with default badge, edit/delete icon buttons, dashed "Add" CTA and a proper `EmptyState`. Left as-is. | [before](../screenshots/buyer-settings/buyer-addresses-before-390x844.png) | same |
| [buyer-payment-methods.tsx](../../../artifacts/mobile/app/buyer-payment-methods.tsx) | [Whatnot Payments & Shipping](https://mobbin.com/screens/648c7bc7-bd10-4999-8a2b-36f09052e25a) | Already a clean card list with brand pill, default badge, trust copy footer. Left as-is. | [before](../screenshots/buyer-settings/buyer-payment-methods-before-390x844.png) | same |
| **buyer-privacy-settings.tsx** | [AllTrails "List privacy level"](https://mobbin.com/screens/d63447a1-7f4d-469c-825c-0cada92f5709), [X "Who sees this"](https://mobbin.com/screens/63ce8dfc-d16b-49cf-b698-7a3975746c93), [Alta look-privacy sheet](https://mobbin.com/screens/e9f8a428-84a7-40d3-add0-38b3e9c16dce) | **Rebuilt the pickers.** Every "who can…" row opened a native `Alert.alert` button list (Title Case, no descriptions, OS-styled). Replaced all 7 with the new `OptionSheet` — a grouped bottom sheet matching the AllTrails/X/Alta reference: icon + label + one-line description per option, trailing check on the active choice. Added a `ListSkeleton` for the initial load (was a blank view). Sentence-cased section headers ("Who can see and contact you", "Search and discovery", "Blocked and muted") and copy ("Only people you follow can message you" — was the DM description backwards from the actual behavior). Errors now show inline instead of nowhere. | [before](../screenshots/buyer-settings/buyer-privacy-settings-before-390x844.png) | [after 390×844](../screenshots/buyer-settings/buyer-privacy-settings-after-390x844.png) · [375×667](../screenshots/buyer-settings/buyer-privacy-settings-after-375x667.png) · [430×932](../screenshots/buyer-settings/buyer-privacy-settings-after-430x932.png) · [1440×900](../screenshots/buyer-settings/buyer-privacy-settings-after-1440x900.png) |
| [buyer-login-activity.tsx](../../../artifacts/mobile/app/buyer-login-activity.tsx) | — | Re-export of `components/security/LoginActivity.tsx`, **shared with the seller's `app/login-activity.tsx`** (owned by another session's cluster). Left untouched — editing it would restyle a screen outside my cluster. | [before](../screenshots/buyer-settings/buyer-login-activity-before-390x844.png) | same |
| [customer-accounts.tsx](../../../artifacts/mobile/app/customer-accounts.tsx) | — | Already an honest "not available yet" empty state (no fabricated settings) matching the app's `EmptyState` language. Left as-is. | [before](../screenshots/buyer-settings/customer-accounts-before-390x844.png) | same |
| [customer-privacy.tsx](../../../artifacts/mobile/app/customer-privacy.tsx) | — | Same as above. Left as-is. | [before](../screenshots/buyer-settings/customer-privacy-before-390x844.png) | same |
| [delete-account.tsx](../../../artifacts/mobile/app/delete-account.tsx) | [Glassdoor "Privacy Choices"](https://mobbin.com/screens/6924225a-6513-48a1-a84d-88be12872494) | Already a well-built 3-step flow (overview → confirm → done) with a real blocker checklist, type-DELETE confirmation and correct destructive-red CTA. Left as-is (visual only, no logic touched). | [before](../screenshots/buyer-settings/delete-account-before-390x844.png) | same |
| [notifications-settings.tsx](../../../artifacts/mobile/app/notifications-settings.tsx) | [Remote Global HR Settings](https://mobbin.com/screens/b86741f4-2e32-49fc-834c-87b0fb5e3d32) | Already `Card`/`ListRow` with a segmented digest control and per-category toggles. Left as-is. | [before](../screenshots/buyer-settings/notifications-settings-before-390x844.png) | same |
| [push-notifications.tsx](../../../artifacts/mobile/app/push-notifications.tsx) | [Remote Global HR Settings](https://mobbin.com/screens/b86741f4-2e32-49fc-834c-87b0fb5e3d32) | Already `Card`/`ListRow` grouped toggles. Left as-is — visual restyle only was in scope, and it already matches; permission/toggle logic untouched per instructions. | [before](../screenshots/buyer-settings/push-notifications-before-390x844.png) | same |
| [help.tsx](../../../artifacts/mobile/app/help.tsx) | [Linktree Settings](https://mobbin.com/screens/e7c9f732-be29-4018-9d32-4aa29159594c) | Already uses `SearchBar`/`SectionHeader`/`NavigationCard`/`FilterChip`/`EmptyState` from the shared kit, with an FAQ sheet and a real ticket form. Left as-is. | [before](../screenshots/buyer-settings/help-before-390x844.png) | same |
| [account-type.tsx](../../../artifacts/mobile/app/account-type.tsx) | — | Dead legacy route: the default export immediately redirects to `/onboarding`; the real UI (`AccountTypeStep`) is onboarding's own themed card picker, out of this cluster's rendered surface. Nothing to restyle here. | [before](../screenshots/buyer-settings/account-type-before-390x844.png) | same |
| **account-type-settings.tsx** | [X "Who sees this"](https://mobbin.com/screens/63ce8dfc-d16b-49cf-b698-7a3975746c93) (choice-card + trailing check language) | **Fixed a real stuck-loading bug**: `useEffect(() => { if (authLoaded && isSignedIn) fetchProfile(); }, …)` never left `loading = true` when `authLoaded` was true but `isSignedIn` was false — the screen spun forever with no way out. Now resolves `loading` on any auth outcome, plus a defensive 4s timeout so the screen can never hang indefinitely. Sentence-cased the header ("Account type"). Buyer/seller choice cards, radios and Save CTA already used `useColors()`/theme tokens — kept. | [before](../screenshots/buyer-settings/account-type-settings-before-390x844.png) | [after 390×844](../screenshots/buyer-settings/account-type-settings-after-390x844.png) · [375×667](../screenshots/buyer-settings/account-type-settings-after-375x667.png) · [430×932](../screenshots/buyer-settings/account-type-settings-after-430x932.png) · [1440×900](../screenshots/buyer-settings/account-type-settings-after-1440x900.png) |
| **account-switcher.tsx** | [Shopify "Switch account"](https://mobbin.com/screens/1bcebd43-1606-4af1-9d0e-c2f1ddc8bfde), [Whatnot account switcher sheet](https://mobbin.com/screens/648c7bc7-bd10-4999-8a2b-36f09052e25a), [Perplexity Settings account dropdown](https://mobbin.com/screens/3fe2fde3-e61f-43f0-840c-8df9091910a3) | **Fixed a real theming bug**: the whole screen imported static, theme-independent constants (`BG, CARD, BORDER, FG, MUTED, SUBTLE, ACCENT, CARD_ELEVATED, SURFACE` from `lib/theme`) instead of `useColors()`/`useAppTheme()` — this screen ignored all 12 themes and was always the same near-black surface regardless of the user's chosen preset, a direct violation of the design-system rule ("screens never read hard-coded hex values"). Rebuilt on `useColors()` + the shared `Card`/`ListRow` (Shopify-style: avatar, name/email, trailing check/"Current" badge, chevron on switchable rows) instead of hand-rolled `TouchableOpacity` rows, matching the rest of the cluster. Kept all existing Clerk session logic untouched. | [before](../screenshots/buyer-settings/account-switcher-before-390x844.png) | [after 390×844](../screenshots/buyer-settings/account-switcher-after-390x844.png) · [375×667](../screenshots/buyer-settings/account-switcher-after-375x667.png) · [430×932](../screenshots/buyer-settings/account-switcher-after-430x932.png) · [1440×900](../screenshots/buyer-settings/account-switcher-after-1440x900.png) |

## Notes

- **Dev-preview auth limitation:** this sandbox has no real Clerk credentials
  (`CLERK_PUBLISHABLE_KEY` is a dummy value), so `account-switcher.tsx` and
  `account-type-settings.tsx` — both gated on a live Clerk session — show
  their (now theme-correct) loading skeleton/spinner in the "after"
  screenshots rather than populated data. The code fixes (theming bug, stuck
  spinner) are real and verified by reading the diff and `pnpm typecheck`;
  they can't be screenshotted past the loading state without a real Clerk
  session, which isn't available in this environment.
- The floating cookie-consent banner visible in every screenshot is global
  app chrome (not part of this cluster) and sits above the tab bar on web;
  it is unrelated to these screens' layouts.
- No payment/money processing logic was touched anywhere in this cluster —
  `buyer-payment-methods.tsx` and `buyer-addresses.tsx` were read and found
  already correct, and were not edited.

## Verification

- `pnpm typecheck` — clean.
- `pnpm test` — 2850/2850 tests passing. 3 unrelated suites
  (`buyer-conversation-chat-redesign`, `buyer-search-redesign`,
  `buyer-product-detail-payment` — none in this cluster) fail to load in this
  sandbox on a pre-existing `expo-modules-core`/`EventEmitter` native-module
  issue unrelated to these changes.
