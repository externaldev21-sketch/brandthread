# Seller money + ops screen audit

Screen audit 8/10. Base: `origin/dev` @ `409ddcdc`. Every screen below was read in code and rendered in the web harness (`?bt_preview=seller`, 393×852, fresh and `&demo=1`), before the fixes and again after a rebuild. Swipe actions and "…" menus were checked in code before any "missing" claim. **32 screens, 314 findings, 211 fixed in this PR ([FIXED]), 103 left open** (each open item says why: shared component, redesign, backend or test change).

Not audited: **Wholesale**. No wholesale route or screen exists in `artifacts/mobile/app`; "wholesale" appears only in two code comments and one demo link title (`lib/previewGrowth.ts:71`). `app/gift-card-buy.tsx` is the buyer purchase flow, so it belongs to the buyer audit; the seller gift-card screen is `gift-cards-manage.tsx`.

**Finance** (`app/finance.tsx`)
- [FIXED] Recent transactions amounts rendered in green (`colors.success`, e.g. "+$240.00") and Summary values in green/red/primary ("$0.00" green, "-$0.00" red) — all ordinary values now `colors.foreground` (finance.tsx ~276, ~312)
- [FIXED] Stripe-balance overview cards (manager / ledger-error path) coloured values+icons success/primary/info — values now `colors.foreground`, icons `colors.mutedForeground` (~124, ~248); "Trial ends …" meta line blue `colors.info` -> `colors.mutedForeground` (~203)
- [FIXED] Summary showed "Fees -$0.00" (minus sign on a zero) — sign only shown when fees > 0 (~141-143)
- [FIXED] Title Case copy: "Gross Revenue", "Recent Transactions", "Download Statement (CSV)", "Monthly Statements (PDF / CSV)", "Tax Report / 1099-K" -> sentence case (~142, ~150-152, ~286)
- [FIXED] Off-scale type 12/14/16: subscription price suffix 12->13, subCardMeta 12->13, subCardPlan 16->17, overviewVal 16->17, plLabel/plValue 14->15, expAmount 14->15, docLabel 14->15 (styles + ~198)
- [FIXED] Off-grid spacing: scroll gutter `paddingHorizontal: 20` -> 16; `paddingBottom: 100` -> 24 (pushed seller screens already get tab-bar clearance from IsolatedStackScene in app/_layout.tsx, so 100 was dead space); row/card padding 14 -> 16, gaps 3/5 -> 4, pill paddingVertical 3 -> 4 (~180, styles)
- [FIXED] Spinners where the shape is known: role-loading `ActivityIndicator` and Recent transactions loading spinner -> `SkeletonBlock` rows (~159, ~290)
- [FIXED] a11y: Documents rows and the Platform subscription card had no `accessibilityRole`/label — added `accessibilityRole="button"` + label (~189, ~324); transaction name had no `numberOfLines` -> `numberOfLines={1}` (~306)
- Demo "Money activity" list renders green "+$240.00" amounts and ALL-CAPS 2–3-word card eyebrows ("ON THE WAY", "PAID OUT") — lives in shared `components/FinanceMoneyFlow.tsx`, not fixed here
- Demo shows the same 10 orders twice (Money activity and Recent transactions) — needs a content decision/redesign of which list to keep
- Demo "Available" card shows "—" + "Connect Stripe to get paid" while every other card shows $0.00 — from shared FinanceMoneyFlow / lib/previewFinance fixture
- "Download statement (CSV)" calls `Linking.openURL(${BASE}/api/finance/statement.csv)` with no auth token and swallows errors (`catch { /* ignore */ }`) — on a protected endpoint this opens a 401 page or silently does nothing; needs a signed URL/backend change

**Payouts** (`app/payouts.tsx`)
- [FIXED] Double tab-bar clearance: both tab ScrollViews had `marginBottom: tabBarMetrics.occupiedHeight` on top of the clearance IsolatedStackScene already applies to pushed seller screens — rendered a ~95px dead band and clipped the payout row mid-line ("···4242" and the "Paid" pill cut off); margin + `useTabBarMetrics` removed (~315, ~370)
- [FIXED] Balance hero read "Next payout —" when no date is known -> "No payout scheduled" (~212-216, ~277)
- [FIXED] ALL-CAPS multi-word section titles ("NEXT STEPS TO GET VERIFIED", "PAYOUT METHOD & SCHEDULE", "TAX INFORMATION") -> sentence case at 13pt (`sectionTitle` style: dropped uppercase/letterSpacing, FS.xs -> FS.sm)
- [FIXED] Sentences/secondary lines at 11pt (bankSub "Stripe is reviewing your account…", payoutSub "···4242", balanceHeroSub "Next payout …") -> FS.sm 13 (styles)
- [FIXED] Raw error text in the onboarding Alert (`error.message`, e.g. "Stripe did not provide a valid onboarding link.") -> fixed copy "Could not open Stripe onboarding. Try again." (~198)
- [FIXED] "Payout history"/"Bank account" tabs had no a11y role/state -> `accessibilityRole="tab"` + `accessibilityState={{ selected }}` (~300); skeleton gap 10 -> SP.sm
- Layout: Thread Cash card + balance hero + tab row are fixed above the tab ScrollView, so on a 393x852 phone the payout list / bank-account tab only gets a short strip of viewport (~50px before the margin fix, ~150px after); needs the hero moved inside the scroll — layout rework, not done
- Thread Cash balance renders in bright green ("$42.60") — shared `components/thread-cash/SellerThreadCashCard.tsx`
- Balance hero amount uses fontSize 40 (also payout-detail heroAmount 40) — above the 30pt top of the type scale; needs a design call on a hero-number token, not snapped
- `Alert.alert('Cashed out', …)` for a successful cash-out — rule 5 wants a toast; needs the shared toast wiring, not a mechanical change
- Harness "Owner access required" (fresh + demo): REAL preview defect, not a production one. lib/api.ts `rejectSellerPreviewApiRequest()` throws for EVERY request whenever `isSellerDevPreview()` is true, but payouts/payout-detail/payout-schedule only take their preview branch when preview is active AND Clerk is signed out (`isPreview = isPreviewMode && (!userId || !authLoaded || !isSignedIn)`). With a signed-in preview session (harness stub, native DEV_SELLER_PREVIEW with a real login) `useTeamRole` gets the forced 403 -> role null -> locked. finance.tsx/products.tsx already moved to "any seller preview skips the API". Not fixed here because `tests/signed-out-no-protected-calls-screens.test.ts` (L54) and `tests/seller-fresh-preview-no-demo-data.test.ts` (L102) pin the signed-out-only expression; fix = `const isPreview = isPreviewMode;` in payouts/payout-detail/payout-schedule (+ `skipApi = isSellerDevPreview() || demoActive` in payout-setup) together with those two test updates. Production owners are unaffected (verified by rendering with the seller Clerk stub and preview off)

**Payout** (`app/payout-detail.tsx`)
- [FIXED] Double tab-bar clearance (`marginBottom: tabBarMetrics.occupiedHeight` on the ScrollView) left ~95px dead space above the bar — removed with the `useTabBarMetrics` import (~124)
- [FIXED] Status pill padding 10/3 off-grid -> 12/4 (`pill` style)
- Harness lock + `demoDetail()` fixture unreachable in a signed-in preview — same preview-gate defect as Payouts (see above)
- Hero amount fontSize 40 off the type scale — same design call as Payouts
- "Payout not found" empty state has an empty message (`message=""`) and no action back to /payouts beyond the header — minor; left as is (EmptyState shared look)

**Payout schedule** (`app/payout-schedule.tsx`)
- [FIXED] Double tab-bar clearance on the ScrollView (dead band under "Save schedule") — removed (~214)
- [FIXED] Dead-end empty state "Connect Stripe to choose a schedule" with `message=""` and no action — added a one-line message and a "Set up payouts" action to the existing /payout-setup route (hidden for read-only managers) (~223)
- [FIXED] ALL-CAPS eyebrow sentence "WHEN YOU GET PAID" -> sentence case 13pt (`sectionTitle` style)
- [FIXED] Disabled option cards at opacity 0.6 -> 0.4 per the disabled-control rule (`cardOff`)
- Disabled "Save schedule" button renders as bare grey text with no button shape — shared `components/ui/Button.tsx` disabled style
- Success paths use `Alert.alert('Cash out requested', …)` and a silent save (haptic only, no confirmation) — needs toast wiring, not mechanical
- Harness lock — same preview-gate defect as Payouts

**Payout setup** (`app/payout-setup.tsx`)
- [FIXED] Double tab-bar clearance: root had `paddingBottom: tabBarMetrics.occupiedHeight`, so the "Start setup" footer floated ~95px above the bar with a dead band under it — removed (~126)
- [FIXED] Error state was a bare 26pt bold "Could not load setup" headline with no explanation -> shared `ErrorState` ("Couldn't load your payout setup." + Retry) (~130)
- [FIXED] Full-screen `ActivityIndicator` while loading a known shape -> `LoadingSkeleton` header + list blocks (~128)
- [FIXED] Raw `error.message` in the "Could not open Stripe" Alert -> fixed copy "Try again in a moment." (~90)
- [FIXED] CTA is disabled in preview (`disabled={opening || skipApi}`) but drew at full opacity (dead tap) — now also gets `btnDisabled` when `skipApi` (~184); progress segment gap 6 -> SP.sm
- No role gate (payouts/payout-schedule/payout-detail all check `hasPayoutsAccess`): a staff/marketing member reaching /payout-setup gets the generic load error instead of RoleLockedView — feature-level change, left
- Fresh harness "Could not load setup" — preview artifact from the same signed-in-preview gate (`signedOutPreview` requires signed out; the API rejects all preview calls)

**Billing** (`app/billing.tsx`)
- [FIXED] Load failure was swallowed (`.catch(() => {})`) and rendered "$0.00 USD", "No upcoming bill", "No payment method on file", "No bills yet" as if real; and the same fake $0.00 showed before data arrived — added load state: skeletons while loading, an inline retry row ("Couldn't load billing. Try again") on error, payment-method row shows "—" until loaded (~35-70, ~165-190, ~250)
- [FIXED] a11y: header export, "Past bills" export icon (18px, no hitSlop), "View bill" link, payment-method row, Restore purchases row and bill rows lacked `accessibilityRole`/labels; filter tabs lacked tab role/selected state — added roles, labels, `hitSlop` 12 on the small icon/link targets
- [FIXED] Raw `error.message` in "Could not restore purchases" Alert -> fixed copy "Try again in a moment." (~100)
- [FIXED] Title Case share text "Billing History" -> "Billing history" (~108)
- [FIXED] Off-scale type 12/14/28: nextBillText/noteText/filterTabText/billNote 12->13, billId/billAmount 14->15, price 28->26 (styles)
- [FIXED] Off-grid spacing: section gutter 20->16 and vertical 18->16, marginBottom 14->12, card/bill row padding 14->16, gaps 10->12, filter padding 3/7->4/8, emptyBills 18->16, scroll paddingBottom 60->24 (scene clearance already applied); role-loading spinner -> SkeletonBlock
- Two export buttons on web (header share icon + "Past bills" share icon) doing the same thing, and both export an empty "Billing history" when there are no bills — needs a decision on which control to keep
- Bill rows show the raw Stripe invoice id ("Bill #in_1P…") — needs a human invoice number from the backend
- `Alert.alert('Purchases restored', …)` for good news — rule 5 wants a toast
- Harness "Owner access required": preview artifact — billing has no preview branch, and lib/api.ts rejects every call in seller preview so `useTeamRole` resolves null. Rendered with the seller Clerk stub and preview off, it loads correctly for the owner ($29.00, Visa ···4242)

**Subscription plans** (`app/plans.tsx`)
- [FIXED] When the buyer closes the App Store purchase sheet, the screen showed a "Could not start checkout" alert. The catch now returns early on `e.userCancelled` (handleSelect catch).
- [FIXED] The checkout and restore failure alerts showed raw `e.message` text, including "RevenueCat is not configured for this build." The titles are now "Couldn't start checkout" / "Couldn't restore purchases" with the fixed body "Please check your connection and try again." (handleSelect / handleRestore).
- [FIXED] The success alert after returning from web checkout said "enjoy your 5-day free trial!", which has an exclamation mark and also claimed a trial when the status was `active`. It now reads "You're now on the X plan." and adds "Your 5-day free trial has started." only when `status === 'trialing'` (AppState listener).
- [FIXED] The waiting overlay repeated itself ("Confirming your trial…" / "Confirming your plan — this takes a moment."). It now reads "Confirming your plan…" / "This takes a moment."
- [FIXED] The hero subtitle said "— start free." even when the store returned no trial offer. "start free" now shows only when `hasRealTrialOffer` (SellerPaywallHeadline subtitle).
- [FIXED] The CTA loading label said "Starting trial…" on the no-trial "Choose X" path. It now reads "Starting checkout…" when there is no trial offer.
- [FIXED] The eyebrow "BRANDTHREAD FOR SELLERS" was 3 words in ALL CAPS (the rule allows at most 2). It is now "FOR SELLERS".
- [FIXED] The commission note, auto-renew disclosure and Terms/Privacy links were full sentences at 11pt. They are now 13pt (FS.sm, lineHeight 18). The legal footer gap of 10 is now 12, and the skip-row gap 6 / marginTop 4 are now SP.sm / SP.xs. The disclosure copy is unchanged.
- [FIXED] Accessibility: the Terms/Privacy text links had no role and now have `accessibilityRole="link"`. The "Not now" and "Restore purchases" rows had no role and now have `accessibilityRole="button"`, and the restore button also gets an accessibilityLabel.
- In the web harness render, the floating seller tab bar shows over /plans even though `'plans'` is in SELLER_TAB_BAR_FULL_SCREEN_SEGMENTS (app/_layout.tsx). The fix belongs in the shared layout or SellerGlobalTabBar, not this screen, and it may be a harness artifact (preview role bypass).
- The header has two exits that behave differently: the back arrow leaves immediately, while the X opens the retention exit drawer. This is a design decision.
- The "Plan updated" and "Purchases restored" success messages use Alert.alert, which breaks rule 5 (no alerts for good news). They need a toast/Snackbar host, which is out of scope for a mechanical fix.
- `TouchableOpacity` is used for the skip and restore rows. Not swapped, per the brief.
- `theme.background ?? '#0A0A0B'` hex fallback: kept, because app/plans.tsx is on the hardcoded-colour lint allowlist and removing it makes that test fail as "stale". It needs an allowlist edit in tests/.

**Subscription** (`app/subscription.tsx`)
- Harness note: the pre-fix shots show "Owner access required". That is a harness artifact: the signed-in stub plus the preview API block makes `useTeamRole` resolve `null`. I rendered the screen with the signed-out preview instead (scratchpad/plans/noauth.mjs).
- Real defect from the same cause: when the `team.context` request fails, a real owner sees the "Owner access required" lock instead of an error. The fix belongs in hooks/useTeamRole (shared), which needs to tell an error apart from "no role".
- [FIXED] A seller with no paid subscription (`status 'none'`) saw Starter labelled "CURRENT PLAN" with no button, so there was no way to choose Starter here even though handleChangePlan supports it. `isCurrent` now requires `status !== 'none'`, and the button reads "Choose {plan}" for non-subscribers. "Downgrade" shows only for real subscribers.
- [FIXED] The commission was hardcoded as "+ 5% platform commission on sales" and "5% per sale", but it varies by plan (5/4/3%). The screen now reads `api.seller.subscription.perks()` and uses `findPlanPerk` + `formatFeeRate`. The commission line is hidden and the billing row shows "—" until the data loads. Demo mode uses DEMO_PERKS.
- [FIXED] A failed status load silently kept the default "Starter / Free" state, which is fake data. The screen now shows an inline retry row ("Couldn’t load your plan — Tap to retry" / "Couldn’t load billing details — Tap to retry") instead of the plan card and billing card. This is an inline TouchableOpacity rather than RetryRow, because importing components/ui/RetryRow breaks lib/billingPermissions.test.tsx's module mocks.
- [FIXED] The billing tab showed a spinner while loading. It now shows a known-shape SkeletonBlock (232h, RADIUS.lg).
- [FIXED] The billing tab had no empty state for non-subscribers and showed only rows of "—". It now adds "No active subscription yet. Choose a plan on the Plan tab."
- [FIXED] The status pill said "Free" for a seller with no subscription, which is misleading because Starter is paid. It now says "Not subscribed", and "Past Due" is now "Past due". The muted pill colour on the primaryGradient card was barely visible in the render and now uses `theme.onAccent`.
- [FIXED] Ordinary values used green/cyan/purple accents. The current-plan badge, border and feature checks used SUCCESS green, the "Included" chips green, the trial-ends row a cyan tint and value, and the tab underline/label and "Manage billing" link/icon purple accent. All now use the foreground colour.
- [FIXED] The featured (Growth) card had `transform: scale(1.015)`, which pushed it past the 16px gutter so it was visibly wider than the other cards. The transform is removed.
- [FIXED] The comparison card said "What’s included in your plan" / "Your Growth Studio toolkit at a glance" while every row was locked "Growth only". The copy now depends on access: "What’s included in Growth" / "Studio tools that unlock with Growth". "MORE GROWTH PERKS" (3-word caps) is now "Growth perks".
- [FIXED] Sentences at 11pt are now 13pt: the renew/trial line, plan tagline, comparison subtitle, tool descriptions, past-due body and legal footer. Off-grid gaps changed: 3 to 4, pill 7/3 to SP.sm/SP.xs, legal gap 10 to 12.
- [FIXED] Accessibility: the Plan/Billing tabs get `accessibilityRole="tab"` + `selected` state. The change-plan, manage, restore and manage-billing buttons get `role="button"`, and the legal links get `role="link"`. Closing the App Store sheet no longer shows an error (`userCancelled`). The restore error alert no longer shows the raw message.
- Not fixed: the checkout and portal error alerts still show the raw `e.message`, e.g. "API 500: Billing service unavailable.". lib/billingPermissions.test.tsx asserts that exact raw text ('Checkout error' / 'Portal error'), so the copy fix needs a test update.
- Growth tool icons use per-tool orange/pink/etc. accents. These come from lib/growthTools (shared).
- The role-loading screen and the current-plan card still show spinners. A skeleton on the gradient card would need design.
- The "Purchases restored" success uses Alert.alert. It needs a toast host.

**Plan upsell modal** (`components/PlanUpsellModal.tsx`)
- Render note: I could not open it in the harness. The dev build sets GROWTH_UI_BYPASS, so tapping a Growth tool on /studio navigates straight through, and manufacturer-hub skips the gate in preview. I audited it by code; its tool list renders identically to /subscription's comparison card, which I did render.
- [FIXED] The subtitle count was wrong when `featureName` is not a Studio tool. For example, manufacturer-hub passes "Manufacturer Hub", and the modal said "and 7 more tools" when 8 are listed. The count is now computed as tools other than the tapped one (`otherToolCount`).
- [FIXED] The close "X" was an icon-only button with no label or role. It now has `accessibilityRole="button"` and `accessibilityLabel="Close"`. The Upgrade and "Maybe later" buttons now have `accessibilityRole="button"`.
- [FIXED] The section label "Studio tools you'll unlock" was a 4-word ALL-CAPS sentence. The `textTransform: 'uppercase'` is removed.
- [FIXED] Perk checkmarks were green (`theme.success`) on a green tint. They now use `theme.text` on `theme.cardElevated`.
- [FIXED] Tool descriptions were 11pt sentences and are now 13pt (lineHeight 18). The tapped-badge horizontal padding of 6 is now SP.sm.
- [FIXED] The "Maybe later" button label used `theme.subtle` (tertiary, low contrast). It now uses `theme.muted`.
- Tool icons use per-tool coloured accents from lib/growthTools (shared).
- The "You tapped this" badge copy is casual and the badge uses an accent tint. This is a design/copy decision.

**Taxes and duties** (`app/taxes-duties.tsx`)
- Harness note: the screen showed toggles off and "Not yet configured" even though the demo API returns `providerConfigured: true`. The preview API block made the status call fail, which exposed the real defect below.
- [FIXED] A failed `taxes.status()` load silently showed "off / not configured" as if those were the real settings. The screen now shows RetryRow "Couldn't load tax settings", disables both toggles, and hides the "Turn on automatic tax above" hint.
- [FIXED] While loading, the screen showed "Not yet configured" and "Annual paid-order totals are unavailable." It now shows a SkeletonLine for the status and "Loading annual paid-order totals…".
- [FIXED] The 1099-K gross was formatted with `(cents/100).toFixed(2)`, so it had no thousands separator. It now uses `formatCents`.
- [FIXED] "Federal threshold exceeded" and "Tax forms ready" were green for ordinary values. Both now use `colors.foreground`.
- [FIXED] Off-scale type: 12pt became 13 (subtitles, descriptions, status, info) and the 14pt row labels became 15. The 11pt disclaimer sentence became 13.
- [FIXED] Off-grid spacing: section paddingVertical 18 to 16; subtitle margins 6/14 to 8/16; card and toggle padding 14 to 16; gaps 10 to 12; the 10px dividers to 8; manage button paddingHorizontal 14 to 16; info icon margin 6 to 8.
- [FIXED] Status copy jargon: "Stripe Tax is configured on your connected account." is now "Stripe Tax is set up for your store.", and "Not yet configured — …" is now "Not set up yet — connect Stripe and turn this on to start."
- [FIXED] The "Open Stripe" button had no role or label and was about 36pt tall. It now has `accessibilityRole="link"`, `accessibilityLabel="Open Stripe tax registrations"` and a vertical hitSlop of 6, bringing it to 48.
- The info icon next to "Registrations and filing" looks tappable but does nothing. Removing it or making it a tooltip is a design decision.
- "Automatic tax turned on/off" success messages use Alert.alert. They need a toast host.
- The info box text is long legal copy that uses "nexus" and "marketplace-facilitator". I left it intentionally, since it is a compliance disclaimer.

**Team** (`app/team.tsx`)
- [FIXED] The header said "Team Management" (Title Case) — changed to "Team" (team.tsx:~305).
- [FIXED] The section titles were "Staff Accounts" and "Audit Log" (Title Case) — changed to "Staff" and "Activity".
- [FIXED] "Approval Workflows" showed a hardcoded list of fake settings ("Refunds > $100 — Owner approval", etc.). No API or enforcement backs them (grep finds no approval logic in api-server). Removed the section and its unused `workflow*` styles.
- [FIXED] When the load failed, the Activity card still said "No activity yet" — a false empty state shown on error. It now says "Couldn't load activity" when `loadError` is set.
- [FIXED] The member list showed a lone ActivityIndicator while loading, where the shape of the list is known. Replaced it with 3 skeleton rows (SkeletonBlock avatar plus 2 SkeletonLines from components/ui).
- [FIXED] Three error Alerts showed `Alert.alert('Error', err.message …)`. `err.message` is the raw JSON response body from ApiError. Replaced them with "Couldn't create the invite / Check the email or username and try again.", "Couldn't refresh the link / Check your connection and try again." and "Couldn't dismiss the invite / Check your connection and try again."
- [FIXED] Title Case copy: "Create Invite" changed to "Create invite", "Copy Link" to "Copy link", owner access "Full Access" to "Full access", and manager access "Orders, Products, Inventory" to "Orders, products & inventory".
- [FIXED] The icon-only copy-link/regenerate and dismiss buttons on invite rows had labels but no `accessibilityRole="button"`. Added it. Also added it to the header "Invite" button (plus a label), "Load more" and the modal "Cancel". Role pills now have `accessibilityRole="radio"` and `accessibilityState.selected`.
- [FIXED] Font sizes off the type scale: 14 changed to 15 (avatar initials, member name, expired title, error/empty titles, secLabel, invite input, role pill title, Cancel) and 12 changed to 13 (member access line, invite link box).
- [FIXED] Spacing off the scale: row/header/load-more padding 14 changed to 16, addBtn gap 6 to 8 and paddingVertical 7 to 8, invite input paddingVertical 10 to 12 and marginTop 14 to 16.
- "Link copied" is confirmed with a blocking Alert instead of a toast. Not fixed here: the toast needs Snackbar wiring, which is new UI.
- The invite modal is a centred card with `autoFocus` and no KeyboardAvoidingView, so the keyboard can cover the role grid and the "Create invite" button on small phones. Not fixed here: needs a layout rework (bottom sheet + KAV).
- In the invite modal's role grid, pills are `width: '47%'` with `gap: 10`, so the right column stops about 7pt short of the input's right edge (visible in the render). Not fixed here: grid layout change.
- If "Load more" on the activity log fails, the error is silently ignored (`catch { /* ignore */ }`) with no feedback. Not fixed here: needs an inline retry design.

**Invite** (`app/team-invite.tsx`)
- [FIXED] Jargon copy: "This invite link is missing its token." changed to "This invite link is incomplete. Ask the store owner for a new one."
- [FIXED] Exclamation mark and Title Case: "You're on the team!" changed to "You're in", "Open Dashboard" to "Open dashboard", "Accept Invite" to "Accept invite", and "Sign in / Create account to join" to "Sign in to join".
- [FIXED] Every accept failure showed "This invite link is invalid or has expired.", including 409 (already used), 400 (your own team) and network errors. These now map by `err.status` to "This invite has already been used.", "You can't join your own team.", the invalid/expired message for 404/410, and "Couldn't join the team. Check your connection and try again." for anything else.
- [FIXED] The secondary "Back to Brandthread" button (`colors.secondary` on `colors.card`) had no visible container in the render; it looked like bare text. Added a 1px `colors.border` border (3 places).
- [FIXED] Font sizes off the type scale: title 20 changed to 22, sub/button 14 to 15, invite-meta/hint 12 to 13. Spacing snapped: icon marginBottom 14 to 16, meta gap 6 to 8, button marginTop 18 to 20 and paddingVertical 13 to 12 (with minHeight 48), hint marginTop 10 to 12.
- [FIXED] Added `accessibilityRole="button"` to all 6 action buttons.
- A username-based invite with no email would read "Invite sent to undefined" (`invite?.email`). Not fixed here: the API always stores an email for invites (normEmail), so I can't confirm this happens, and handling it would need copy for a missing value.

**Store settings** (`app/store-settings.tsx`)
- [FIXED] The ".brandthread.app" suffix in Store URL was clipped off the right edge of the card ("…brandthreac" in the render). The web TextInput's `min-width: auto` stopped it from shrinking. Added `minWidth: 0` to the input and `flexShrink: 0` to the suffix. I verified this by injecting `min-width: 0` into the live render, after which the full suffix fits.
- [FIXED] ALL CAPS section headers "STORE IDENTITY", "LOCALIZATION", "STORE STATUS" and "CHECKOUT & ACCOUNTS" changed to sentence case ("Store identity", "Localization", "Store status", "Checkout & accounts").
- [FIXED] Title Case copy changed to sentence case: header "Store Settings", the labels "Store Name", "Contact Email", "Customer Support Email", "Time Zone", "Store Password", "Require Account", "Guest Checkout" and "Order Notifications", the status chips "Not Started" and "Password Protected", the button "Save Settings", and the placeholder "Your Brand Name". Also "Saving..." now uses a proper ellipsis ("Saving…").
- [FIXED] The save-failure Alert read "Error / Failed to save settings." It now reads "Couldn't save settings / Check your connection and try again."
- [FIXED] The store-status chips used accent colours for ordinary values (Published green, Draft blue, Password protected/Maintenance orange, Unpublished red). The active chip is now monochrome: `colors.foreground` border and text on `colors.secondary`. I removed the `statusColor()` helper.
- [FIXED] Spacing off the scale: field gap 6 changed to 8 (SP.sm), input paddingVertical 10 to 12, status chip padding 14/6 to 16/8.
- The toggles render iOS green. Not fixed here: the colour comes from the shared `components/ui/ListRow` toggle.
- The page has two Save controls: the header "Save" and the bottom "Save settings". Not fixed here: removing one is a product/layout decision.
- "Time zone" is a free-text field prefilled with "America/New_York". Not fixed here: needs a picker (new UI).
- The form has 8+ inputs and no KeyboardAvoidingView, so the keyboard covers the lower fields. Not fixed here: layout change.

**Export data** (`app/seller-data-export.tsx`)
- [FIXED] The header "Export My Data" (Title Case) changed to "Export data", the button "Generate Export" to "Generate export", and the share dialog title "Export Data" to "Export data".
- [FIXED] The exclamation mark in "Export ready!" is removed ("Export ready").
- [FIXED] The ALL CAPS eyebrow "WHAT TO INCLUDE" was 3 words at 12pt with 0.5 tracking. Rules allow ALL CAPS only for eyebrows of 2 words or fewer at 11pt with 0.8 tracking. Changed it to "Include" at 11pt with 0.8 tracking; this also applies to "Format".
- [FIXED] Jargon "Customer PII is included — store securely and handle per your privacy policy." was rewritten as "Exports contain only your own store data, including customer names and contact details. Store the file securely and handle it according to your privacy policy."
- [FIXED] The include rows were checkboxes with no accessibility semantics. Added `accessibilityRole="checkbox"`, `accessibilityState.checked` and a label. The JSON/CSV tiles now have `accessibilityRole="radio"` and `accessibilityState.selected`.
- [FIXED] Font sizes off the type scale: 14 changed to 15 (option label, format label), 12 to 13 (note, result date), 16 to 17 (count value).
- [FIXED] Spacing off the scale: option row padding 14 changed to 16, format gap 10 to 12, format tile padding/gap 14/6 to 16/8, note gap 10 to 12, counts gap 10 to 12.
- [FIXED] The result card used a green tint (`success + '1A'` background, `success + '4D'` border, green check) for an ordinary confirmation. It now uses `theme.card`/`theme.border` with a `theme.text` icon.
- When `Sharing.isAvailableAsync()` is false (web, some Android), the screen says "Export ready / Open it from the share sheet." But no share sheet opens and the file only sits in the cache, so the user can't get it. Not fixed here: needs a web download path (new behaviour).
- `router`, `insets`, `Platform`, `SecondaryButton` and the `header`/`headerTitle` styles are unused (dead code). Not fixed here: not user-visible, and cleaning it up widens the diff.

**Shipping & fulfillment** (`app/shipping.tsx`)
- [FIXED] On the "Shipping zones" and "Packaging presets" header rows, the "+ Add Zone" / "+ Add Package" pill overlapped the first line of the subtitle under it, so "rest-of-world catch-all" and "buying a label" were partly covered in the render. The cause was `sectionSubtitle` `marginTop: -6` with a 0 row margin. Changed to `sectionTitleRow` `marginBottom: 8, gap: 12` and removed the negative margin (styles ~1046-1048).
- [FIXED] The four stat values used accent colours for ordinary counts: orange "Pending", green "Delivered", red "Returns" (all were 0). They now use `colors.foreground` (~460).
- [FIXED] The stats showed a fake "0" while orders/returns were loading and also when their fetch failed, because the errors were swallowed. They now show "—" until `api.orders.list()` / `api.returns.listSeller()` resolves (`ordersLoaded`/`returnsLoaded`, ~135, ~184).
- [FIXED] If `api.shippingZones.list()` failed, the screen showed the "No shipping zones yet" empty state. It now shows `RetryRow` "Couldn’t load your shipping zones", which calls `loadShipping` (`zonesFailed`, ~170, ~597).
- [FIXED] The zones section showed a centred `ActivityIndicator` card while it loaded. It now shows a `SkeletonBlock` with the zone-card shape (~594).
- [FIXED] Title Case copy changed to sentence case: header "Shipping & Fulfillment"; sections "Active Shipments", "Returns & Exchanges", "Ship From", "Shipping Zones", "Rates Summary", "Packaging Presets"; buttons "Add Zone", "Add Package"; stat "In Transit"; shipment badges "Label Created" / "In Transit"; default zone name "Rest of World"; placeholder and alert "Small Box". Also removed the unreachable `'Out for Delivery'` badge branch.
- [FIXED] Jargon and stale copy: "Legacy Flat Rate" is now "Previous flat rate", with the body "Your shipping zones above are now used at checkout instead of this flat rate." "Countries (comma-separated ISO codes)" is now "Countries (2-letter codes, separated by commas)". The empty state "Add a Domestic zone to start, then Rest of World for everywhere else." is now "Add a domestic zone to start, then a rest-of-world zone for everywhere else."
- [FIXED] Five icon-only buttons had no accessibilityLabel/Role: package-preset edit and delete (pencil and trash, 14px icons with only 6px padding), the ship-from save check button, the "US ✎" country pill, and the weight-tier remove "x". Added a role and label to each, and hitSlop to the small ones (~558, ~566, ~731, ~734, ~854).
- [FIXED] Off-scale type sizes were snapped to the scale: statVal 18→17; sectionSubtitle, addRateBtnText, shipId, shipCarrier, zoneActionText, tableCellText, segmentText and tierInput 12→13; rateAmount 14→15; tableHeaderText and tierLabel 10→11.
- [FIXED] Off-token spacing was snapped: gaps 3/5/6/10 → 4/8/12; paddings 5/7/10/14 → 4/8/12/16 on stats, add pills, zone, preset and return rows, chips, tiers and the ship-from card. Removed 15 unused leftover styles (`back`, `pageTitle` 28px, `actionsRow`, `warehouse*` 14/12px, `capacity*`).
- The zone and package sheets are absolutely positioned inside the screen, so their scrim stops above the floating tab bar, which stays visible and tappable while a sheet is open (shown in the render). Not fixed here: this needs a `Modal`/`BottomSheet` move, which is layout rework.
- Ship-from edit mode has no cancel. Once the 2-letter field is open, the only way out is to save. Not fixed: it needs a new control.
- The "Ships internationally" switch thumb renders green when on. Not fixed here: the colour comes from the shared `HapticSwitch` in components/BrandthreadUI.

**Discounts** (`app/discounts.tsx`)
- [FIXED] The load-error state said "Pull to refresh.", but the ScrollView has no RefreshControl. Changed to "Check your connection and try again." The "Try again" button already exists (~411). In the harness this error state shows for both fresh and demo. That is a harness artifact (the stub signed-in user hits the signed-out-preview 403 guard in lib/api), not a product bug, but the copy is real.
- [FIXED] The save-failure alert showed a raw `err.message`, which reads "API 4xx: …". It now uses `apiErrorMessage(err, 'Check your connection and try again.')` from lib/safety (~355).
- [FIXED] Typing a malformed start/end date (e.g. "12/31") crashed `new Date(x).toISOString()` with a RangeError, which surfaced as the raw "Invalid time value" alert. Added a YYYY-MM-DD check with the alert "Invalid date" / "Use the format YYYY-MM-DD, like 2026-12-31." (~284).
- [FIXED] Pause/resume failures reverted silently, and delete failures silently reloaded the list. Both now show "Couldn't update the code" / "Couldn't delete the code" with "Check your connection and try again." (~370, ~387).
- [FIXED] Field labels use `textTransform: 'uppercase'`, and the nested hints inherited it, so the render showed ALL CAPS sentences: "CODE (OPTIONAL — AUTO-GENERATED IF BLANK)", "MINIMUM ORDER ($) (OPTIONAL)", "MINIMUM ITEMS (OPTIONAL)". Added a `labelHint` style (`textTransform: 'none'`) and used it on all three hints.
- [FIXED] Title Case in the create sheet: "New Discount Code" / "Edit Discount Code" are now "New discount code" / "Edit discount code", and "Create Code" / "Save Changes" are now "Create code" / "Save changes".
- [FIXED] Accent colours on ordinary controls in each code card: the pause icon was orange (`warning`), the resume icon green (`success`), and the usage bar green or orange below 90%. The icons now use `muted`, and the bar uses `text`, turning red (`error`) only at 90% or more.
- [FIXED] The full-screen `ActivityIndicator` on first load was replaced with three code-card `SkeletonBlock`s.
- [FIXED] List bottom padding was `insets.bottom + 40`. Raised to `insets.bottom + 120` so the last code card clears the ~110px floating tab bar.
- [FIXED] Two controls had no role or label. The code/value area, which copies the code, now has the role button and the label "Copy code X". The "Generate" text link had a ~16px-tall target; it now has a role, a label and `hitSlop` 12.
- [FIXED] Off-token spacing was snapped: statPill padding 6/3 → 8/4; summary card and row gaps 6 → 8; label marginBottom 6 → 8; typeBtn paddingVertical 10 → 12; card icon-row gap 10 → 12. Removed a tautological `discType === discType &&` in the usage-limit buttons, plus the unused `ActivityIndicator` import and `center` style.
- Every code-row action is inline in the code card: tap the code area to copy, then pencil to edit, pause/play, and trash to delete. There is no swipe action and no "..." menu, and no action is missing.
- Copying a code gives no visible confirmation, only a light haptic. Not fixed: it needs the shared toast/snackbar provider wired in.
- Start and end dates are free-text "YYYY-MM-DD" fields with no date picker. Not fixed: it needs a new picker control (redesign).
- In the create sheet, the "Type" and "Usage limits" grids have uneven button widths. "% Percent off" is narrower than "$ Fixed amount", and "Single-use" stretches the full width alone on its row. Not fixed: it needs grid layout rework.

**Gift cards** (`app/gift-cards-manage.tsx`)
- [FIXED] Save and issue errors showed `err.message` for 4xx responses, and `ApiError.message` carries the raw "API 4xx: " prefix. Both now use `apiErrorMessage(err, …)` from lib/safety, which strips the prefix and falls back on 5xx (~78, ~104).
- [FIXED] Tapping the last remaining amount chip ("$25.00 ×", labelled "Remove $25.00") did nothing, with no feedback. It now shows "Keep at least one amount." in the existing error line (~149).
- [FIXED] "Recipient name" is optional (only sent if filled) but wasn't marked. It is now "Recipient name (optional)".
- [FIXED] The loading state was a bare centred `ActivityIndicator`. It is now three `SkeletonBlock`s: the switch row, the amounts and the issue form.
- [FIXED] Card-row padding was `SP.sm + 2` (10, off-token). Changed to `SP.sm + SP.xs` (12).
- The "Sell gift cards" and "Allow custom amounts" switches render green when on. Not fixed here: the colour comes from the shared `HapticSwitch`.
- The "Void" link sits top-aligned against its two-line row instead of centred. In the render it lines up with the first line only. Not fixed: `PressableScale` applies its own min-height/hit-slop sizing, so this needs a look at the shared component.

**Manufacturer Hub** (`app/manufacturer-hub.tsx`)
- [FIXED] Dead deep link: `?tab=messages` fell back to Discover because `isTab()` only accepted the 5 strip tabs. This broke Discover "Recent conversations › See all", the Orders empty-state "Open messages" button and the profile "Inbox" button, which all landed on Discover. `isTab` now also accepts `'messages'` (~l.170).
- [FIXED] Partners tab: the relationship card's action row ("Message", "Quote", "Profile") overflowed the card and the screen edge, so "Profile" was clipped (seen in the demo render). Added `flexWrap: 'wrap'` to `relCard.actionRow` (~l.1183).
- [FIXED] Discover used a double gutter. The list header (RFQ card, "My RFQs"/"Compare" buttons, category chips, rails), the result count and the loading skeleton grid each added 16px of padding on top of the list's own 16px, so they sat at 32px while the cards below sat at 16px. Removed the extra `paddingHorizontal` from `discoverIntroContent`, `resultCount` and `skeletonGrid` (~l.1770-1785).
- [FIXED] Fresh/empty directory showed "Try adjusting your search or filters." plus a "Clear filters" button when no search or filter was active, so the button did nothing. With no search or filters it now says "No manufacturers are listed yet." and has no button. With an active search or filter, "Clear filters" now also clears the search text and reloads; before, it reloaded with the old query (~l.725-737).
- [FIXED] Quotes tab showed a blank screen while loading (the empty branch was gated on `!loading`, and the list branch rendered nothing). It now shows the same skeleton rows as the other tabs (`testID="quotes-loading"`) (~l.1259).
- [FIXED] Quotes empty state had two identical CTAs: the EmptyState "Request a quote" button and the floating "Request quote" pill. Removed the floating pill from the empty branch only (~l.1263-1276).
- [FIXED] "Withdraw" on a quote request fired immediately with no confirmation. It now asks "Withdraw this request?" / "The manufacturer will be notified." with [Keep] [Withdraw] (~l.1277).
- [FIXED] Status badges showed raw lowercase enums ("quote received", "awaiting payment", "review needed"). Added `statusLabel()` for sentence case ("Awaiting payment") and used it for quote-request and sample badges (~l.70, 1360, 1476).
- [FIXED] Copy, Title Case: "Request for Quotation", "Compare Suppliers", "Filter Manufacturers", "Quote Requests", "Quotes Received", alert titles "Accept Quote"/"Decline Quote". Changed to "Request for quotation", "Compare suppliers", "Filters", "Quote requests", "Quotes received", "Accept quote?"/"Decline quote?". The decline body is now "The manufacturer will be notified."
- [FIXED] Copy, jargon: tab label "My Mfgs" is now "Partners". "Low MOQ" rail is now "Low minimum order". Sort chip "Lowest MOQ" is now "Lowest minimum order". Filter section "Min Order Qty (MOQ)" is now "Minimum order". Card fallback "Contact for MOQ" is now "on request". "40d lead time" is now "40-day lead time".
- [FIXED] Empty-state titles ended in periods ("Build your production network.", "Request your first production quote.", "Your samples will appear here.", "Bulk orders show up here.", "Manufacturer conversations will appear here."). Periods removed.
- [FIXED] Filter sheet section labels were ALL CAPS multi-word sentences ("MIN ORDER QTY (MOQ)", "YEARS IN BUSINESS") and the labels in code were Title Case ("Unit Price", "Lead Time"). Removed `textTransform: 'uppercase'` and the letter-spacing, and changed the labels to sentence case (~l.973-987, 1033).
- [FIXED] Filter sheet bottom inset was applied twice (on the root and on the footer), leaving about 100px of dead space under "Apply filters". Removed it from the root (~l.934).
- [FIXED] Filter sheet close "x" was an icon-only TouchableOpacity with no label, no role and no hitSlop. Added `accessibilityRole="button"`, `accessibilityLabel="Close filters"` and hitSlop 12 (~l.938).
- [FIXED] Small hit targets: the favourite heart (28pt) and the request-quote icon button (32pt) on directory cards had no hitSlop. Added hitSlop 8 and 6 (~l.790, 840).
- [FIXED] Rating value "4.9" was drawn in amber `theme.warning`, an ordinary value in an accent colour. It now uses `theme.text`; the star icon stays as it was (~l.873).
- [FIXED] Off-scale type: card fallback initial 34 is now `FS.h2` (30). Years badge 10, featured-rail location 10, filter-count badge 10 and preview unread badge 10 are now `FS.xs` (11).
- The 5-segment tab strip still clips: at 393pt "Samples" is cut by the fade and "Orders" is fully off-screen. Opening `?tab=production` therefore shows no active indicator, and the strip doesn't scroll to the active tab. Not fixed: trimming the spacing still leaves about 70px of overflow, so this needs a layout decision (shorter labels, icon-only segments, or auto-scroll to the active tab).
- Filter sheet footer: "Reset" and "Apply filters" only fill about half the row because `flex` passed via `style` isn't applied to the outer press wrapper of `SecondaryButton`/`PrimaryButton`. Not fixed: shared component (`components/BrandthreadUI.tsx`).
- The Quotes, Samples and Orders tabs are always empty in the harness, in both fresh and demo, because their loaders return `[]` under `isSellerDevPreview()`. This is a harness/preview limitation, not a product bug. The card layouts for those tabs were reviewed in code only.
- Header title "Manufacturer Hub" is Title Case. Not changed here: it's the feature name used by `PlanUpsellModal featureName` and other entry points outside this file set, so renaming it should happen in one place app-wide.
- Samples (15s), Orders (15s) and Messages (10s) keep polling with `setInterval` when the screen is unfocused or backgrounded. The Quotes tab also makes one `getManufacturer` call per quote (N+1). Not fixed: needs focus/AppState-aware polling and a batched fetch (service change).

**Compare suppliers** (`app/manufacturer-compare.tsx`)
- [FIXED] A load error was shown as "No saved manufacturers yet" (the catch set an empty list), so failures looked like a real empty state. Added an `error` state that renders an EmptyState "Couldn't load your saved manufacturers" / "Check your connection and try again." with a [Try again] button.
- [FIXED] Comparison columns stretched to the full scroll height, leaving about 60pt of empty card below "Request quote" (seen in the demo render). Set `alignItems: 'flex-start'` on the horizontal content container.
- [FIXED] Picker label "PICK 2–4 TO COMPARE" was an ALL CAPS sentence at 11pt. Removed the uppercase transform and letter-spacing and moved it to 13pt.
- [FIXED] Header "Compare Suppliers" (Title Case) is now "Compare suppliers".
- [FIXED] Row label "MOQ" (jargon) is now "Min. order", and the missing-value text "Contact" is now "On request".
- The label column scrolls away horizontally with the value columns, so row labels are lost when you scroll to the third or fourth supplier. Not fixed: needs layout rework (pin the label column outside the horizontal ScrollView).
- Loading is a centred spinner although the table shape is known. Not fixed: no matching table skeleton component exists.
- Values use text glyphs ("★ 4.9", "✓ Verified", "✗ Unverified") instead of Feather icons. Not fixed: changing this means restructuring the cell rendering, beyond a mechanical fix.

**Manufacturer conversation** (`app/manufacturer-messages.tsx`)
- [FIXED] Attach button used hex literals (`backgroundColor: '#FFFFFF'`, icon `'#000000'`), which renders white-on-white on light accents. It now uses `theme.accent` / `theme.onAccent`, the same as the Composer send button.
- [FIXED] Icon-only buttons were missing a11y props: the header "info" (profile) button had no `accessibilityRole`, the attach button had no role, and the pending-photo remove "x" (18pt) had no role and no hitSlop. Added `accessibilityRole="button"` throughout. Added hitSlop 12 on the remove "x" and hitSlop 4 on the 36pt header, call and attach buttons.
- [FIXED] System-message timestamp `fontSize: 10` is now `FS.xs` (11).
- The harness can't render the thread: it shows "Conversation unavailable / Manufacturer messaging is unavailable in the signed-out preview." This is a harness artifact (the `isSellerDevPreview()` guard), not a product bug. The bubbles, composer and attach sheet were reviewed in code only.
- Loading shows a bare spinner with "Loading conversation…" instead of a message skeleton. Not fixed: there's no chat-bubble skeleton in `components/ui`.
- The 5s `setInterval` keeps refetching the whole thread while unfocused or backgrounded. Not fixed: needs focus/AppState-aware polling and incremental fetch.
- Ratchet note: `tests/no-coming-soon-lint.test.ts` "stale" fails because `app/manufacturer-messages.tsx` is still on its allowlist but no longer contains the wording. This is pre-existing and not caused by this pass; the allowlist lives in a test file outside my file set.

**Manufacturer signup** (`app/manufacturer-onboard.tsx`)
- [FIXED] Vendor jargon "…and get paid through Stripe." is now "…and get paid." "Brandthread Manufacturer Portal" (Title Case) is now "Brandthread manufacturer portal".
- [FIXED] Off-scale card radius 22 is now `RADIUS.lg` (18). Card and row gaps of 10 are now 12.
- Whole screen uses deprecated static colour tokens (`BG`, `FG`, `MUTED`, `CARD`, `BORDER`, `SUBTLE`) at module scope, so it ignores the chosen app theme. Not fixed: needs a `makeStyles(theme)` conversion, beyond a surgical fix.
- The raw join URL (e.g. "https://…/manufacturers/join?invite=abc") is printed under the CTA as selectable text. Left as is: it's intentional, so the manufacturer can copy it on desktop. Flagged for a copy/design decision ("Copy link" control vs. raw URL).

**Product** (`app/manufacturer-product.tsx`)
- [FIXED] A missing product and a failed load showed the same "Product unavailable / This catalog product could not be loaded." with [Retry]; retrying a not-found product is pointless. Error now shows "Couldn't load this product" / "Check your connection and try again." with [Try again]. Not-found now shows "Product not found" / "It may have been removed from this manufacturer's catalog." with [Go back].
- [FIXED] Gallery images were a fixed `width: 360` inside a `pagingEnabled` horizontal ScrollView, so pages misaligned and left a strip on 393pt and wider screens. Width now comes from `useWindowDimensions()`.
- [FIXED] Copy, Title Case: "Request Quote for this Product" is now "Request a quote". "Quantity Pricing", "Customization Options" and "Unit Price" are now sentence case.
- [FIXED] Stat label "MOQ" (jargon) is now "Min. order".
- [FIXED] Stat tile `gap: 3` (off-grid) is now `SP.xs` (4).
- Loading is a centred spinner although the page shape is known. Not fixed: there's no product-detail skeleton in `components/ui`.
- "Sample price" tile reads "$82 sample", which repeats the word sample. This comes from `samplePriceLabel` in the data, so it's a data/backend copy issue, not screen code.

**Manufacturer profile** (`app/manufacturer-profile.tsx`)
- [FIXED] Hero name, location, local time and rating were invisible. They used `getOnAccentTextStyle(theme)` / `theme.onAccent` (dark text) on `theme.heroGradient`, which is dark in all 12 presets. In the demo render only the "Verified" pill showed, pushed off-centre by an invisible name. Name now uses `theme.text`; location, time and rating use `theme.muted`. The star and pin icons follow, and the "Private partner" badge uses `theme.cardElevated` / `theme.text`.
- [FIXED] The whole hero was sticky (`stickyHeaderIndices={[0]}`), pinning about 40% of the screen and leaving the content to scroll in a short band above the CTA. Removed the sticky index.
- [FIXED] Hero back button sat at `top: 0`, under the status bar / Dynamic Island (the DOM probe showed y=0). It's now offset by `headerTopInset`. Both back buttons (hero and not-found) also got `accessibilityRole="button"` and `accessibilityLabel="Go back"`.
- [FIXED] "Messages" sat next to "Message" and looked almost identical; it's now labelled "Inbox". Its target `/manufacturer-hub?tab=messages` used to land on Discover; that's fixed via the hub `isTab` fix.
- [FIXED] Quick-action labels and icons used accent colours: red "Saved" text, cyan/info "Message", accent-light "Messages"/"Quote". All are now `theme.text`; the saved heart icon uses `theme.error`.
- [FIXED] Pricing showed fake zeros when a value was missing ("0 units", "$0.00–$0.00", "0 days"). Each value now shows "On request" when it's 0. Labels "MOQ", "Unit Price", "Sample Price", "Lead Time" are now "Minimum order", "Unit price", "Sample price", "Lead time".
- [FIXED] Contact email, website and phone looked like links but couldn't be tapped. They're now tappable rows that open `mailto:`, `https:` and `tel:` via `Linking.openURL`, with `accessibilityRole="link"`, labels and a 44pt minimum height.
- [FIXED] Certifications always said "Active", even past `validUntil`. They now show "Expired" (neutral) once `validUntil` has passed.
- [FIXED] Off-palette chips and values: green shipping-region chips (`rgba(16,185,129,…)` / `SUCCESS`) and the amber certification icon (`GOLD`, `rgba(245,158,11,…)`) now use `CARD_ELEVATED` / `FG`. Accent-coloured pricing values and catalog "from $x/unit" now use `FG`.
- [FIXED] Copy, Title Case: "Request Quote" is now "Request a quote". "Request a Sample", "Print Methods", "Product Catalog" and "Shipping Regions" are now sentence case. Catalog meta "MOQ 150 · 28d lead" is now "Min. 150 · 28-day lead".
- [FIXED] Catalog price-tier mini table used `fontSize: 10` (quantity and price); both are now `FS.xs` (11).
- Demo shows "4.9 (87 reviews)" in the hero while the Reviews section says "No reviews yet": `reviewCount` and `reviews[]` disagree in the preview fixture. This is a data/fixture issue (lib/previewManufacturers.ts), not screen code.
- Screen styles use deprecated static tokens at module scope (`CARD`, `SURFACE`, `BORDER`, `FG`, `MUTED`, plus default `PURPLE_DIM`/`PURPLE_LIGHT` chip colours), so non-mono themes get mismatched cards and chips. Not fixed: needs a `makeStyles(theme)` conversion.
- Loading is a full-screen large spinner. Not fixed: there's no profile skeleton component.

**Invite a manufacturer** (`app/invite-manufacturer.tsx`)
- [FIXED] "Your invites" load error was hand-rolled orange text ("Invites couldn't be loaded. Tap to retry.") in a role-less TouchableOpacity, using static `ORANGE`. It's now the shared `RetryRow` ("Couldn't load your invites"). In the harness the invites endpoint isn't served, so the error state shows there; that's a harness artifact.
- [FIXED] Field validation errors used the static `ORANGE`. They now use `theme.error`, and the off-grid `marginTop: -6` is now -4.
- [FIXED] "Share again" pill (32pt tall) had no role and no hitSlop. Added `accessibilityRole="button"` and hitSlop.
- [FIXED] Link box padding `SP.sm + 2` (10, off-grid) is now 12.
- Screen uses static colour tokens (`CARD`, `BORDER`, `FG`, `MUTED`, `SUBTLE`, `SUCCESS`, plus `rgba(16,185,129,0.14)` on the success icon). Not fixed: needs a `makeStyles(theme)` conversion.
- Invite history loading is a spinner. Not fixed: the list shape is known but there's no row skeleton for it here (minor).

**Opening the manufacturer hub (redirect shim)** (`app/manufacturer.tsx`)
- [FIXED] Interim label "Opening Manufacturer Hub…" (Title Case) is now "Opening the manufacturer hub…".
- It renders a spinner and label for one frame before `router.replace`. Left as is: it's a compatibility shim and the flash is shorter than a frame on device.

**Request a sample** (`app/request-sample.tsx`)
- [FIXED] Title Case header and CTA: "Request Sample" and "Send Sample Request". Now "Request a sample" and "Send request" (header in all 3 states, CTA ~l.164).
- [FIXED] A network failure loading the manufacturer was swallowed (`.catch(() => {})`), so it showed "Manufacturer unavailable — This manufacturer is no longer listed…". That is a false "delisted" message. Added a `loadFailed` state with an EmptyState "Couldn't load manufacturer" and a "Try again" action that re-runs the effect via `reloadKey` (~l.30-58, 111-127).
- [FIXED] Raw error text in the alert (`error.message`). Now "Couldn't send request / Check your connection and try again." (~l.85).
- [FIXED] Off-scale type: the field eyebrow label was 12 pt and is now 11 pt with +0.8 tracking (labels are ≤2 words). The input was 14 pt and is now 15 (createStyles `label`, `input`).
- The initial load is a bare full-screen spinner with no header (l.93). It should be a header plus a form skeleton. Not fixed: needs a new skeleton layout.
- Success is reported with `Alert.alert('Sample request sent')`, but rule 5 says good news goes in a toast. Not fixed: needs the toast/Snackbar flow, not a mechanical change.
- Size is a free-text field that defaults to "M" (the old punch list asked for size chips). Not fixed: that is a feature change.
- Dead styles `header`/`backButton`/`headerTitle`/`headerSub` (fontSize 16/12) are left over from the old bespoke header. They are unused and not rendered, so I left them alone.

**Sample details** (`app/sample-detail.tsx`)
- [FIXED] Dead tap: the "Help Center" action-bar button only opened an Alert reading "Visit help.brandthread.com…". It is now wired to the existing `/help` route and labelled "Help center" (~l.1004).
- [FIXED] Wrong timeline: `revision_requested` sat in the linear step list, so every shipped or delivered sample showed "Revision Requested ✓ — The manufacturer is applying requested changes." even when no revision was ever made (verified on so-1). The step now appears only when the sample is actually in revision (SampleTimeline ~l.188).
- [FIXED] Off-palette accents: completed timeline dots and rails were green (SUCCESS), the "Paid" value was green, and filled rating stars were gold (GOLD). All now use FG (monochrome). The payment error text was static ORANGE and is now the theme `colors.destructive` (genuine error).
- [FIXED] Raw `error.message` was shown in the payment-error line and in the review, revision and upload alerts. All now use plain copy, e.g. "Couldn't open secure checkout. Try again." and "Couldn't submit review / Check your connection and try again." (~l.445-630).
- [FIXED] Title Case everywhere. Header "Sample Details" is now "Sample details". Status and type labels changed from "Awaiting Payment / In Development / Revision Requested / Review Needed / Size Set / Pre-Production" to sentence case. Buttons and sections changed from "Pay Securely / Write Review / Message Manufacturer / Add Image / Submit Review / Submit Revision / Request Revision / Revision History / Write a Review / Detailed Notes / Est. Completion" to sentence case. Alert titles changed from "Rating Required / Title Required / Permission Required / Upload Failed" to sentence case, with clearer bodies.
- [FIXED] a11y: the icon-only star buttons had no label or role, and their hit area was about 32 pt. They now have role "button", label "N stars", selected/disabled state, and hitSlop 12 vertically. The decision and priority chips now have role "radio", a label, and selected state.
- The action bar stacks 3 full-width buttons ("Request revision", "Help center", "Write review"), about 165 pt tall. That leaves about 420 pt of scroll area on a 393×852 screen. "Write review" also appears twice: in the Review section and as the primary CTA. Not fixed: layout and CTA rework.
- On a delivered sample, "Payment" shows "Pending" and "Est. completion" is always "—". `mapSampleOrder` sets `paymentStatus: 'pending'` unless the status is `payment_received`, and it never maps `estimatedCompletionDate` (services/manufacturerService.ts:513-536). Not fixed: shared service, not my file.
- The revision "Deadline (YYYY-MM-DD)" field is free text, and its placeholder "2025-06-01" is a past date. Not fixed: it needs a date picker, which is a feature change.
- The whole file uses deprecated static colour tokens (BG/FG/MUTED/BORDER/CARD) instead of `useColors()`, so it will not follow light or coloured themes (rule 1.1). Not fixed: it is a whole-file theming migration.
- In the seller preview, any id renders "Sample not found". This is a harness artifact: serviceRequest is disabled in the seller preview. With the fake API (`bt_preview=buyer`), so-1 and so-2 render correctly.

**Bundles** (`app/product-bundles.tsx`)
- [FIXED] Fake empty state on error: a failed `bundles.list()` was only `console.warn`ed, and the screen showed "No bundles yet / Create first bundle". It now shows `ErrorState` "Couldn't load your bundles." with "Try again" when the load fails and nothing is cached (new `loadError` state).
- [FIXED] A full-screen spinner was used for a list with a known shape. It is replaced by three `LoadingSkeleton` rows (78 tall).
- [FIXED] Off-palette status badges: Active was green on green-dim and Draft was orange on orange-dim. Now Active is FG with a 1 px BORDER_ACTIVE outline and Draft is MUTED with a 1 px BORDER outline.
- [FIXED] Off-scale type. The 11 pt hint sentence is now 13 pt, and its colour changed from SUBTLE to MUTED. Row meta went from 11 to 13 pt with `numberOfLines={1}`. Row name went from 13 to 15 pt (list primary). Row body gap went from 3 to 4.
- [FIXED] a11y: rows now have role "button", a label of "{name}, Active/Draft", and a hint. The header "+" IconButton is now labelled "New bundle".
- [FIXED] The list bottom padding was `insets.bottom + 24`, so on a long list the last row ended under the floating seller tab bar. It is now `insets.bottom + 120`.
- Orphan route: nothing in the app pushes `/product-bundles`. It is only listed in `SellerGlobalTabBar` matchSegments and in `_layout`. Not fixed: the entry point belongs in Products/More, which are not my files.

**New bundle / Edit bundle** (`app/product-bundle-edit.tsx`)
- [FIXED] A failed bundle load was swallowed (`.catch(() => {})`). It rendered a blank "Edit Bundle" form with "Save changes" enabled, so saving would overwrite the bundle's name and price (verified: bundleId=bun-1 in the seller preview renders blank fields). It now shows a header plus `ErrorState` "Couldn't load this bundle." with "Try again" (`loadError`/`reloadKey`).
- [FIXED] `removeItem` had no try/catch, which meant an unhandled rejection and no feedback on failure. It is now wrapped, with the alert "Couldn't remove product".
- [FIXED] A failed catalog load showed "No active products found." It now shows "Couldn't load your products. Close and reopen to try again." (`catalogError`).
- [FIXED] Rules-of-hooks bug: `useHeaderTopInset()` was called inline after the early `if (loading) return`, so the hook count changed between renders. It is now hoisted to `headerTopInset` at the top of the component.
- [FIXED] Title Case: "New Bundle / Edit Bundle / Create Bundle / Save Changes" are now sentence case. The generic "Error" alert titles are now specific ("Couldn't add product", "Couldn't save bundle", "Couldn't delete bundle") with an actionable body. "Name required" now has a body ("Give your bundle a name.").
- [FIXED] a11y and hit targets: the trash icon button had no label and a hit area of about 22 pt. It is now labelled "Remove {product} from bundle" with role "button", padding 8 and hitSlop 12. "Add product" got role, label and hitSlop 8, and its padding moved from 6/10 to 8/12. Catalog rows got role and the label "Add {name} to bundle". "Delete bundle" got role and a label.
- [FIXED] Off-scale and off-palette text. The 11 pt sentences (field hint, "Save the bundle first…" hint, "Individual total") are now 13 pt. Item variant and price went from 11 to 13 pt, and the item price changed from PURPLE_LIGHT to FG. The savings card padding went from 8 to 12 and its gap from 2 to 4. The add-button label went from 11 to 13 pt.
- Success is still an `Alert.alert('Saved', 'Bundle updated.')`, but rule 5 says it should be a toast. Not fixed: needs the toast flow.
- "Add product" is tappable on a new, unsaved bundle, and picking a product only raises "Save first". Not fixed: disabling or hiding it is a behaviour change.
- Item thumbnails always show a placeholder icon and ignore `item.images`. Not fixed: needs image rendering, which is a feature change.
- The loading state is `BrandedLoadingState`, a full-screen spinner with no header. Not fixed: it is a shared component, and a form skeleton would need a new layout.
- The "Active" toggle track is green (HapticSwitch default). Not fixed: shared component (components/BrandthreadUI.tsx HapticSwitch).

**Integrations** (`app/integrations/index.tsx`)
- [FIXED] Wrong count: the footer used `connectedKeys.size + stripe`, so any extra key the backend returns (e.g. `shopify`, or `stripe` itself) inflates it. With `{klaviyo, shopify}` plus connected Stripe it rendered "3 of 2 integrations connected". It now counts only the listed integrations.
- [FIXED] Clipped text: the Klaviyo description "Email & SMS marketing automation" was cut off to "Email & SMS marketing automati…". The copy is now "Email and SMS marketing" and the font went from 11 to 13 pt.
- [FIXED] The hardcoded icon colour `#FFFFFF` would be invisible on light themes. It now uses `colors.foreground`.
- [FIXED] Misleading subtitle: "…sales channels, marketing, and shipping in one place." appeared above a list that only has Klaviyo and Stripe. It now reads "Connect the tools you already use to run your brand." and the font went from 12 to 13 pt.
- [FIXED] Generic "Error" alert titles and vendor jargon ("Stripe did not provide a valid onboarding link", "Could not open Stripe onboarding") are now "Couldn't open payout setup", "Couldn't connect/disconnect {X}", each with an actionable body.
- [FIXED] Off-scale type and spacing: the Connect label went from 12 to 13 pt, the row label from 13 to 15, row padding from 14 to 16, and section vertical padding from 18 to 16.
- [FIXED] a11y: rows had no role or label. They now have role "button", the label "{X}, connected/not connected", and busy state. The Retry button got role and a label.
- The screen is effectively unreachable. More → "Integrations" pushes `/integrations/klaviyo` directly (app/(tabs)/more.tsx:99), and `/integrations/shopify-fulfillment` is linked from nowhere and not listed here. Not fixed: navigation lives in more.tsx, and adding a Shopify row would be a new list entry.
- Loading is a centred spinner for a two-row list with a known shape. Not fixed here; left as is to keep the diff small (could use LoadingSkeleton).
- In the seller preview the screen shows "Couldn't load your integrations." This is a harness artifact: `/seller/settings/integrations` is unseeded in demo-data. With a mock, the real list renders.

**Klaviyo** (`app/integrations/klaviyo.tsx`)
- [FIXED] Fake "not connected" state on error: a failed status load set `{ connected: false }`, so a connected seller saw the API-key form. It now shows `ErrorState` "Couldn't load your Klaviyo connection." with "Try again".
- [FIXED] Disconnect had no error handling (unhandled promise) and no busy state. It now uses try/catch with the alert "Couldn't disconnect Klaviyo", is disabled while running, and shows "Disconnecting…".
- [FIXED] Copy: the hero "Klaviyo: Email Marketing & SMS" is now "Klaviyo email and SMS". "Email subs"/"SMS subs" are now "Email subscribers"/"SMS subscribers". The all-caps label "KLAVIYO PRIVATE API KEY" (4 words) is now "Private API key" in sentence case at 13 pt. The placeholder `pk_xxxxxxxx…` is now "Paste your key (starts with pk_)". "Where do I find my Private API Key?" is now sentence case.
- [FIXED] A spinner was used while loading. It is now a `LoadingSkeleton` (180).
- [FIXED] Off-scale type and spacing. Changes: label 12→13, input 14→15, help link 12→13, connected text 14→15, stat value 20→19. Last-synced and info text went from 11 to 13, input padding from 13 to 12, section padding from 18 to 16, and scroll bottom padding from 60 to 120 to clear the tab bar.
- [FIXED] a11y: the Sync, Connect and Disconnect buttons now have role "button" and disabled/busy state. The help link has role "link". The API-key input has an accessibilityLabel.
- Success on connect is an `Alert.alert('Connected', …)`, but rule 5 says it should be a toast. Not fixed: needs the toast flow.
- The help link opens `help.klaviyo.com` with `Linking.openURL` and no in-app browser. It also uses `colors.primary` as a link colour, which is white on the mono theme, so that is fine. No change.

**Fulfillment connections** (`app/integrations/shopify-fulfillment.tsx`)
- [FIXED] Hardcoded green brand-ish colours on the Shopify icon tile (`#95BF4722` bg, `#5E8E3E` icon). They now use the same `colors.primary` tint as the card below.
- [FIXED] Jargon and italic footnote: "Tapstitch doesn't offer a direct API — this is how orders reach it…" (italic, 11 pt) is now "This is how Brandthread orders reach Tapstitch and any other Shopify fulfillment app." (13 pt, not italic).
- [FIXED] A raw `err.message` was shown in the "Could not update fulfillment" alert. Now: "Couldn't update fulfillment / Check your connection and try again."
- [FIXED] Disconnect had no try/catch (unhandled promise). It now shows "Couldn't disconnect Shopify" on failure.
- [FIXED] Off-scale and all-caps type. The sub-line went from 12 to 13 pt, explainer steps from 12 to 13, input from 14 to 15, and the footnote from 11 to 13. The 3-word all-caps label "SHOPIFY STORE DOMAIN" is now sentence case at 13 pt, and its top margin went from 6 to 8.
- [FIXED] a11y: the switch now has the label "Fulfill orders through my Shopify store", the domain input has a label, and Disconnect has role "button". Scroll bottom padding went from 60 to 120 to clear the tab bar.
- Orphan route: nothing links to `/integrations/shopify-fulfillment` (only a comment in app/shopify-import.tsx). Not fixed: needs a nav entry in a file I don't own (or a new row on Integrations).
- A failed status load silently becomes "Not connected", and after OAuth the screen re-checks with a blind `setTimeout(load, 4000)`. Not fixed: needs focus/deep-link-based refresh, which is a behaviour change.

## Harness notes (not product defects)

- In `?bt_preview=seller` a signed-in preview rejects every API call (`lib/api.ts` `rejectSellerPreviewApiRequest`, `lib/serviceConfig.ts:102`). So Team, Discounts, Integrations, Samples and Bundles show their error or empty states, and Payouts, Payout schedule and Billing show "Owner access required", unless they have a preview branch. Those states were checked against the real data paths by rendering with `bt_preview=buyer` plus fake API routes. The payouts preview gate is listed as an open finding under Payouts.
- Finance (`app/finance.tsx`): for lead: `app/billing-access.test.tsx` asserts `not.toContain('Download Statement (CSV)')` for managers; the sentence-case rename makes that assertion vacuous (test file already fails to load at baseline, "Unexpected token 'typeof'") — update the string to 'Download statement (CSV)' when that test is repaired
- Billing (`app/billing.tsx`): for lead: retry UI is an inline TouchableOpacity, not `RetryRow`, because importing `components/ui/RetryRow` makes `lib/billingPermissions.test.tsx` fail to load ("Unexpected token 'typeof'"). That test currently fails at baseline anyway ("No COMP export is defined on the @/lib/theme mock", from the shared PlanUpsellModal change in the WIP commit)
- Team (`app/team.tsx`): in the web harness the member list shows "Couldn't load your team" in both fresh and demo states. This comes from the harness, not the product: `lib/api.ts` `rejectSellerPreviewApiRequest` returns 403 for every API call in seller preview mode, even though `/team/members` and `/team/activity` are seeded in demo-data. The demo fixture's activity rows also use `message`, but the real API (`team_activity_logs.action`) uses `action`, so `log.action` is correct. Member rows have no swipe actions or "..." menu. Role change and remove are on the member detail screen (`/users?id=`, users.tsx:83/109), which a row tap opens, so nothing is missing.
- Invite (`app/team-invite.tsx`): with no token the harness shows "missing its token". With `?token=…` it shows "invalid or has expired", because the seller preview rejects all API calls. That is a harness artifact. I reviewed the main, accepted and expired states in code.
