# Screen audit 10/10 — Onboarding, auth, legal, deep links, edge screens

Scope: every onboarding step a person sees, sign-in, forgot password, the
invite-only access gate, legal pages, deep-link landing routes (`invite/`,
`u/`, `p/`, `store/`), not-found / error / boot screens, the integrations
connect screens and the seller setup checklist. Routes live in
`artifacts/mobile/app`.

How this was checked: every file below was read, and every screen was rendered
in the exported web preview build (`scripts/store-screenshots/harness.mjs`
`buildPreviewWeb`, 390×844) — the onboarding flow end to end for both buyer and
seller with the real `app/onboarding.tsx` (mocked Clerk + API from
`scripts/onboarding-walkthrough/`), signed-out guest pages with the signed-out
stub, and signed-in pages with `?bt_preview=buyer|seller`. `?bt_preview=guest`
is not a mode in this build, so the signed-out stub stood in for guests;
`tips=1` does not change any screen in this area. Fixes were rendered again
after the change.

`[FIXED]` = fixed in this PR. Everything without the prefix is a real defect
left for a follow-up (it needs a product/legal decision, touches shared
components or behaviour outside this area, or is pinned by an existing test).

---

**Splash** (`app/splash.tsx`)
- [FIXED] The logo had no accessibility element at all, so a screen reader announced nothing for 2.5 s. It's now one image labelled "Brandthread".

**Boot screen** (`components/BootScreen.tsx`, also rendered by `app/index.tsx`)
- [FIXED] Screen readers got no hint that the app was loading. The view is now an accessible progress element labelled "Loading Brandthread".

**Sign-in service timeout** (`components/ClerkBootGate.tsx`, shown after 12 s without Clerk)
- [FIXED] The title and body used a bare `fontWeight` with no family, so they fell back to the system font instead of Inter. They now use Inter Bold and Regular.

**Sign-in service failed to load** (`components/ClerkLoadErrorBoundary.tsx`)
- [FIXED] The title, body and button label used `fontWeight` with no family, which is off the Inter type system. They now use Inter.
- [FIXED] The Retry button had no accessibility label beyond its glyph text. It's now labelled "Retry connecting".

**Crash fallback** (`components/ErrorFallback.tsx`)
- "Try again" calls `reloadAppAsync()`, so it restarts the whole app rather than retrying the screen. The label promises less disruption than it delivers. Not fixed (behaviour).

**Onboarding — Welcome** (`components/onboarding/WelcomeStep.tsx`, step 0)
- Arriving from an invite link (`/invite/CODE` forwards to `/onboarding?referralCode=CODE`) gives no sign that the invite was recognised. The code is applied silently, deep in the sign-up form. Not fixed (needs new UI).
- The white primary pill's label gets `getOnAccentTextStyle`'s dark text-shadow, which reads as a blurred halo around "Get started". The style is shared app-wide, so it's not fixed here.

**Onboarding — Account type** (`app/account-type.tsx` `AccountTypeStep`, step 1)
- There's no back control, so after "Get started" a person can't get back to Welcome's "I already have an account" or "Browse as a guest" (native has `gestureEnabled: false`). Not fixed: `tests/onboarding-visual-structure.test.ts` pins `{!isAccountTypeStep && (`.
- Seller card bullets in the 46% columns wrap to three lines ("Global / manufacturer / network") and look ragged next to the two-line buyer bullets.
- The "Explore" / "Create" kicker plus the "I'm here to shop" title plus the description say the same thing three times. A copy trim is needed.

**Onboarding — Create account** (`app/onboarding.tsx` `SharedAuthStep` form, step 2)
- [FIXED] Buyers saw "Build your brand on Brandthread." under "Create your account", which is seller copy. The subtitle now depends on the path ("Discover brands and shop the drops you love." for buyers).
- [FIXED] Buyers also got the seller email placeholder `brand@yourstudio.co`. It's now `you@example.com` for buyers.
- [FIXED] The divider between Confirm password and Username was two hairlines with an empty gap where an "or" label would sit, so it looked like a broken line. It's now one hairline.
- [FIXED] Submitting without the consent box showed the error twice: "Please agree to continue." under the checkbox and a red banner repeating the same thing. Only the checkbox's own error remains.
- [FIXED] Unexpected errors fell through to the raw exception text (for example "Cannot read properties of null…"). Only Clerk's own error copy is shown now; anything else gets "Something went wrong. Please try again."
- The legal agreement is stated twice in a row: the consent checkbox, then "By continuing you agree to our Terms, Privacy Policy and Community Guidelines". Not fixed (legal copy).
- The first name typed here isn't carried to the Name step after email verification on web (the `postAuth` reload drops in-memory state), so the person types it twice. The username has the same problem: `scripts/onboarding-walkthrough/capture.mjs` notes it's empty at final save. Not fixed (state persistence).

**Onboarding — Verify email** (`SharedAuthStep` verify phase)
- [FIXED] "Resend" fired `sendEmailCode()` with no feedback and no error handling: nothing visible happened, and a failure was an unhandled rejection. It now shows "Sending…", then "New code sent to …" or the mapped error. It's disabled while sending and has a button role and label.
- [FIXED] The inline error under the code cells wasn't announced. It's now a polite live region.
- The header back arrow goes to Account type and silently abandons the pending verification. There's also no "wrong email?" way to edit the address.

**Onboarding — Account exists** (`SharedAuthStep` existing-account phase; reviewed in code, the mocked Clerk can't produce it)
- "Sign in" uses `router.replace('/sign-in')` without the email, so the person re-types the address the screen just showed them.
- "Your onboarding answers are saved." overstates it. At this point the only answer is the buyer/seller choice, and the draft keyed by Clerk user id doesn't exist yet.

**Onboarding — Already signed in** (`SharedAuthStep` signed-in guard; reviewed in code)
- [FIXED] "Continue with current account →" used a literal arrow character in a ghost pill. That was inconsistent with every other CTA, and screen readers read it as "right arrow". The arrow is gone.
- The body repeats the email in a sentence and adds a "\n\n" paragraph, so it's long for a two-button screen.

**Onboarding — Name** (step 3, buyer and seller)
- [FIXED] The sign-up form accepted a one-letter first name (with a check mark), but this step needed two letters and gave no reason for the disabled Continue. Both now accept one or more letters.
- The step asks again for the first name already collected on the sign-up form (see Create account).

**Onboarding — Username / Photo** (brief items)
- There's no separate Username step: the username is a field on Create account (see the loss-on-verify defect there). There's no Photo step anywhere in this build, so nothing was rendered for either.

**Onboarding — Style** (buyer step 4)
- Three interests (Basics, Minimal, Sustainable fashion) are preselected, so the footer always says "Continue" and never offers the "Skip for now" that the subtitle mentions. Not fixed: the defaults are pinned by `app/onboarding.ux.test.ts`.
- The "Minimal" chip's ◻️ emoji renders as a plain white box that reads like a missing-glyph tofu square.

**Onboarding — Sizes** (`components/onboarding/SizesStep.tsx`, buyer step 5)
- [FIXED] "We will show the size that fits when you shop. Skip it and add sizes later." was stiff and clipped. It now reads "We'll show the size that fits as you shop. You can skip this and add sizes later."
- [FIXED] The three-column size grid stopped about 4 pt short of the right gutter (cells were 31.5% plus gaps), so the right edge didn't line up with the headline. Cells now spread across the full row.

**Onboarding — Brands to follow** (`components/onboarding/BrandsToFollowStep.tsx`, buyer step 6)
- [FIXED] The empty state read "No brands to show yet — check back soon." on a step the person is about to leave. It now reads "No brands to follow yet. You can find brands anytime in Discover."
- [FIXED] "Follow all" stayed tappable after everything was followed, had no accessibility label beyond its count text, and its target was 40 pt high. It's now disabled when there's nothing left, labelled "Follow all brands", and 44 pt high.
- Failed follows in "Follow all" revert silently with no message.

**Onboarding — Brand name** (seller step 4)
- [FIXED] "Use your current name, a working name, or change it later." was a garbled three-way list. It now reads "Use your brand's name or a working title. You can change it later."

**Onboarding — Brand stage** (seller step 5)
- Clean (rendered: four radio rows, preselected "Just an idea", footer Continue).

**Onboarding — Goals** (seller step 6)
- [FIXED] The multi-select goal chips were exposed as radio buttons with `selected`, so a screen reader implied only one could be picked. They're now checkboxes with `checked`. The single-select logo-style chips are still radios.
- "Build my workspace" sits inline under the chips in mid-screen, unlike the pinned footer CTA on every other step. Not fixed (layout).

**Onboarding — Storefront accent + AI sample** (`SellerPreviewStep`, seller step 7a)
- [FIXED] The subtitle said "This calls the real generator.", which is internal or dev wording. It now reads "See your brand name as a logo."
- [FIXED] "Your real AI sample is ready." is now "Your AI sample is ready." (the test and walkthrough were updated).
- [FIXED] Theme names were cut to one line, so "Monochr…", "Black & Go…" and "Emerald & G…" were clipped. Names now wrap to two lines.
- [FIXED] The error "Retry" link had no role or label and only a text-sized target. It now has a button role, an "Retry AI sample" label and a 12 pt hit slop. The error text also had no Inter family and now uses Inter Regular.
- The zap icon in the sample header is bottom-aligned against a wrapped two-line caption and floats off the text.

**Onboarding — Plan** (`components/onboarding/SellerPlanRecommendationStep.tsx`, seller step 7b)
- [FIXED] The screen said "We recommend Growth" while Starter stayed selected, and the CTA read "Continue with Starter". The recommended plan is now preselected until the seller taps one.
- [FIXED] The reason copy was ungrammatical ("your goals around create designs and build content"). It now reads "…and want to create designs and build content…" (`lib/sellerPlans.ts`).
- [FIXED] Each card had `minHeight: 340` from the old horizontal row. Stacked vertically, that left a large empty block in the Starter and Pro cards. It's removed.
- [FIXED] Plan cards had no role or state and the CTA had no role. The walkthrough had to click it by text. Cards are now radios with a "Plan, price per month, recommended" label, and the CTA is a button.
- [FIXED] Hard-coded `#FFF` / `rgba(255,255,255,…)` text colours are now theme tokens (`text`, `muted`, `subtle`, `border`).

**Onboarding — Setup loading** (`LoadingAnimation`, buyer step 7 / seller step 8)
- Clean (rendered: four staged rows and the thread progress, then it auto-advances).

**Onboarding — Notifications prompt** (`NotificationsStep`, buyer step 8 / seller step 9)
- [FIXED] The web copy "Browser notifications are not enabled here. You can turn on mobile alerts later from the Brandthread app." was clunky. It now reads "Alerts aren't available in the browser. Turn them on anytime in the Brandthread mobile app."
- "Continue" and "Not now" do exactly the same thing on every platform. Neither one requests permission, because permission is deliberately contextual (`lib/contextualPushPermission.ts`), yet the native copy ("Get drop alerts…") implies that Continue turns alerts on. Not fixed (product policy).
- On web the second button is pointless, since there's nothing to decline.

**Onboarding — Success** (`SuccessScreen`, last step)
- [FIXED] The seller list claimed "Your store is ready to launch" when no store has been built yet. It now reads "Storefront builder ready".
- The CTA case is inconsistent: "Go to Dashboard" (Title Case) vs. the buyer's "Start exploring". The walkthrough script and `setup.tsx` use the same string.
- For buyers, "Welcome to Brandthread." is followed immediately by the explainer's "Welcome to the Thread.", so two welcome headlines appear back to back.

**Thread explainer** (`app/thread-explainer.tsx`, the buyer's first screen after onboarding)
- [FIXED] The sticky CTA's gradient ran `'transparent' → background` over its whole height, so feature cards showed through under and below "Enter the Thread". It's now opaque from the button down (`locations={[0, 0.35]}` with a same-hue transparent stop).
- [FIXED] The CTA had no accessibility role. It's now a button labelled "Enter the Thread".

**Sign in — Email or phone** (`app/sign-in.tsx`, identifier step)
- [FIXED] Exceptions with no Clerk copy leaked raw JS text into the error box (rendered: "Cannot read properties of null (reading 'emailCode')"). These now get "Something went wrong. Please try again."
- [FIXED] Error boxes weren't announced. They're now `role="alert"` with a polite live region, across all four sign-in steps.
- When disabled, the primary "Send code" button renders as bare grey text with no fill, so it looks weaker than the outlined "Use password instead" below it. The disabled style belongs to the shared `components/ui/Button`, so it's not changed here.
- [FIXED] With phone sign-in available, the field still set `autoComplete="email"`. It's now `username` when phone is offered (and still `email` when it isn't).

**Sign in — Password** (password step)
- [FIXED] The "Forgot password?" link sat about 12 pt above the "Password" label: the link's 44 pt pressable top-aligned its text while the label kept its bottom margin. Both are now centred on the row.
- [FIXED] The "Use a one-time code instead" link had no button role. It has one now.
- "Incorrect email or password." is shown even when the identifier was a phone number.

**Sign in — One-time code** (code step; reviewed in code, the mocked Clerk can't send codes)
- [FIXED] "Resend code" had no role or disabled state while its cooldown ran. It now has a button role with `disabled` during the countdown.
- [FIXED] The countdown was hard-formatted as `0:SS`, which only worked because the cooldown is 30 s (a 60 s or longer cooldown would read "0:75"). It's now real `m:ss`.

**Sign in — Two-factor** (TOTP / backup code step; reviewed in code)
- [FIXED] The placeholder stayed "000000" in backup-code mode, where codes are alphanumeric. It's now "Backup code" in that mode.
- [FIXED] The visible label "Code" and the accessibility label "Verification code" didn't match. Both now say "Authentication code" (or "Backup code").

**Sign in — Already signed in** (signed-in branch)
- [FIXED] The subtitle repeated the email that the account card directly below already shows. It now reads "Continue with this account, or sign out to use a different one."

**Forgot password — Email** (`app/forgot-password.tsx`, email step)
- [FIXED] The copy promised "a secure reset link", but the flow sends a 6-digit code. It now says "a reset code".
- [FIXED] The primary, secondary and back controls had no button roles or states. They now have roles, plus `disabled`/`busy` state on the primary button.
- [FIXED] The back target was 40 × 40 (under 44). It's now 44 × 44.
- The layout drifts from its sibling Sign-in screen (back-arrow x position, logo row offset, filled-grey disabled button vs. Sign-in's text-only one).

**Forgot password — Code + new password** (code step)
- [FIXED] "Reset password" was enabled with a 3-character password while the hint said "Use at least 8 characters", and with a partial code. It's now enabled only with a 6-digit code and 8 or more characters.
- [FIXED] The code field accepted non-digits on paste. Input is now digits only.
- [FIXED] "Resend code" gave no confirmation. It now shows "New code sent to …" as a polite live region and has a button role.
- [FIXED] Error boxes weren't announced. They're now alerts with a live region. A non-API exception no longer surfaces raw exception text.

**Forgot password — Done** (done step)
- [FIXED] The success card used a green tint, a green tile and a green glow, which is off the black/white/silver palette. It's now neutral: card fill, border, a white tile with a black check, and a soft white glow.

**Access gate** (`app/access-code.tsx`)
- [FIXED] "Enter your invite code" appeared with no explanation of why the person was stopped. It now adds "Brandthread is invite-only right now. Enter the code you were sent, or join the waitlist." The waitlist mode adds "We'll email you as soon as a spot opens up."
- [FIXED] The side gutter was 16 pt, against 24 pt on every other auth screen. It's now 24 pt.
- The input is a full pill while both buttons are rounded rectangles in the same stack (mixed radii).
- [FIXED] The header title "Access" was vague. It's now "Invite code".

**Account type route** (`app/account-type.tsx` default export)
- Clean (rendered: it redirects straight to `/onboarding`).

**Legal — Privacy Policy** (`app/privacy.tsx`, shared `components/legal/LegalDocument.tsx`)
- The 3-pill switcher order (Terms · Guidelines · Privacy) differs from the 5-pill order on the seller pages (Terms · Privacy · Refunds · Sellers · Guidelines). Not fixed: both orders live in `content/legal.ts`, which is legal-owned.
- `privacy@brandthread.app` in the last section is plain text, not a mail link.
- [FIXED] The `brandMarkText` style was defined but unused (dead code). It's removed.

**Legal — Terms / Community Guidelines** (`app/terms.tsx`, `app/community-guidelines.tsx`)
- Same shared switcher-order defect as Privacy. Otherwise rendered clean.

**Legal — Seller Agreement / Refund Policy** (`app/seller-agreement.tsx`, `app/refund-policy.tsx`)
- The scrollable switcher cuts its own rounded border at the screen edge ("Guide…" plus a cut border), so it reads as clipped rather than scrollable.

**Invite link** (`app/invite/[code].tsx`)
- [FIXED] Signed-in members landed on a centred message with no header and no back control, so the only way out was "Share your invite", which also used `replace`. It now has a "Invite" header with a back control that falls back to `/`.
- [FIXED] "Share yours and you both get $10 Thread Cash." contradicted the referral policy: the inviter only earns after the friend's first order. It now uses `REFERRAL_SUBHEAD` from `lib/referralCopy.ts`.
- [FIXED] The loading spinner had no accessibility label. It's now "Opening invite".
- [FIXED] The "Share your invite" button's `alignSelf: 'stretch'` was ignored by `PrimaryButton`'s outer pressable, so it rendered as a narrow chip. The stretch now sits on a wrapper.

**Public profile link** (`app/u/[username].tsx`)
- [FIXED] The signed-out landing's `ScrollView` was `accessible`, which collapses the whole page, including the Join and Sign in buttons, into a single screen-reader element on iOS. That prop is removed.
- [FIXED] The loading skeleton's root was one `accessible` element, which also swallowed the header back button. The label moved to a polite live "Loading profile…" text.
- [FIXED] The signed-out landing's "Join Brandthread" / "Sign in" buttons rendered as cramped, unpadded chips instead of full-width buttons (rendered with a mocked public profile). `PressableScale`'s outer `Pressable` shrink-wrapped under `alignItems: 'center'`. The CTA block now stretches.
- The verified badge and "Verified" text use the `success` green (`#7FF0B0`), which is the only colour on the page outside black/white/silver.
- The signed-out landing has no back or close control, only the logo row.
- [FIXED] Unused `header` and `backBtn` styles (dead code) are removed.

**Post link** (`app/p/[postId].tsx`)
- Clean (rendered: it forwards to `/buyer-post-viewer?postId=`. The viewer itself belongs to another squad).

**Store link** (`app/store/[handle].tsx`)
- Clean (rendered: `/store/noirfield` forwards to `/u/noirfield`).

**Product link** (`app/store/product/[productId].tsx`, `lib/shareLinks.ts`)
- [FIXED] Shared product links opened `/product-detail?id=`, which is the seller's 8-tab product-management screen. Guests couldn't open it at all and were bounced to onboarding (rendered). Both the route and `parseShareLink` now go to the shopper page, `/buyer-product-detail?productId=`.

**Not found** (`app/+not-found.tsx`)
- [FIXED] "Go home" went back whenever there was history, so it behaved exactly like the header arrow. Now the arrow goes back and the button always goes to `/`.
- [FIXED] The icon ring used an ad-hoc `accent + '40'` border. It now uses the `border` token.
- Signed-out visitors never see this screen: AuthGate sends any unknown route to `/onboarding` (rendered `/this-route-does-not-exist-xyz` → Welcome). Not fixed (AuthGate in `_layout.tsx`).

**Force-update gate**
- There's no force-update or minimum-version gate in this build (searched `app/`, `components/` and `lib/` for update-required, min-version and `expo-updates` gating). Nothing to render.

**Integrations** (`app/integrations/index.tsx`)
- [FIXED] Row icons were hard-coded `#FFFFFF`. They now use the `foreground` token.
- [FIXED] Rows had no role or label. They're now buttons labelled "Klaviyo, connected" / "Stripe, not connected", with hints.
- [FIXED] The footer counted every key the server returned, so it could say "3 of 2 integrations connected" (a Shopify import key, for example). It now counts only the listed integrations.
- [FIXED] Retry was about 33 pt high with no role or label. It's now 44 pt, a button, labelled "Retry loading integrations".
- The More tab's "Integrations" row opens `/integrations/klaviyo` rather than this hub (`app/(tabs)/more.tsx`, which is outside this area).
- [FIXED] Error alerts were titled just "Error". They now name what failed ("Couldn't open Stripe", "Couldn't connect Klaviyo", …).

**Klaviyo** (`app/integrations/klaviyo.tsx`)
- [FIXED] The screen root was `transparent`. It's now the `background` token.
- [FIXED] Disconnect had no error handling: a failure was an unhandled rejection with no message. It now shows "Couldn't disconnect".
- [FIXED] A rejected key was detected only by string-matching "401" in the message. It now also checks `ApiError` status 400/401.
- [FIXED] The API-key field, Connect, Sync, Disconnect and help link had no labels or roles. All five now have them, and the help link's `openURL` rejection is caught.
- [FIXED] "Klaviyo: Email Marketing & SMS" was Title Case with a colon. It now reads "Klaviyo email & SMS marketing" and is marked as a header.
- [FIXED] The hero used a zap icon for an email/SMS integration, while the hub row uses mail. It's now mail.

**Shopify fulfillment** (`app/integrations/shopify-fulfillment.tsx`)
- [FIXED] The Shopify-green icon tile (`#95BF4722` / `#5E8E3E`) was off the black/white/silver palette. It now uses the same `primary` tint as the card below it.
- [FIXED] Both the loading and loaded roots had no background. They're now the `background` token.
- [FIXED] The toggle, domain field and Disconnect had no labels or roles. They have them now, and the domain field uses the URL keyboard.
- [FIXED] Failure alerts showed raw `err.message`. They now show "Check your connection and try again."
- [FIXED] Disconnect had no error handling. It now shows "Couldn't disconnect".
- The footnote is set in italic `Inter_400Regular` (synthetic italic; no Inter italic face is loaded).

**Store setup checklist** (`app/setup.tsx`)
- [FIXED] Task descriptions were cut to one line ("Finish seller signup and onboarding to open your wo…", "Verify a custom domain you already own fro…"). They now wrap to two lines.
- [FIXED] Card, label, description and skip colours came from static dark-only constants in `lib/theme` (`CARD`, `BORDER`, `FG`, `MUTED`, `SUBTLE`). They now come from the theme `colors`.
- [FIXED] The check circle and "Skip" had no role or label. They're now a checkbox ("Mark … complete") and a button ("Skip …"), with larger hit slop.
- [FIXED] The exclamation-heavy copy ("you're ready to go!", "Your store is ready!") is now calm statements.
- Tapping a task opens a 3-button `Alert` (Open / Mark complete / Cancel) for what should be a plain navigation.

---

Counts: 49 entries (47 screens or steps, plus the two brief items that don't exist: the Username/Photo steps and the force-update gate) · 122 fixable findings · 86 fixed in this PR · 36 left open (listed above without the prefix) · 5 entries rendered clean.
