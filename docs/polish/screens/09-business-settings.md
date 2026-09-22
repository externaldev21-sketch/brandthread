# Seller: manufacturers, billing, team & settings

[← Back to the punch list](../punch-list.md) · [Design rules](../design-rules.md)

**59 P0 · 109 P1 · 24 P2.** Rows are sorted P0 → P1 → P2 inside each screen. Line numbers are from `dev` @ `7e0f547` and will drift as other branches land. Search for the quoted code if a line has moved.


Scope: `artifacts/mobile/app` paywall/billing, settings hierarchy, theme/icon pickers, team, integrations, freelancer, manufacturer + quote + sample + production flows, `components/PlanUpsellModal.tsx`, `contexts/CookieConsentContext.tsx`. `marketing.tsx` does not exist at the app root (skipped).

Key fact used throughout: static `PURPLE`/`ACCENT` in `lib/theme.ts` = `#F7F7FA` (near-white) and `ON_DARK` = `#FFFFFF`. Any "PURPLE background + white text" is **white on white**.

---

## A. Paywall, plans & billing (App Store–sensitive)

### Plans / paywall — `app/plans.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Copy | No Terms of Use (EULA) or Privacy Policy links anywhere on the paywall. Guideline 3.1.2 requires both, plus an auto-renew disclosure, on any screen that sells a subscription. | plans.tsx:417-438 (footer area) | Add a footer under Restore: "Subscriptions renew automatically at the price shown unless you cancel at least 24 hours before the period ends. Manage or cancel in your App Store account settings." + links "Terms of Use" · "Privacy Policy" (https://brandthread.app/terms, /privacy). |
| P0 | Copy | Broken intro-offer string. It renders "Intro offer: $0.00 for 5 day s" (the `s` is separated by a space), and a free trial reads as "$0.00". | plans.tsx:369 | When `trial.price === 0`, show "Free for 5 days, then {priceString}/month". Otherwise show "{trial.priceString} for {n} {unit}{n===1?'':'s'}, then {priceString}/month" and fix the stray space. |
| P0 | Copy | The trial claim is hardcoded on native even when the store returns no intro offer (the user already used the trial, or they're in a region without one). The header "5-day free trial · cancel anytime" and the callout promise a trial the user may not get. | plans.tsx:260-262, 295-310 | On native, render the header and callout only when `revenueCatPackage?.product.introPrice` exists. Otherwise use the header "Pick the plan that fits your brand". |
| P0 | Copy | "Enter your card now — you won't be charged until day 6" is wrong on iOS/Android (the store handles payment, so no card is entered in the app). It also mentions Stripe to users on web. | plans.tsx:306; 230 | Native: "You won't be charged until your trial ends. Cancel anytime in your App Store settings." Web overlay subtitle: "Confirming your plan…". Remove "Syncing with Stripe". |
| P0 | Copy | "Skip for now — start with Starter" is misleading because Starter is a paid $29 plan and skipping doesn't subscribe you to anything. | plans.tsx:425 | "Not now" (secondary, muted). If there's a free tier, say "Continue without a plan". |
| P0 | Visual | Price falls back to "—" while RevenueCat loads or if it fails, so the paywall can show "— per month" with an active "Start free trial" CTA. | plans.tsx:318-320, 360-365 | Show a price skeleton while `packages` load. If the package is missing, disable the CTA and show "Prices unavailable. Pull to retry." |
| P1 | Copy | ALL-CAPS badges break the sentence-case rule. | plans.tsx:337, 342, 347 | "Recommended for you", "Most popular", "Current plan" |
| P1 | Copy | Success Alert uses an exclamation mark and "enjoy". Error Alerts show raw `e.message`. | plans.tsx:116, 187-188, 207 | Toast: "You're on {Plan}. Your free trial has started." Errors: "Couldn't start checkout. Check your connection and try again." |
| P1 | Consistency | Period label differs by platform ("/mo" on web, "per month" on native) and doesn't match subscription.tsx ("/mo"). | plans.tsx:364 | Always use "/month". |
| P1 | A11y | "Restore purchases" is a tiny muted text link with no haptic and no success toast (it uses an Alert). Reviewers look for it, so make it discoverable. | plans.tsx:429-437 | Style it as a TertiaryButton "Restore purchases" and show a Toast "Purchases restored" (not an Alert). |
| P2 | Visual | `transform: scale(1.015)` on the Growth card blurs text on Android and makes the card edges misalign with the column. `priceLabel` fontSize 28 is off-scale. | plans.tsx:511, 531 | Remove the scale and use the 2px accent border only. Use FS.xxl (26) or FS.xxxl (30). |
| P2 | Consistency | Bespoke header and TouchableOpacity CTAs instead of ScreenHeader/PrimaryButton. | plans.tsx:243-265, 390-412 | Use `BrandthreadHeader` + `PrimaryButton`/`SecondaryButton`. |

### Subscription — `app/subscription.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Copy | The Usage tab shows hardcoded fake numbers as if they were the user's ("18 products", "147 orders", "2.4 / 50 GB", "2 / 3 seats"). | subscription.tsx:45-50, 499-521 | Load real usage, or remove the Usage tab until it's backed by data. |
| P0 | Theme | The "Switch to …" CTA has white text (`'#FFFFFF'`) on `theme.accent`. The Monochrome accent is #F7F7FA and Gold/Champagne are light, so the label is invisible or barely legible. | subscription.tsx:660-662 | `changePlanText.color = theme.onAccent`. |
| P0 | Copy | Vendor name shown to users: "Your RevenueCat subscription has been refreshed." | subscription.tsx:229 | Toast "Purchases restored". |
| P0 | Copy | Native plan switch has no auto-renew/terms disclosure or legal links, same as plans.tsx. | subscription.tsx:357-414, 485-494 | Add the same auto-renew line and the "Terms of Use" · "Privacy Policy" links under the plan list. |
| P0 | Theme | Screen uses static `BG/CARD/FG/MUTED/BORDER/SUBTLE` for every surface, so the purple, olive and maroon themes show #18181B cards and 7% borders. | subscription.tsx:22-25, 596-683 | Build all colours from `theme.*` in `createStyles`. |
| P1 | Copy | With `status: 'none'` the card reads "Starter" + a "Free" pill, which contradicts the $29 Starter price. | subscription.tsx:68-78, 243-248 | Label the none state "No plan", with the subtitle "Pick a plan to unlock selling tools". |
| P1 | Copy | The "What's included in your plan" / "Your Growth Studio toolkit" section is shown to Starter users with locks everywhere. The lock chips say "Growth only" even though Pro includes them too. | subscription.tsx:423-426, 452, 479 | Starter: "Unlock with Growth". Chip: "Growth and Pro". |
| P1 | Copy | Title-case and ALL-CAPS: "Past Due", "CURRENT PLAN", "MOST POPULAR". Both badges stack when the current plan is Growth. | subscription.tsx:246, 365, 370 | "Past due", "Current plan", "Most popular". Hide "Most popular" when it's the current plan. |
| P1 | Copy | Robotic error titles with raw messages: "Checkout error", "Portal error", "Restore error". Downgrade copy says "billing portal" on iOS, where it's the App Store. | subscription.tsx:163-169, 195, 219, 231 | "Couldn't open checkout. Try again.". Downgrade body: "To change or cancel, manage your subscription in your App Store settings." |
| P1 | Motion | Restore purchases has no loading state and can be double-tapped. The status card spinner replaces the card content, which causes a height jump. | subscription.tsx:223-233, 316-318 | Add a busy state to Restore. Give the plan card a fixed-height skeleton. |
| P2 | Consistency | Bespoke header repeated three times and tabs built from TouchableOpacity. | subscription.tsx:253-291, 294-307 | Use `ScreenHeader` + the shared segmented control. |

### Plan details — `app/plan-details.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Copy | The whole screen is hardcoded placeholder content copied from Shopify: plan "Basic", strikethrough "$39", "$1 USD/month until September 7, 2026", "Card rates 2.9% + $0.30", "Up to 77% shipping discount". None of it matches Starter/Growth/Pro. It's reachable from 5 entry points in billing.tsx. | plan-details.tsx:51-67 | Delete the screen and route billing's links to `/subscription`, or bind it to `api.seller.subscription.status()` + `SELLER_PLANS`. |
| P0 | Consistency | "Cancel plan" confirm is a dead button (`onPress: () => {}`), and the body says "You will lose access to Basic features". | plan-details.tsx:19-26 | Route to the management URL (App Store / portal). Title "Cancel subscription?", body "You'll keep {Plan} until {renewsOn}.". |

### Billing — `app/billing.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Copy | Hardcoded fake info banner: "$20.00 in discounts may apply to relevant charges on your next bill." | billing.tsx:175 | Remove, or render only from a real discount field. |
| P0 | Consistency | Dead buttons: search, filter and both pager arrows do nothing (`() => () => {}`). The "…" button next to Past bills silently opens a Share sheet. | billing.tsx:223-225, 243-248, 281-286 | Remove the search, filter and pager controls. Replace "…" with "Export" (icon `share`). |
| P0 | Copy | "View bill", "View breakdown", "visit plan settings", the header "…" and every bill row all go to the placeholder plan-details screen. A failed portal open also falls back there. | billing.tsx:85, 141, 152, 177, 206, 260 | Point them to `/subscription` or the real invoice URL. On failure show "Couldn't open billing. Try again.". |
| P1 | Copy | "Bill #in_1Nx…" shows the raw Stripe invoice ID. | billing.tsx:266 | Use "{date} invoice", or the invoice `number` field. |
| P1 | Visual | "USD" suffix is hardcoded after `formatCents` (which already prints "$"). The card chip uses hex `#1F2937` with white icon. | billing.tsx:160-162, 187, 194, 310 | Drop the suffix. Use `colors.secondary` + `colors.foreground`. |
| P1 | Copy | Load failure is swallowed, so the screen shows "$0.00 · No upcoming bill", which reads like a real state. | billing.tsx:58-60 | Inline error: "Couldn't load billing. Pull to refresh." |
| P1 | Motion | Restore purchases has no busy state and uses an Alert for success. | billing.tsx:89-103, 213-216 | Add a spinner in the row and a Toast "Purchases restored". |

### Plan upsell sheet — `components/PlanUpsellModal.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Copy | Price comes from web `plan.priceLabel` ("$79") on native too. App Store requires the localized store price. | PlanUpsellModal.tsx:56, 108, 184 | Use the RevenueCat `priceString` on native, and hide the price until it loads. |
| P0 | Copy | Pro upsell promises features that aren't in the plan catalogue: "Priority support", "Dedicated account manager", "Custom integrations". That makes the paywall misleading. | PlanUpsellModal.tsx:34-40 | Use `getSellerPlan('pro').features`. |
| P1 | Theme | Close icon is hardcoded `rgba(255,255,255,0.6)` on `primaryGradient` (invisible on Monochrome/Gold). The subtitle uses `theme.muted` on the gradient, which is low contrast. | PlanUpsellModal.tsx:97, 244-250 | Icon `theme.onAccent`. Subtitle `theme.onAccent` at 80%. |
| P1 | Copy | "You tapped this" is robotic. | PlanUpsellModal.tsx:143 | "Selected" |
| P1 | Visual | The sheet has no bottom safe-area inset, so "Maybe later" sits on the home indicator. | PlanUpsellModal.tsx:260-263, 368-371 | `paddingBottom: insets.bottom + SP.lg`. Add `SheetHandle`. |
| P2 | Copy | ALL-CAPS section labels via `textTransform: 'uppercase'`. | PlanUpsellModal.tsx:269 | Sentence-case labels with no transform. |

### Payments — `app/payments.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Copy | Fake financial data: when the seller has no drops, 5 mock drops with real-looking totals appear (e.g. "$44,800.00 · 320 orders"), along with a "Next payout" banner for them. | payments.tsx:51-103, 358, 415, 453 | Start from `[]` and show EmptyState "No drops yet" / "Payouts for your drops show up here." / [Create a drop]. |
| P0 | Copy | Hardcoded payout account "BANK OF AMERICA, N.A. ······1649 · USD" and hardcoded status "Accepting payments / Ready for payouts" shown to every seller. | payments.tsx:500-510, 534-536 | Bind to the payout account API. Otherwise show "Add a payout account" + CTA. |
| P0 | Consistency | Dead buttons: "Manage", the Payment methods row, "View payouts", "Add provider", and all 7 configuration rows have no onPress. | payments.tsx:493, 513, 538, 550, 562 | Wire them to real routes (`/payouts`, etc.) or remove them. |
| P1 | Copy | "Notify Followers", "Pre Order Drops", "Pre Made Drops", "Pre Order" (casing and hyphenation). "Failed to send — please try again". | payments.tsx:170, 291, 403, 577, 599 | "Notify followers", "Pre-order drops", "Ready-made drops", "Couldn't notify followers. Try again." |
| P1 | Theme | Hex literals `#10B981`, `#33302A`, `#E8E1CF`, `#DCFCE7`, the card-brand chips, and an `isDark` sniff based on the background hex. | payments.tsx:137-140, 305-308, 460, 602 | Use `colors.success`, `colors.border`, and theme tokens. Remove `isDark`. |
| P1 | Motion | Mock data renders first, then swaps to real data, which causes a jump and flash. `loading` is never shown. | payments.tsx:358-359, 454 | Show a skeleton until the first load completes. |
| P2 | Consistency | Bespoke Toast component when a shared `Toast` exists. | payments.tsx:323-351 | Use `Toast` from BrandthreadUI. |

### Taxes & duties — `app/taxes-duties.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Copy | Vendor name all over the UI ("Stripe Tax checkout calculation", "Configure Stripe Tax", "Stripe-generated form"). Alert "Error" with raw message. | taxes-duties.tsx:38-40, 56, 62-64, 116, 160 | "Automatic sales tax", "Turn on automatic tax", "Tax forms ready: {n}". Error: "Couldn't turn on automatic tax. Try again." |
| P1 | Consistency | "Manage" button is dead (haptic only). | taxes-duties.tsx:108 | Remove it or open the tax settings URL. |
| P1 | Copy | Four overlapping legal disclaimers read like a contract. "✓ Configured" uses a text glyph. | taxes-duties.tsx:77, 99, 126-129, 141, 166 | Keep one footer: "Brandthread calculates tax at checkout. Filing and registration are up to you — check with an accountant." Use a Feather `check` icon. |

---

## B. Settings hierarchy

### Settings hub — `app/settings.tsx` (+ `services/settingsCatalog.ts`)

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Copy | "General settings" (audience `shared`) routes buyers to general-settings.tsx, which shows another company's hardcoded business name and address (see below). | settingsCatalog.ts:33 | Make it `seller` only and label it "Store details". |
| P1 | Consistency | Duplicate "Notifications" row for sellers: "Seller settings" and "App and notifications" both route to `/notifications-settings`. | settingsCatalog.ts:59, 68 | Keep one row, "Notifications", under "App and notifications". |
| P1 | Consistency | Grouping: "Delete account" and "Sign out" sit inside "Help and data", with Delete above Sign out. | settingsCatalog.ts:74-79 | Add a final group "Account actions" with "Sign out" first and then "Delete account". |
| P1 | Copy | "Brand Assets" breaks sentence case. | settingsCatalog.ts:55 | "Brand assets" |
| P1 | Copy | Search with no matches renders a blank list. | settings.tsx:256-294 | EmptyState: "No settings match "{q}"" / "Try another word, like "payouts"." |
| P1 | Motion | While the plan is loading or has errored, tapping "Brand assets" shows the Growth upsell even to paying users. | settings.tsx:147-155 | Ignore the tap while `planLoading` is true. On error, retry quietly. |
| P1 | Visual | 11pt row descriptions truncated to one line, so most get cut off ("Update your brand name, photo, bio, and publ…"). The eyebrow and email are 11pt too. | settings.tsx:284, 430-432, 442 | Use 13pt and `numberOfLines={2}`. Shorten the descriptions. |
| P2 | Copy | Version string is hardcoded "Brandthread v1.0.0". | settings.tsx:296 | Read it from `expo-constants` `nativeApplicationVersion` and show "Version {x} ({build})". |
| P2 | Consistency | 55 lines of dead `STATIC_GROUPS`, including "Policies" with no route. Several screens (push-notifications, security, roles, billing, payments) are reachable only through this dead list. | settings.tsx:30-85 | Delete it. Decide on purpose which screens are reachable. |
| P2 | A11y | 34px close and edit buttons (below 44). Bespoke account-reach Modal with a fixed `paddingBottom: 32` (no inset). | settings.tsx:417-424, 433, 449-456 | Use 44px, `IconButton`, and the shared sheet with insets. |

### Store details — `app/general-settings.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Copy | Another business's real-looking data is shown to every user: "Galleria Desires", "Multi-member LLC · 3801 Vitruvian Way, Addison, TX 75001", "galleriadesires@gmail.com". | general-settings.tsx:61-63, 81-82, 90 | Bind to seller settings. If they're missing, show "Add your business details" + CTA. |
| P0 | Consistency | Nothing on this screen saves. Region, units, time zone, order-ID prefix and fulfillment all reset when you leave. Seven rows are dead (haptic only). | general-settings.tsx:24-31, 56, 78, 86, 149, 240, 248, 269 | Persist through `api.seller.updateSettings`, or cut the screen down to what's real. |
| P1 | Copy | Copied from Shopify: "Markets" (links to store-domain), "Storefront API", "Hire a Brandthread Partner", "Backup Region". | general-settings.tsx:109, 120, 244, 267 | Remove the vendor/dev terms. "Backup region" → "Default region". |
| P1 | Visual | Select fields cycle on tap with no picker, so the user can't see the options. | general-settings.tsx:37-40, 119-144 | Use an action sheet or picker. |

### Security — `app/security.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Copy | Fake security feature: collaborator code "3711" is hardcoded, "Generate new code" is `Math.random()` (never saved), and the store name "Galleria Desires" is hardcoded. | security.tsx:12, 18-22, 63 | Remove the collaborators block or back it with the API. |
| P1 | Consistency | "collaborators" and "Users" look like links but only fire a haptic. | security.tsx:59, 86 | Link to `/team` or remove them. |

### Login activity — `app/login-activity.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P1 | Copy | Every active session is labelled "Current", and a raw "Session ID" is shown. | login-activity.tsx:104-108, 126-135 | Mark only this device's session "This device". Remove the session ID row. |
| P1 | Copy | The note sends users to "Settings → Security and change your password", but Security has no password option. British "recognise" vs US spelling elsewhere. | login-activity.tsx:89, 145 | "Don't recognize a session? Change your password in Login methods." + link to `/login-methods`. |
| P1 | Copy | Title-case header "Login Activity". Load errors show as "No session history available." | login-activity.tsx:75, 61-63, 95 | "Login activity". On error: "Couldn't load sessions. Pull to refresh." |
| P1 | Theme | Static `BG/CARD/FG/MUTED/BORDER` throughout, and a bespoke header. | login-activity.tsx:13-16, 71-77, 154-210 | Use `ScreenHeader` + theme tokens. |

### Notifications — `app/notifications-settings.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Visual | The section dividers are 10px-tall bands in `SUBTLE` (FG at 50%), which draws two bright grey bars across the screen. | notifications-settings.tsx:119, 182 | `backgroundColor: theme.surface` (or a hairline `theme.border`). |
| P0 | Copy | Fake data: sender email defaults to "store@brandthread.com", the info box shows "store+70327206006@brandthreademail.com", the placeholder is "mila@nightshiftstudio.co", and the email field never saves. | notifications-settings.tsx:44, 104, 111 | Load the real sender and save on blur, or remove the section. |
| P1 | Motion | Switches start ON, then flip to the server values after load (flicker). Saves fail silently. | notifications-settings.tsx:48, 52-56, 84-86, 198 | Show a skeleton until loaded. On a failed save, revert and show "Couldn't save. Try again." |
| P1 | Consistency | Audience is `shared`, so buyers see seller rows ("New orders", "Payout confirmations"). | settingsCatalog.ts:68 | Show buyers a buyer notification screen. |
| P1 | Theme | Static tokens for the card, border and text. | notifications-settings.tsx:14-18, 129-205 | Use theme tokens. |

### Push notifications — `app/push-notifications.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P1 | Consistency | Local-only toggles that never persist, with Shopify copy ("Timeline mentions", "expiring domain"). Uses RN `Switch` instead of `HapticSwitch`. Only reachable through dead code. | push-notifications.tsx:20-45, 89-94 | Delete the screen (notifications-settings replaces it). |

### App theme — `app/app-theme.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P1 | Visual | The preview doesn't match the real theme. Each tile is a logo PNG (a "B" mark), not a UI preview. "Monochrome" and "Black" use the same image (`theme-black.png`), so two tiles look identical even though the themes differ. | app-theme.tsx:19-32, 41-64 | Render a mini mock (background, card, text line and accent pill) from each preset's tokens, or give Monochrome its own asset. |
| P1 | Perf | 19 MB of ~1254px PNGs (1.6–2.5 MB each) are decoded into 138px tiles with RN `Image`. The first open stutters and tiles pop in over the accent-colour placeholder. | app-theme.tsx:47-56; assets/images/themes | Ship 300px WebP thumbnails. Use `expo-image` with `transition={150}`. |
| P2 | Motion | Switching is instant (`setThemeId` is synchronous) with no flash, which is good. The success haptic waits for `AsyncStorage` + `api.auth.updateProfile`, so it fires late or seconds later on a slow network. | app-theme.tsx:71-76; AppThemeContext.tsx:134-143 | Fire the success haptic right after `setThemeId`, then persist in the background. Consider a 150ms crossfade. |
| P2 | Consistency | Bespoke header. The selected tile shadow has no `shadowRadius` or offset. | app-theme.tsx:80-88, 107 | Use `ScreenHeader`. Add `shadowRadius: 12`. |

### App icon — `app/app-icon.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P1 | Copy | When the device can't switch icons (Expo Go, some Android launchers, incomplete builds), `applyDeviceAppIcon` returns false silently. The UI still shows the selection and plays a success haptic. | app-icon.tsx:40-45; AppIconContext.tsx:40-55 | If it returns false, show the inline note "Your device doesn't support changing the icon." |
| P1 | Perf | 13 RN `Image`s of ~1.5 MB PNGs in a grid. | app-icon.tsx:20-33, 68, 114 | Use 180px thumbnails + `expo-image`. |
| P2 | Motion | `await Haptics.selectionAsync()` + `await selectIcon` (network) delay the success haptic. | app-icon.tsx:42-44 | Don't await the haptics. Fire success after the local set. |

### Cookie consent (web) — `contexts/CookieConsentContext.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P1 | Theme | The `ChangeCookiePreferences` link has no colour, so it renders in default black on the dark app (invisible). | CookieConsentContext.tsx:43, 45 (`link`) | Pass `color: theme.muted`. |
| P1 | Copy | Legalese banner, with checkboxes drawn as text glyphs ("✓ Necessary", "○ Analytics"). | CookieConsentContext.tsx:39 | "We use cookies to keep Brandthread working. Analytics and marketing cookies are off unless you turn them on." Use `HapticSwitch` rows. Buttons: "Accept all" / "Necessary only" / "Customize", all as real buttons of equal weight. |
| P2 | A11y | 11–13pt text links as the only actions, and the whole provider is squeezed onto one line. | CookieConsentContext.tsx:39, 45 | Use `SecondaryButton`/`PrimaryButton small` and split into components. |

---

## C. Team, roles, integrations, profile

### Team — `app/team.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Copy | Fake security toggles: "Two-Factor Authentication — Required for all staff" and "Fraud Monitoring — AI-powered transaction alerts" are local `useState(true)` and are never enforced or saved. | team.tsx:56-57, 374-397 | Remove them, or back them with the API. |
| P1 | Copy | "Approval Workflows" is a hardcoded static list presented as settings ("Refunds > $100 — Owner approval"). | team.tsx:323-337 | Remove it until it's real. |
| P1 | Copy | Title case everywhere: "Team Management", "Staff Accounts", "Audit Log", "Create Invite", "Copy Link", "Full Access". Plus "Error" alerts with raw messages. | team.tsx:137, 158, 192, 214, 273, 283, 324, 340, 452, 486 | "Team", "Staff", "Activity", "Create invite", "Copy link", "Full access". Errors: "Couldn't create the invite. Try again." |
| P1 | Consistency | "Link copied" confirmation uses an Alert. The invite modal is a centred card with `autoFocus` and no KeyboardAvoidingView, so the keyboard covers it on small phones. | team.tsx:164-168, 401-418 | Toast "Link copied". Bottom sheet with KAV. |
| P1 | Copy | `log.action` is shown raw in the audit log. Load errors show "No team members yet". | team.tsx:84, 293-296, 352 | Map actions to sentences. On error: "Couldn't load your team. Pull to refresh." |
| P2 | Theme | `AVATAR_COLORS` hex values and `onlineDot` border `#181818`. | team.tsx:45, 517 | Use theme-derived colours and `colors.card`. |

### Team invite (accept) — `app/team-invite.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P1 | Copy | "You're on the team!", "Accept Invite", "Open Dashboard", "Sign in / Create account to join", "This invite link is missing its token." | team-invite.tsx:47, 129, 134, 169, 175 | "You're in", "Accept invite", "Open dashboard", "Sign in to join", "This invite link is incomplete. Ask for a new one." |
| P2 | Theme | Hex `#B98A2E` for the expired state. | team-invite.tsx:102-103 | `colors.warning`. |

### Roles — `app/roles.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P1 | Consistency | Five dead controls: header "+", "…", search, filter, and "Learn more about roles" (haptic only). "All" looks like a filter but is static. | roles.tsx:37-42, 53-58, 49-51, 85 | Remove them, or wire "+" to the team invite. |

### Integrations — `app/integrations/index.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Copy | Fake connections: "Connect" on Instagram, TikTok Shop, Shopify, Mailchimp, Google Ads and Meta Ads calls `connectIntegration(key, {})` with no OAuth and then shows "Connected". Stripe says "(auto-connected)" but still offers Connect. | integrations/index.tsx:79-97, 26-33 | Show "Coming soon" chips that can't be tapped (or hide them) until OAuth exists. |
| P1 | Visual | Mailchimp tile is a white icon on `#FFE01B` (invisible). | integrations/index.tsx:31, 125 | Use a dark icon on yellow, or real brand marks. |
| P1 | Copy | "Error" alerts. "Connect your {X} account to sync data with Brandthread." is generic. | integrations/index.tsx:74, 92 | "Couldn't disconnect {X}. Try again." |

### Klaviyo — `app/integrations/klaviyo.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P1 | Consistency | Disconnect has no error handling (unhandled promise) and no busy state. | klaviyo.tsx:87-96 | try/catch + Toast "Couldn't disconnect Klaviyo. Try again." |
| P2 | Copy | "Klaviyo: Email Marketing & SMS", "Email subs", "SMS subs". Bespoke header. | klaviyo.tsx:103-109, 116, 136, 140 | "Klaviyo email and SMS", "Email subscribers", "SMS subscribers". Use `ScreenHeader`. |

### Edit seller profile — `app/edit-profile.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Consistency | Data-loss risk: fields default to "Brandthread" / "@brandthread", and a failed profile load is swallowed. Tapping Save then overwrites the seller's real name and username. | edit-profile.tsx:41-48, 67, 96-106 | Start empty, disable Save until loaded, and show "Couldn't load your profile. Pull to retry." |
| P0 | Copy | The copy button doesn't copy. It shows an Alert with the hardcoded "brandthread.app/@brandthread". | edit-profile.tsx:116-119 | Use `Clipboard.setStringAsync(link)` + Toast "Link copied". |
| P0 | Theme | Fully hardcoded palette (`#000000`, `#161616`, `#2A2A2A`, Twitter-blue `#1DA1F2` links, sky-blue avatar gradient), which ignores all 12 themes. | edit-profile.tsx:14-19, 150 | Use `useAppTheme()` tokens. Links in `theme.accentLight`. |
| P1 | Consistency | "Pronoun", "Category" and "Change display order" are never saved. Reordering is tap-to-move-up behind a drag "menu" icon. Text inputs show a chevron-right, which suggests navigation. | edit-profile.tsx:201-213, 228-253, 287 | Save them or remove them. Drop the chevrons. |
| P1 | Copy | "Error" alert. Placeholder falls back to the current value. | edit-profile.tsx:110, 281 | "Couldn't save your profile. Try again." |

---

## D. Freelancer, IP & moderation

### Freelancer apply — `app/freelancer-apply.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P1 | Theme | Static `BG/CARD/BORDER/FG/MUTED` for inputs, cards and the footer bar. The footer is a #0A0A0B band on the purple, olive and maroon themes. | freelancer-apply.tsx:19-22, 311-353 | Use theme tokens. |
| P1 | Visual | Footer has a fixed `paddingBottom: 32` with no safe-area inset. | freelancer-apply.tsx:342-345 | `paddingBottom: insets.bottom + SP.md`. |
| P1 | Copy | "Edit Freelancer Profile", "Become a Freelancer", "Save Profile", "Submit Application", "Welcome to the community!" | freelancer-apply.tsx:83, 147, 300 | "Edit freelancer profile", "Become a freelancer", "Save", "Submit application", "You're in". |

### Freelance jobs — `app/freelancer-jobs.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P1 | Copy | Vendor name: "Stripe hasn't confirmed this payment." | freelancer-jobs.tsx:115 | "Payment isn't confirmed yet. If you closed checkout early, cancel this job and create a new one." |
| P1 | Copy | Title case: "Freelance Jobs", "My Gigs", "In Progress", "Start Work", "Mark Complete", "Check Payment", "Cancel Job", "Browse Freelancers". "Escrow-protected gigs" is jargon. | freelancer-jobs.tsx:48, 210, 216, 221, 227, 240, 246, 295 | Sentence case. Subtitle: "Payment is held until the work is done". |
| P1 | Perf/Theme | ScrollView `.map` over jobs, and static tokens throughout. | freelancer-jobs.tsx:266-301, 19-22 | Use FlatList + theme tokens. |

### Freelancer profile — `app/freelancer-profile.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P1 | Copy | "Pay with Stripe" vendor copy. "Open it in My Jobs" points to a screen that's actually called "Freelance Jobs". Alert title is "Failed". | freelancer-profile.tsx:439, 138, 99 | "Enter a price", "…open it in Freelance jobs…", "Couldn't deactivate. Try again." |
| P1 | Visual | Hire footer has a fixed `paddingBottom` and no safe-area inset, so it sits on the home indicator. | freelancer-profile.tsx:518-521 | Add `insets.bottom`. |
| P2 | Copy | "Your Profile", "Edit Profile", "My Gigs", "Deactivate Listing". | freelancer-profile.tsx:181, 306, 316, 323 | Sentence case. |

### IP report — `app/ip-report.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P1 | Copy | Raw status enum ("Status: under_review") and a raw error message. | ip-report.tsx:49, 72 | Map it to "Under review" / "Resolved". Error: "Couldn't submit your report. Try again." |
| P1 | Visual | No KeyboardAvoidingView, so the two bottom multiline fields end up under the keyboard. The selected chip uses `success` green instead of the accent. | ip-report.tsx:63, 84-86 | Wrap in KAV. Use `theme.accent` for selection. |
| P2 | Copy | A 90-word legal paragraph before the form. "Each evidence URL must begin with http://…" is technical. | ip-report.tsx:64, 37 | Collapse it behind "What happens next". Error: "Evidence links should start with https://". |

### Admin reports — `app/admin-reports.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Visual | `'store' as any` isn't a Feather glyph, so seller reports render a broken or empty icon. | admin-reports.tsx:61 | Use `'shopping-bag'` or `'home'`. |
| P1 | Copy | Load errors are swallowed and show "No pending reports", which is a false all-clear for moderators. The empty state has no pull-to-refresh. | admin-reports.tsx:228-230, 283-289 | Inline error: "Couldn't load reports." + [Retry]. Put the RefreshControl on the empty state too. |
| P1 | Perf | ScrollView `.map` for a moderation queue that can grow without limit. | admin-reports.tsx:291-301 | Use FlatList. |
| P2 | Copy | "Review Reports", "Update Status". The status pill is the only tap target, and nothing shows it's tappable. | admin-reports.tsx:99, 183-188, 270 | "Reports", "Update status". Add a chevron to the pill. |

---

## E. Manufacturer & quote flows

### Manufacturer hub — `app/manufacturer-hub.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Consistency | Dead header search and filter buttons (`onPress={() => {}}`) on every tab. They duplicate the working controls in Discover. | manufacturer-hub.tsx:285-290 | Remove them, or have them focus Discover's search and filter. |
| P0 | Copy | Any load error renders a completely blank tab (`<View style={s.flex} />`). Discover returns `null` on error. | manufacturer-hub.tsx:486, 791, 933, 1126, 1226, 1342 | EmptyState "Couldn't load {quotes}" / "Check your connection and try again." / [Retry]. |
| P0 | Theme | Unread badge uses static `PURPLE` (#F7F7FA) with `ON_DARK` white text, so the count is invisible. | manufacturer-hub.tsx:1403-1404 | `backgroundColor: theme.accent`, `color: theme.onAccent`. |
| P0 | Copy | Fake counts: "Quotes: 0 · Samples: 0" is hardcoded on every relationship card. | manufacturer-hub.tsx:825 | Compute the counts, or show only "{n} products". |
| P0 | Theme | Every sub-tab style uses static `PURPLE/CARD_GLASS/BORDER/FG/MUTED` at module scope. The local re-binding at :152 only covers the root, so the whole hub ignores the chosen theme. `inlineError` uses hex `#2B1E0F`. | manufacturer-hub.tsx:25-29, 596-620, 717-730, 863-878, 1081-1093, 1409-1438 | Make each StyleSheet a `makeStyles(theme)` hook. |
| P1 | Copy | Status badges show raw lowercase enums ("active", "invited", "on_hold", "awaiting payment") next to "Quote received" in sentence case. `StatusBadge` doesn't capitalise. | manufacturer-hub.tsx:821, 1026, 1149, 1256 | Add a `statusLabel()` map: "Active", "Invited", "On hold", "Awaiting payment". |
| P1 | Copy | B2B jargon with no helper: "MOQ 50 · 30d lead", "MOQ Contact" (when missing), and the filter "Min Order Qty (MOQ)". | manufacturer-hub.tsx:571, 668 | Card: "Min. order 50 · 30-day lead time", or "Min. order on request". Add a filter helper: "Minimum order — the fewest units they'll produce per style". |
| P1 | Copy | Tab label "My Mfgs". Title case: "Filter Manufacturers", "Unit Price", "Lead Time", "Accept Quote", "Decline Quote", "Request Quote", "Quote Requests", "Quotes Received". Empty-state titles end with periods ("Build your production network."). | manufacturer-hub.tsx:54, 646, 675, 682, 769, 785, 916, 924, 963, 977, 797, 944, 1131, 1231, 1347 | "Saved", "Filters", "Unit price", "Lead time", "Accept quote"… Drop the trailing periods. |
| P1 | Consistency | "Withdraw" on a quote request fires instantly with no confirm. "Accept" and "Decline" have no haptic. | manufacturer-hub.tsx:970, 1035-1037 | Confirm with "Withdraw this request?" / "The manufacturer will be notified." [Keep] [Withdraw]. |
| P1 | Consistency | Wrong empty-state actions. Samples "Create sample" opens a quote request. Production "View quotes" pushes a second hub onto the stack, which lands on Discover. | manufacturer-hub.tsx:1133, 1233 | "Request a sample" → `/request-sample`. "View quotes" → `setActiveTab('quotes')`. |
| P1 | Consistency | "Approve" and "Revision" on sample cards pass `&action=…`, but sample-detail ignores it, so the user lands on the detail with no form open. | manufacturer-hub.tsx:1162-1167 | Read `action` in sample-detail and open the review or revision form scrolled into view. |
| P1 | Perf | `setInterval` polling (15s samples, 15s production, 10s messages) keeps running when the screen isn't focused or the app is in the background. There are also N+1 `getManufacturer` calls per relationship and quote. | manufacturer-hub.tsx:1120-1123, 1220-1223, 1336-1339, 751-754, 899 | Poll inside `useFocusEffect` and pause on AppState background. Batch the manufacturer fetch. |
| P1 | Motion | Discover shows nothing while loading (ListEmpty returns `null`). The other tabs show a centred spinner. | manufacturer-hub.tsx:486, 1125, 1225, 1341 | Use `ProductGridSkeleton` / `FeedSkeleton`. |
| P1 | Perf | RN `Image` for covers in a 2-column grid. | manufacturer-hub.tsx:529 | `expo-image` with `transition={150}`. |
| P2 | Visual | Production progress can go negative when `currentStage` is unknown ("Stage 0/13", -8%). The track uses `rgba(255,255,255,0.08)`. | manufacturer-hub.tsx:1245-1272, 1302 | Clamp with `Math.max(0, …)`. Use `theme.border`. |

### Manufacturer compatibility route — `app/manufacturer.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P2 | Theme | Hardcoded `rgba(244,244,255,0.60)` label, and a flash of "Opening Manufacturer Hub…" before the redirect. | manufacturer.tsx:19, 33 | Render nothing (or a skeleton) and use `colors.mutedForeground`. |

### Manufacturer messages — `app/manufacturer-messages.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Theme | Seller bubbles are static `PURPLE` (#F7F7FA) with `'#fff'` text, so everything the seller sends is invisible. | manufacturer-messages.tsx:134, 154-157 | `backgroundColor: theme.accent`, `color: theme.onAccent`. |
| P0 | Theme | "Send … Card" button is `PURPLE` background with `'#fff'` text (invisible). | manufacturer-messages.tsx:305-309 | Use `PrimaryButton`. |
| P0 | Consistency | The attach menu is an `Alert.alert` with 6 buttons. Android Alerts show at most 3, so photo, voice and video options disappear. | manufacturer-messages.tsx:548-565 | Use `ActionSheetIOS` on iOS and the shared bottom sheet on Android. |
| P1 | Copy | Emoji in UI and data ("🖼️ Send Photo", "🧵 Send Sample Order Card", "📷 Photo", "🎉"), plus Title Case. "Error" alerts. "No messages yet. Say hello!" | manufacturer-messages.tsx:249, 263, 437, 474, 481, 519, 550-560, 642 | Feather icons with "Photo", "Sample order", "Bulk order", "Voice call", "Video call". Errors: "Couldn't send. Tap to retry." Empty: "No messages yet" / "Start with your product and quantity." |
| P1 | Perf | 5-second `setInterval` refetches the full thread forever, even in the background. `msgs.reverse()` mutates the response. | manufacturer-messages.tsx:410-414, 362 | Pause when unfocused or backgrounded. Poll only for new messages. |
| P1 | Motion | Loading shows a bare spinner with no header, then the header pops in. The card dialog appears with no animation. | manufacturer-messages.tsx:569-575, 584-590 | Render the header immediately with a message skeleton. Use the shared sheet (animated). |
| P1 | Theme | Static tokens for the header strip, input bar and bubbles. | manufacturer-messages.tsx:24-29, 593, 686-725 | Use theme tokens. |

### Manufacturer profile — `app/manufacturer-profile.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P1 | Visual | The whole gradient hero is sticky (`stickyHeaderIndices={[0]}`), so about 40% of the screen stays pinned while scrolling. | manufacturer-profile.tsx:166-211 | Make only a compact title bar sticky, or none. |
| P1 | Copy | MOQ, Unit price and Lead time have no helper. Missing data shows "$0.00–$0.00" and "0d". | manufacturer-profile.tsx:343-356, 260 | Add a subline "Min. order — fewest units per style". Show "On request" when the value is 0. |
| P1 | Consistency | The contact email, website and phone are plain text (not tappable). "Message" and "Messages" are adjacent actions that look almost identical. | manufacturer-profile.tsx:407-425, 219-226 | Make the rows `Linking.openURL` (mailto:, https:, tel:). Rename "Messages" to "Inbox". |
| P1 | Copy | The not-found state has an empty description and no action. Certifications always show "Active". Title case: "Years in Business", "Team Size", "Shipping Regions", "Request Quote". | manufacturer-profile.tsx:154, 324, 239, 244, 397, 436 | "This manufacturer isn't available" / "They may have left Brandthread." / [Back to hub]. Derive the cert status from `validUntil`. Use sentence case. |

### Manufacturer onboarding — `app/manufacturer-onboard.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Copy | Fake account creation: the email, password and confirm-password fields are collected but never sent. Photos, phone, production modes and sample cost are dropped too, yet the review says "{n} photos uploaded". `sampleTurnaround: '2–4 weeks'` is invented. | manufacturer-onboard.tsx:140-152, 205-209, 338 | Send or upload all fields (or remove the Account step and the photos). Show "{n} photos added". |
| P0 | Consistency | "Brandthread Manufacturer Terms" is styled as a link but doesn't open anything, and it's a required checkbox. | manufacturer-onboard.tsx:349-353 | Make it a tappable link that opens the terms URL. |
| P1 | Copy | "🎉 Application Submitted!", "Submission Failed" with raw message, "Fix before continuing" validation Alerts. Title-case labels ("Business Email", "Confirm Password", "Company / Factory Name", "Join as Manufacturer", "Add Photo", "Starting Price / unit"). "speciality" vs "specialty". | manufacturer-onboard.tsx:130, 163, 170, 186, 207-209, 218, 230, 293, 300 | "You're listed", "Couldn't submit. Check your details and try again." Inline field errors. Sentence-case labels. "specialty". |
| P1 | Copy | "Min Order (MOQ)" has no helper. | manufacturer-onboard.tsx:262 | Label "Minimum order", helper "Fewest units you'll make per style". |
| P1 | Visual | No KeyboardAvoidingView on a 5-step form with bottom fields. RN `Image` for thumbnails. | manufacturer-onboard.tsx:196-201, 281 | Wrap in KAV. Use `expo-image`. |

### Invite manufacturer — `app/invite-manufacturer.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Consistency | "Copy link" doesn't copy. It opens an Alert that shows the URL. | invite-manufacturer.tsx:111-113, 156-161 | `Clipboard.setStringAsync` + Toast "Link copied". Add a Share button. |
| P0 | Copy | Dev jargon: "No email service is connected — share this link manually with the manufacturer." The button says "Send Invitation" but nothing is sent. | invite-manufacturer.tsx:151-153, 284 | Button "Create invite link". Note: "Share this link with {company} so they can join." |
| P1 | Copy | "Contact name *" is marked required but not validated. "Products to collaborate on" free text is sent as `productIds`. "Invitation Created!", "Invite Manufacturer", "Invitation Link", "Error". | invite-manufacturer.tsx:222, 73-86, 124, 135, 148, 105 | Validate contact name or drop the asterisk. Send the names as `notes`. "Invite link ready", "Invite a manufacturer", "Couldn't create the invite. Try again." |
| P2 | Theme | Static tokens for the header and back button. | invite-manufacturer.tsx:15-20, 302-315 | Use theme tokens and `BrandthreadHeader`. |

### Quote request — `app/quote-request.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Copy | "Coming soon" stub in a primary flow: tapping any file type shows "File upload will be available in the next release." and then marks it "Added ✓". The Review step lists the files as "attached". | quote-request.tsx:504-514, 627-639 | Wire up `expo-document-picker` + upload, or hide step 4. Never mark something as added when it wasn't. |
| P0 | Consistency | Data loss: Submit re-saves the draft without target price, needed-by date, production type, packaging, shipping destination, print method, sample-required or productId, so those fields are dropped. | quote-request.tsx:303-317 | Submit the same payload as the autosave at :208-230. |
| P0 | Consistency | Dead end: the hub FAB and empty state open `/quote-request` with no `manufacturerId`. The user completes 5 steps and only then sees "Choose a manufacturer before submitting." Drafts never autosave in this path. | quote-request.tsx:205, 297-299; hub :946, 1004 | Add a manufacturer picker as step 1 when none is passed. |
| P0 | Theme | The colorway "+" button is static `PURPLE` (#F7F7FA) with a white `ON_DARK` icon, so the icon is invisible. | quote-request.tsx:443-445, 785-789 | Background `theme.accent`, icon `theme.onAccent`. |
| P1 | Copy | "Discard" in the exit Alert doesn't discard (both options call `router.back()`). "Save draft" says "Draft saved" even when nothing was saved. | quote-request.tsx:240-251 | Delete the draft on Discard. Show the toast only after a successful save. |
| P1 | Copy | "Tech Pack" has no helper. "Needed by date (YYYY-MM-DD)" is a raw text input with a past placeholder "2025-06-01". The quantity field doesn't show the manufacturer's MOQ. | quote-request.tsx:54, 397-398, 391-392 | Tech pack helper: "Your spec sheet — measurements, materials and construction notes". Use a native date picker. Helper under Quantity: "{Mfg} minimum: {moq} units". |
| P1 | Consistency | The product-source radios ("Existing product", "Draft product") don't open a picker, so they're cosmetic. The summary shows the raw "existing"/"new". | quote-request.tsx:351-374, 575 | Open a product picker, or remove the radios. Map the labels. |
| P1 | Motion | The ScrollView keeps its offset between steps, so the next step opens scrolled down. | quote-request.tsx:676-682 | `scrollTo({ y: 0, animated: false })` on step change. |
| P1 | Copy | "Quote Request Sent! 🎉" plus Title-case step titles, "Save Draft", "Submit Request". | quote-request.tsx:38-44, 320, 643, 646, 668 | "Request sent" / "{Mfg} usually replies in ~{h}h." Use sentence case. |
| P1 | Theme | Static tokens throughout. | quote-request.tsx:17-22, 702-876 | Use theme tokens. |

### Quote detail — `app/quote-detail.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Copy | Dev jargon: "This quote is a local preview and cannot start a real sample order. Choose a manufacturer from the live directory…" | quote-detail.tsx:278-283 | "This quote can't start a sample. Request a new quote from the manufacturer's profile." |
| P0 | Copy | Not-found or error renders a blank screen under the header. | quote-detail.tsx:315-322 | EmptyState "Quote not found" / "It may have been withdrawn." / [Back to quotes]. |
| P1 | Copy | MOQ, Lead time and Production time sit side by side without explanation, which is confusing even for sellers. | quote-detail.tsx:385-388 | Add sublines "Min. order", "Until it ships", "Time on the line". |
| P1 | Copy | Title case everywhere ("Pricing Breakdown", "Setup / Tooling", "Send Counteroffer", "Accept Quote", "Message Manufacturer", "Quote Accepted"). "— act soon!" "Error" / "Failed to submit counteroffer." | quote-detail.tsx:117, 125, 214, 356, 368-378, 439, 446, 453, 477, 484 | Sentence case. "Expires in {n} days". "Couldn't send your counteroffer. Try again." |
| P1 | Consistency | Counteroffer can be submitted completely empty. The form appears below the fold with no scroll, so tapping "Send counteroffer" looks like nothing happened. | quote-detail.tsx:105-121, 503-511 | Require at least one field. Scroll to the form on open. |
| P1 | Theme | Hardcoded green gradient `['#10B981','#34D399']` on Accept and Start sample, plus static tokens. | quote-detail.tsx:450, 481, 29-37 | Use the default PrimaryButton (theme). |

### Quote compare — `app/quote-compare.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P1 | Consistency | Effectively unreachable or misleading. `getQuotesForRequest` returns at most 1 quote, so the hub never shows Compare. If opened, it always says "Only one quote received so far. More may arrive shortly." | quote-compare.tsx:109, 162-172; manufacturerService.ts:316-319 | Compare across requests for the same product, or remove the route. |
| P1 | Consistency | Accept has no error handling (unhandled promise) and no loading state. | quote-compare.tsx:127-137 | try/catch + busy state + "Couldn't accept this quote. Try again." |
| P1 | Visual | The label column scrolls away horizontally with the values, so the user loses the row labels. | quote-compare.tsx:176-193 | Pin the labels column outside the horizontal ScrollView. |
| P2 | Copy | "No Quotes Yet", "Compare Quotes", text glyphs "★", "✓ Verified", "✗ Unverified". Unrated shows "★ 0.0 (0)". | quote-compare.tsx:65, 72, 150, 155 | Sentence case, Feather icons, and "Not rated". |

### Request sample — `app/request-sample.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P1 | Consistency | Orphan route (nothing links to it), and a missing or failed manufacturer renders a blank screen. | request-sample.tsx:89 | Link it from the hub Samples empty state and manufacturer-profile. Add EmptyState + back. |
| P2 | Copy | "Request Sample", "Send Sample Request". Size is free text defaulting to "M". The header title isn't centred (the View has no flex). | request-sample.tsx:103-107, 121, 136 | "Request a sample", "Send request". Use size chips. `flex: 1` on the title View. |

### Sample detail — `app/sample-detail.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Motion | A 15-second poll calls `load()`, which sets `loading=true` and swaps the whole screen for skeletons. Every 15s the screen flashes, the scroll position resets, and the review or revision form loses focus and the keyboard mid-typing. | sample-detail.tsx:395-398, 415-418, 624-635 | Poll with a silent refresh (don't set `loading`). Skip polling while a form is open. |
| P0 | Copy | Raw enum in the primary payment state: the badge shows "pending_payment" because `STATUS_LABELS` only has `awaiting_payment`. | sample-detail.tsx:56-67, 681 | Add `pending_payment: 'Awaiting payment'`. |
| P0 | Copy | Vendor name in the payment copy: "…verifies their Stripe payout account", "Funds are routed to the manufacturer through Stripe." | sample-detail.tsx:470, 691-692 | "The manufacturer needs to finish payout setup before you can pay. Message them, then refresh." / "Pay securely. Funds are held until your sample ships." |
| P0 | Copy | Not-found renders a blank screen. | sample-detail.tsx:637-644 | EmptyState "Sample not found" + [Back]. |
| P1 | Visual | Timeline logic: `revision_requested` is a fixed step between In development and Shipped, so every shipped sample shows "Revision requested" as completed. The active dot uses static `ACCENT` (#F7F7FA) with a white inner dot (invisible). | sample-detail.tsx:50-53, 273-292 | Show revisions only when they happened (branch). Dot `theme.accent` with inner `theme.onAccent`. |
| P1 | Copy | "Help Center" is an Alert pointing to "help.brandthread.com" (the rest of the app uses brandthread.app). Title-case alerts: "Rating Required", "Title Required", "Permission Required", "Upload Failed" (raw message). "Manufacturer payout setup required" as a disabled primary button label. | sample-detail.tsx:501, 533, 571, 609, 652, 972-975 | Open `/help`. "Add an overall rating", "Add a title", "Allow photo access in Settings", "Couldn't upload. Try again." Button: "Waiting on manufacturer". |
| P1 | Copy | Deadline is a raw "YYYY-MM-DD" text field with a past placeholder "2025-06-01". | sample-detail.tsx:936-941 | Use a date picker. |
| P1 | Theme | Static tokens throughout, plus hex `#F59E0B` stars. | sample-detail.tsx:45, 148 | Use theme tokens and `theme.warning`. |

### Production detail — `app/production-detail.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Copy | The wallet picker shows the raw `dropId` (a UUID) as the label. | production-detail.tsx:156 | Show the drop name: "{Drop name} wallet". |
| P0 | Copy | Vendor name: "…connects and verifies their Stripe payout account", "…must finish Stripe verification…". | production-detail.tsx:87, 145 | "The manufacturer needs to finish payout setup. Message them, then refresh." |
| P0 | Copy | Not-found renders a blank screen. | production-detail.tsx:108-116 | EmptyState "Order not found" + [Back]. |
| P1 | Visual | Timeline dots have no connector line (unlike sample-detail). The progress bar is `success` green while the current dot is accent. Stage labels are Title Case (from `PRODUCTION_STAGES`). The status badge shows the raw lowercase enum. | production-detail.tsx:184-195, 215, 127; manufacturerTypes.ts:491-505 | Reuse the connected `SampleTimeline` pattern. Use one colour. Sentence-case the labels. Map the status. |
| P1 | Copy | "Pay from a drop wallet" / "Wallet payments may take a moment to reconcile" is jargon. | production-detail.tsx:142, 146 | "Pay from your drop earnings" / "This can take a minute to confirm." |
| P1 | Consistency | `openThread` has no try/catch. The 15s poll ignores focus and AppState. Loading shows a bare spinner with no header. | production-detail.tsx:67-71, 95-102, 104-106 | Add try/catch. Poll only while focused. Render the header plus a skeleton. |
| P2 | Theme | `walletSelected` uses sky-blue `rgba(14,165,233,0.12)` and `walletError` uses `#F97316`. | production-detail.tsx:230, 232 | `theme.accentDim`, `theme.warning`. |

---

## Clean / low-risk
- `app/team-invite.tsx`: sound logic, themed via `useColors`. Only copy casing needs fixing (listed above).
- `app/ip-report.tsx`: the best-structured screen in the slice (BrandthreadScreen, PrimaryButton, PressableScale, theme tokens). Only minor copy and keyboard issues.
- `app/request-sample.tsx`: themed, accessible (roles, labels, hints, 44pt targets). Only the orphan and blank states.

---

## Cross-cutting patterns in my slice
- **White on white:** static `PURPLE`/`ACCENT` = `#F7F7FA` combined with `#fff`/`ON_DARK` text or icons makes content invisible in 5 places. These are seller chat bubbles, the "Send … Card" button, the hub unread badge, the quote-request "+" button and subscription's "Switch to" CTA (the last uses `theme.accent` + `#FFFFFF`). All are P0.
- **Theme ignored:** 14 of 39 files import static `BG/CARD/FG/MUTED/BORDER/PURPLE` for surfaces. edit-profile.tsx uses a fully private hex palette (Twitter-blue links). The whole Manufacturer Hub ignores themes because its sub-tab StyleSheets sit at module scope.
- **Fake or placeholder data shown as real:** 9 screens. These are plan-details (Shopify "Basic $1"), billing ("$20.00 in discounts"), subscription Usage, payments (mock drops + BofA ····1649), general-settings and security ("Galleria Desires" + a real Texas address), notifications (fake sender email), team (2FA and fraud toggles, approval workflows), and the hub ("Quotes: 0 · Samples: 0").
- **Dead or fake actions:** about 35 controls with no-op handlers or that lie about success. Billing search/filter/pager (4), payments (11), roles (5), hub header (2), general-settings (7), "Copy link" in edit-profile and invite-manufacturer (neither copies), fake integration "Connect" (6 providers), and quote-request "Add file" (a "next release" stub).
- **Paywall compliance:** there are no Terms/EULA/Privacy links or auto-renew disclosure on plans.tsx or subscription.tsx. The trial is hardcoded instead of eligibility-checked, the intro-offer string is broken, the upsell shows the web price on native, and the Pro upsell lists features that don't exist.
- **Vendor or dev words shown to users:** about 20 user-facing "Stripe" strings (taxes, sample, production, freelancer), plus "RevenueCat", "No email service is connected", "local preview … live directory", "Session ID", raw UUID `dropId`, and raw enums ("pending_payment", "on_hold", "active").
- **Blank error states:** 9 places render an empty `<View/>` on load failure or not-found (6 hub tabs, quote-detail, sample-detail, production-detail, request-sample). Another 6 swallow errors into a misleading "No … yet" message.
- **Alerts:** 120 `Alert.alert` calls across the slice. 13 have the title "Error", and about 20 pass raw `e.message`. Success confirmations ("Link copied", "Purchases restored", "Plan updated") should be Toasts. The 6-button Alert in manufacturer-messages silently drops options on Android.
- **Polling:** 6 `setInterval` timers (hub ×3, messages 5s, sample 15s, production 15s) run while unfocused or backgrounded. The sample-detail poll flashes the whole screen to skeletons every 15s.
- **Component drift:** TouchableOpacity is used in 35 files versus PressableScale in 1, and ActivityIndicator in 23 versus LoadingSkeleton in 2. There are 81 `fontSize: 11/12` literals and 55 hex literals. Title Case buttons and labels appear in about 25 of 39 files.
