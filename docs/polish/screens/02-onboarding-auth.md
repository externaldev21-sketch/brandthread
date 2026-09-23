# Onboarding, auth & legal

[← Back to the punch list](../punch-list.md) · [Design rules](../design-rules.md)

**12 P0 · 65 P1 · 27 P2.** Rows are sorted P0 → P1 → P2 inside each screen. Line numbers are from `dev` @ `7e0f547` and will drift as other branches land. Search for the quoted code if a line has moved.


Auditor slice: onboarding, sign-in, forgot-password, account-type(-settings), account-switcher, biometric-unlock, login-methods, setup, thread-explainer, privacy, terms, languages, help, share-profile, navigation-isolation-probe. For context I also read `components/onboarding/SellerPlanRecommendationStep.tsx` and `components/legal/LegalDocument.tsx`, which renders the legal pages, plus the related parts of `app/_layout.tsx` and `lib/devBypass.ts`.

**The four worst problems.** None of them is cosmetic. Each one breaks a flow.
1. New buyers get stuck in a redirect loop between `/thread-explainer` and `/onboarding`, because the two files use different storage keys.
2. Password reset calls a Clerk method that doesn't exist, so it throws a raw JS error.
3. Entering a wrong email-verification code does nothing: no error appears.
4. Turning on 2FA stops the user from signing in with email again, because sign-in has no second-factor step.

---

### Onboarding (first-run flow) — `app/onboarding.tsx`

**Flow, auth and correctness**

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Copy | The divider labelled "optional" sits above the @username field, but the username is **required**: `canSubmit` needs `isUsernameValid`. A user who skips it gets a Create account button that stays grey and no reason why. | onboarding.tsx:1499 (divider), 1205 (canSubmit) | Move username up under email and label it "Username". Put the divider directly above Referral code only. Show an inline hint under the disabled button that lists what's missing ("Add a username to continue"). |
| P0 | Copy | Wrong verification code: `verifyEmailCode` returns `{ error }` and never throws (Clerk "future" API). The code ignores the result, so the spinner stops and nothing happens. There's no error message. | onboarding.tsx:1273–1274 | `const { error } = await signUp.verifications.verifyEmailCode({ code }); if (error) { setError(mapClerkError(error)); return; }`. Copy: "That code isn't right. Check your email and try again." |
| P1 | Copy | The same ignore-the-result bug hits `sendEmailCode()`. If sending fails, the user still moves to "Check your email" and waits for a code that never comes. | onboarding.tsx:1253 | Check `{ error }`, stay on the form and show "Couldn't send your code. Try again." |
| P1 | Motion | Resend does nothing visible: no loading state, no cooldown, no confirmation, no error handling, and an unhandled promise. Users hammer it. | onboarding.tsx:1394–1396 | Add a 30 s cooldown that reads "Resend in 0:27", a spinner, and a toast "New code sent". On failure, show "Couldn't resend. Try again in a moment." |
| P1 | A11y | The OTP input has no `textContentType="oneTimeCode"` / `autoComplete="one-time-code"` and accepts non-digits from paste. It doesn't auto-submit at 6 digits. Apple and Instagram autofill the code from Mail or Messages. | onboarding.tsx:1381–1390 | Add `textContentType="oneTimeCode" autoComplete="one-time-code"`. Strip non-digits in `onChangeText` and call `handleVerify()` when length hits 6. |
| P1 | Copy | Buyers see seller copy on their account form. Both flows render `SharedAuthStep`; `BuyerAuthStep` is dead code. So buyers read "Build your brand on Brandthread.", placeholder "brand@yourstudio.co" and "e.g. noire_collective". | onboarding.tsx:1407, 1414, 1509; used at 2437 | Pass `flow` into SharedAuthStep. Buyer: "Shop independent brands first." with placeholder "you@email.com". Seller: "Build your brand on Brandthread." Username placeholder: "e.g. alex.style". |
| P1 | Consistency | There's no way back to sign-in from onboarding. The "Already have an account? Sign in" link lives only in the dead `BuyerAuthStep` (1140). Step 0 has no back button, the route has `gestureEnabled:false`, and sign-in arrives via `router.replace`. A user who tapped "Create an account" by mistake is trapped. | onboarding.tsx:2746 (no back on step 0), 1588 (no sign-in link in SharedAuthStep) | Add a "Have an account? Sign in" text link under the Account type Continue button and under the auth form's legal line, routing `router.replace('/sign-in')`. |
| P1 | Motion | On Android the hardware back button pops the whole onboarding route or exits the app instead of going back one step. There's no `BackHandler`. | onboarding.tsx:2175–2179 | Register a `BackHandler` that calls `goBack()` when `step > 0` and returns true. |
| P1 | Copy | Going back from the Name step lands on "Already signed in" → "Sign out and create another account". That button is wired to `devReset`, which wipes `splash_seen` and routes to `/splash`, so real users see a dev reset path. | onboarding.tsx:1321–1339, 2362–2371, 2442 | Skip the Auth step on back once signed in (go to Account type). Rename `onDevClear` and don't clear `splash_seen`. Copy: headline "You're signed in", primary "Continue", secondary "Use a different account". |
| P1 | Copy | The OAuth "one more step" state is a dead end: "Google sign-in needs one more step. Please try again." Retrying hits the same state again. | onboarding.tsx:1310 | Handle `result.signUp` missing fields (e.g. username) inline. Otherwise say "We need a bit more info. Continue with email instead." |
| P1 | Copy | The `mapClerkError` fallback shows raw vendor messages (`inner?.message`). The config error reads "Authentication configuration error. Please contact support." Many strings pad with "Please". | onboarding.tsx:309, 290, 265, 282, 286 | Fallback: "Couldn't create your account. Try again." Config error: "Sign-up is unavailable right now. Try again later." Code error: "That code isn't right. Check your email and try again." Rate limit: "Too many tries. Wait a minute, then try again." |
| P1 | Copy | Email signups type their first and last name on the auth form, then get asked "What should we call you?" again on the next step. OAuth users aren't prefilled from Clerk `user.firstName`. | onboarding.tsx:1425–1450 vs 2463–2485 | Drop first/last name from the auth form and keep the Name step. Prefill it from `user?.firstName` after OAuth. |
| P1 | Copy | The auth form is 7 fields long, with a Confirm password field and a divider. Instagram and Apple ask for 2–3 fields per screen. | onboarding.tsx:1409–1549 | Keep email and password (with the show toggle, dropping Confirm) and put username on its own step. Move Referral code behind a "Have a referral code?" link. |

**Keyboard, progress and motion**

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P1 | Visual | The keyboard hides the footer **Continue** button on the Name and Brand name steps. `KeyboardAvoidingView` wraps only the step content, and the footer is a sibling outside it. Neither input has `returnKeyType`/`onSubmitEditing`, so the user must dismiss the keyboard to continue. | onboarding.tsx:2464, 2583 (KAV), 2807–2815 (footer outside) | Wrap the step and footer in one KAV at the screen root, or render the footer inside the KAV. Add `returnKeyType="next" onSubmitEditing={() => canContinue() && goNext()}`. |
| P1 | A11y | The auth form has no return-key chaining: none of the 7 inputs sets `returnKeyType` or moves focus to the next field. Email has no `autoCorrect={false}`. | onboarding.tsx:1412–1547 | Add refs, `returnKeyType="next"` and `blurOnSubmit={false}`. The last field gets `returnKeyType="go"` → `handleSignUp`. |
| P1 | Motion | Double-tapping Continue skips a step. The footer button persists across steps and `goNext()` has no in-flight guard, so a fast double tap on Name jumps past Style. | onboarding.tsx:2169–2173, 2811 | Ignore taps while `transitionProgress` is animating (a ref flag cleared in `.start()` callback), or disable the footer for 250 ms. |
| P1 | Motion | Progress dots jump on step 0. With no selection `total` is 10; tapping Buyer re-renders 7 dots, so the header visibly reflows. Loading, Notifications and Success count as "steps", and seller shows 10 dots. | onboarding.tsx:2400–2404, 2756–2760 | Hide the dots on Account type. Use a thin continuous progress bar over the input steps only (buyer 3, seller 6). |
| P1 | Motion | The loading screen is fake: 700 ms per label and 2.8–3.2 s of theatre ("Curating your Thread"). Then the real save happens later behind "Saving…" on Success, so the user waits twice. Its width uses `useNativeDriver:false`. Inner `setTimeout`s are never cleared, so state updates after unmount. | onboarding.tsx:467–493 (475, 482) | Run `finishBuyer`/`finishSeller` during this screen and advance when it resolves, with a ~1.2 s minimum. Animate `scaleX` with the native driver. Track the inner timers. |
| P1 | Copy | The Notifications step is a no-op. "Continue" and "Not now" both just move to Success, and push permission is never requested. The screen promises "Never miss what matters." | onboarding.tsx:2513–2517, 2693–2697, 614–623 | Wire `onEnable` to request permission and then `registerGrantedPushToken`. Label the button "Turn on notifications". |
| P1 | Consistency | Legal links open Safari (`Linking.openURL('https://brandthread.app/terms')`) even though in-app `/terms` and `/privacy` exist. The tap targets are 12 pt inline text. | onboarding.tsx:1588–1593 | `router.push('/terms')` / `router.push('/privacy')`. Raise legal text to 13 pt. |
| P1 | Copy | Style and Goals steps come with 3 choices pre-selected (`DEFAULT_BUYER_INTERESTS`, `DEFAULT_SELLER_GOALS`), yet the copy says "Pick a few… You can skip this". So "Skip for now" never appears. | onboarding.tsx:117–118, 1946, 1951, 2491 | Start with `[]`. The button reads "Skip for now" until the user picks something, then "Continue". |
| P1 | Consistency | Goals uses a bespoke inline gradient button placed inside the scroll content, not the fixed footer every other step uses. There's no disabled state. "Build my workspace" actually just opens the plan step. | onboarding.tsx:2641–2654, 2720 | Use the shared footer with the label "Continue" (or "Skip for now" when nothing is selected). |
| P1 | Copy | The seller preview step shows dev copy: "This calls the real generator." and "Your real AI sample is ready.". Raw `error.message` ("The AI service returned no image.") is shown. | onboarding.tsx:1796, 1811, 1749–1752 | "See your brand name as a logo." / "Your logo sample is ready." / error "Couldn't make your sample. Try again." |
| P1 | Theme | The seller preview uses a hard-coded light card `#F7F7F7`, a caption at `rgba(0,0,0,0.86)`, and a green Continue with `#06110B` text on every theme. The green CTA clashes with the theme gradient used on every other step. | onboarding.tsx:1865, 1867, 1874, 1876 | Use `theme.card` and `theme.primaryGradient`/`theme.onAccent`, matching `PrimaryButton`. |
| P1 | Copy | Setup failure uses a blocking `Alert` with **only** "Retry" and no Cancel. Offline, the user loops forever. The body says "Please try again." | onboarding.tsx:2294–2301, 2353–2357 | Show an inline error under the CTA: "Couldn't save your profile. Check your connection and try again." Keep the CTA as "Try again". |
| P2 | Copy | Success: "Go to Dashboard" (title case). The seller bullets overclaim: "Manufacturer network unlocked", "Analytics dashboard activated". `firstName` is passed in but never used. | onboarding.tsx:677, 707, 693 | "Go to dashboard". Headline "Welcome, {firstName}." Bullets: "Design studio", "Manufacturer network", "Your storefront", "Analytics". |
| P2 | Copy | "Account exists." / "Sign in to continue your Brandthread journey." / "Your onboarding answers are saved." (nothing has been answered yet at this point). | onboarding.tsx:1350, 1356–1357 | "You already have an account" / "Sign in with {email} to pick up where you left off." |
| P2 | Theme | The Apple button text is a hard-coded `'#FFFFFF'`, the disabled button is `rgba(255,255,255,0.06)` and the loading bar track is `rgba(255,255,255,0.08)`. | onboarding.tsx:1583, 451, 555 | Use `theme.text`, `theme.surface` and `theme.borderSubtle`. |
| P2 | Visual | Outline weights are mixed: inputs use hairline, password rows use `borderWidth: 1`, and selected chips use 1.5. Password and email fields look different side by side. | onboarding.tsx:1674 vs 1676, 363 | One input style: 1 px `theme.border`, 12 radius. |
| P2 | A11y | The header back chevron has no `accessibilityLabel` and sits in a 32×32 box. Eye toggles have no labels. Multi-select goal `Chip` uses `accessibilityRole="radio"`. | onboarding.tsx:2747–2753, 1465, 1487, 387 | `accessibilityLabel="Back"` in a 44×44 box. `"Show password"`/`"Hide password"`. `role="checkbox"` for goals. |
| P2 | Perf | Every render rebuilds StyleSheets: `Object.assign(sm, createSm(theme))` runs on each keystroke, `createSsc(theme)` runs 3× per chip, and module-level `let CARD/FG…` are mutated during render. The file is 2,863 lines, with a dead `BuyerAuthStep` (lines 739–1153, 1600–1663). | onboarding.tsx:1884–1892, 370–372 | Memoise styles by `theme.id`, delete `BuyerAuthStep` and `createSba`, and split steps into `components/onboarding/*`. |

**Social sign-in buttons (Apple HIG)**

| Pri | Area | Issue | Where | Fix |
|---|---|---|---|---|
| P1 | Consistency | The Apple button in the live form is styled like Google (`backgroundColor: CARD`), so it renders purple, olive or maroon on those themes. HIG requires a black, white or white-outline Apple button. It sits below both Create account and Google. `expo-apple-authentication` is already installed but unused. | onboarding.tsx:1574–1586, 1687 | Use `<AppleAuthentication.AppleAuthenticationButton buttonType=CONTINUE buttonStyle=WHITE cornerRadius={14}>`. Place it **first**, above Google, with the same height. |
| P1 | Visual | Fake Google mark: a letter "G" in Inter on a `CARD` circle (and on a `#4285F4` circle in dead code). Google's brand rules require the official multicolour "G". | onboarding.tsx:1569 | Ship the official Google "G" SVG asset. |

---

### Sign in — `app/sign-in.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Visual | The Apple button has **no Apple logo**. The glyph `<Text>` is empty (the Unicode `` was stripped), so an empty 18 pt node plus `gap:10` pushes "Continue with Apple" off-centre. This is an App Review/HIG risk. | sign-in.tsx:285 | Use `AppleAuthenticationButton`, or `<Ionicons name="logo-apple" size={20} color="#FFF" />`. |
| P0 | Copy | Accounts with 2FA can't sign in. Nothing handles `signIn.status === 'needs_second_factor'`: after a correct password the spinner stops and nothing happens. login-methods.tsx lets users turn TOTP on. | sign-in.tsx:73–86 | Add a TOTP step ("Enter the 6-digit code from your authenticator app") via `signIn.mfa.verifyTOTP`. Show an error for any other non-complete status. |
| P1 | Copy | Raw Clerk messages leak through the `mapError` fallback. "Please wait a moment." pads the rate-limit copy. | sign-in.tsx:410, 397 | Fallback: "Couldn't sign you in. Try again." Rate limit: "Too many tries. Wait a minute, then try again." |
| P1 | Copy | A new user who picks Google or Apple here is sent to `/onboarding` step 0, which asks them to sign up **again** with OAuth. | sign-in.tsx:119–122 | Pass `?postAuth=1` and complete the pending SSO sign-up, or show "No account found for that Google account. Create one?" |
| P1 | Consistency | Back arrow calls `router.back()`, but sign-in is usually reached via `router.replace` from AuthGate or splash, so the button does nothing. | sign-in.tsx:231–239 | Render it only when `router.canGoBack()`. |
| P1 | A11y | No `returnKeyType`/`onSubmitEditing`: Return on the password field doesn't sign in. Email has no `autoCorrect={false}`. | sign-in.tsx:302–331 | Email: `returnKeyType="next"` → focus password. Password: `returnKeyType="go" onSubmitEditing={handleSignIn}`. |
| P1 | Visual | The Google mark is a fake "G" in a blue circle. Apple sits second after Google. | sign-in.tsx:267, 274 | Official Google asset. Put Apple first. |
| P2 | Consistency | Different button language from onboarding. Primary is `[accent, secondary]` with `opacity 0.5` when disabled, while onboarding uses `primaryGradient` with a grey disabled fill. OAuth buttons use `cardGlass` and a 1 px border here but `card` and a hairline in onboarding. The error is a boxed banner here and plain text in onboarding. | sign-in.tsx:348, 356, 435, 466 | Use the shared `PrimaryButton`/`SecondaryButton` and one `InlineFeedback` error box across auth. |
| P2 | A11y | "Forgot password?" is 12 pt with no hitSlop. The eye toggle has no label. | sign-in.tsx:318–320, 332 | `hitSlop={12}`, 13 pt. `accessibilityLabel="Show password"`. |

### Forgot password — `app/forgot-password.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Copy | **Reset is broken.** The legacy API is cast with `as any` onto the new `SignInFuture`. `create({strategy:'reset_password_email_code'})` returns `{error}` (the code never checks it), so the screen always advances. `attemptFirstFactor` doesn't exist, so it throws a TypeError, and `mapError` then shows the raw "…attemptFirstFactor is not a function". | forgot-password.tsx:46–50, 65–70, 330 | Use `signIn.create({ identifier })` → `signIn.resetPasswordEmailCode.sendCode()` → `.verifyCode({ code })` → `.submitPassword({ password })`, checking `{error}` at each step. |
| P1 | Copy | The copy promises a "secure reset link", but the flow sends a 6-digit code. | forgot-password.tsx:116 | "Enter your email and we'll send you a 6-digit code." |
| P1 | Copy | "Your password has been reset successfully." ("successfully" is banned). The fallback error is raw. | forgot-password.tsx:272, 330 | "Password updated. Sign in with your new one." / "Couldn't reset your password. Try again." |
| P1 | Motion | Resend has no cooldown or confirmation, and code entry has no `oneTimeCode` autofill. | forgot-password.tsx:237–247, 179–188 | 30 s cooldown and a "New code sent" toast. Add `textContentType="oneTimeCode"`. |
| P2 | Copy | "Invalid code. Please check and try again." | forgot-password.tsx:309, 324 | "That code isn't right. Check your email and try again." |

### Account type (step 0) — `app/account-type.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P1 | Copy | No sign-in escape: the first screen new users see has no "Sign in" link (see the onboarding finding above). | account-type.tsx:161–192 | Under Continue: "Have an account? Sign in". |
| P2 | Copy | All-caps kickers "EXPLORE"/"CREATE" over "I'm here to shop". The headline "Are you a buyer or a seller?" is robotic. | account-type.tsx:75, 137 | Headline "How will you use Brandthread?" Drop the kickers. |
| P2 | Visual | Bullets are 13 pt `theme.subtle` with 10 pt check icons, which reads faint on purple and olive. The footer gradient overlays the second card's bullets on short phones. | account-type.tsx:149, 266, 162–165 | Bullets 14 pt `theme.muted`. Increase `paddingBottom`, or make the footer solid `theme.background`. |
| P2 | A11y | Cards have no `accessibilityRole="radio"` or `accessibilityState`. The label "Continue from account type" is robotic. | account-type.tsx:90–99, 168 | Add `role="radio"` and `state={{selected}}`. Label: "Continue". |

### Account type settings — `app/account-type-settings.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P1 | Copy | The success alert tells users to "Restart the app to apply all changes." That reads as a bug. | account-type-settings.tsx:85–88 | Apply the change live (update `user_role` and let AuthGate re-route) and show a toast: "You're now selling on Brandthread." / "You're now shopping on Brandthread." |
| P1 | Copy | "Current plan" labels an account type, not a plan. | account-type-settings.tsx:150 | "Current". |
| P1 | Theme | Static `BG/CARD/BORDER/FG/MUTED` everywhere and `root` is transparent, which ignores the runtime theme. | account-type-settings.tsx:15, 106, 194–221 | Use `useAppTheme().theme`. |
| P1 | Copy | A failed profile load is swallowed. Any non-buyer defaults to "seller". The user sees no selection and a dead "No changes" button. | account-type-settings.tsx:55, 59–61 | Show an error state: "Couldn't load your account type." with a [Try again] button. |
| P2 | Copy | Title case "Account Type"; "Error" / "Please try again." alert; "(orders, products, etc.)". | account-type-settings.tsx:108, 91, 186 | "Account type" / "Couldn't switch. Try again." / "Your orders and products stay safe." |
| P2 | Consistency | Icons disagree with onboarding: seller is a bag here but a star there, and buyer is a user here but a bag there. | account-type-settings.tsx:36, 44 vs account-type.tsx:21, 34 | Use the same icons as onboarding. |

### Accounts (switcher) — `app/account-switcher.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P1 | Theme | The whole screen uses static `BG/CARD/BORDER/FG/ACCENT/SURFACE`, plus `#10B981` for the active dot. It stays black on a purple or maroon theme. | account-switcher.tsx:22–25, 297, 405 | Use `useAppTheme().theme`, and `theme.success` for the dot. |
| P1 | Copy | A failed switch is silent: `catch { setSwitchingId(null) }`. | account-switcher.tsx:75–77 | Toast "Couldn't switch accounts. Try again." |
| P2 | Copy | "Start a new brand on Brandthread" appears under Create new account, but that flow also creates buyer accounts. | account-switcher.tsx:278 | "Shop or sell with a new account". |
| P2 | Visual | Names are 13 pt, emails and the "Current" badge 11 pt, and avatars use RN `Image`. The loading condition `!isLoaded && !authLoaded` should be `\|\|`. | account-switcher.tsx:412–440, 192, 96 | 15 / 13 / 12 pt. Use `expo-image`. Fix the condition. |

### Biometric unlock — `app/biometric-unlock.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Copy | **The feature is fake.** `bt:biometric:enabled` is written here and read nowhere else in the app, yet the UI promises "You'll be prompted when opening the app." | biometric-unlock.tsx:9, 82, 88, 126 | Implement an app-foreground lock gate that reads the key, or hide the setting until it exists. |
| P1 | Visual | A filler `<View style={{flex:1, backgroundColor: colors.secondary}}/>` paints a surface-coloured block over the rest of the screen, which shows as a visible band. | biometric-unlock.tsx:132 | Delete it. |
| P1 | Consistency | A success Alert ("Face ID enabled"), and the Switch still flicks when biometrics aren't supported before the "Not available" alert appears. | biometric-unlock.tsx:85–90, 53–60, 115–121 | Use a toast for success. Disable the Switch when `!supported` and show the sublabel "Set up Face ID in Settings to use this." |
| P2 | Copy | Header "Security" for a single toggle. "Iris Scan", "Face Recognition" casing. "No biometrics enrolled — set up in device Settings". | biometric-unlock.tsx:95, 35, 39, 111 | Header "Face ID" (dynamic). "Face unlock" / "Iris unlock". |

### Login methods — `app/login-methods.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Visual | The Apple row icon is an empty `<Text>` (glyph stripped), so a blank square shows next to "Apple". | login-methods.tsx:92 | `<Ionicons name="logo-apple" size={20} color={theme.text} />`. |
| P0 | Copy | The TOTP setup says "scan the QR code", but no QR code is rendered. It prints the raw `otpauth://` URI instead ("The URI is:"). | login-methods.tsx:561–564 | Render `<QRCode value={totpModal.uri} />` (react-native-qrcode-svg is already a dependency). Copy: "Scan this code with your authenticator app, or enter the key below." |
| P0 | Copy | Vendor and raw errors are shown: "No redirect URL returned from Clerk." Raw `e.errors[0].message` appears in 6 alerts. | login-methods.tsx:156, 136, 170, 209, 232, 247, 269 | "Couldn't connect {provider}. Try again." / "Couldn't remove {provider}. Try again." / "That code isn't right. Try again." |
| P1 | Copy | Jargon and casing: "Login Methods", "Two-Factor Authentication", "Authenticator app (TOTP)", "Enabled — you can sign in with your password", "Verify & enable 2FA". | login-methods.tsx:286, 393, 403, 73, 601 | "Sign-in methods", "Two-factor authentication", "Authenticator app", "On", "Turn on". |
| P1 | Consistency | Five success and failure `Alert`s, including "Password added" and "Two-factor authentication enabled". The TOTP modal has no `onRequestClose` (Android back). | login-methods.tsx:133, 245, 267, 544 | Toasts for success. Add `onRequestClose`. |
| P1 | Theme | Static tokens, plus `#EF4444`, `rgba(239,68,68,…)` and `#4285F4`. | login-methods.tsx:17–19, 688–692, 83 | Use `useAppTheme()` and `theme.error`. |
| P2 | Visual | Row labels 13 pt and sublabels, badges and buttons 11 pt; the note text is 11 pt. | login-methods.tsx:653–676, 699 | 15 / 13 / 13 pt. |

### Store setup — `app/setup.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P1 | Consistency | Tapping a task opens an `Alert` (Open / Mark complete / Cancel), and "Open" uses `router.replace`, which throws away the back stack. | setup.tsx:185–189 | Tapping pushes the task route. Mark complete lives on the check circle only. |
| P1 | Motion | Before load the header reads "0 of 0 required completed · 0%" and the list is empty, then it pops in. The progress width uses `useNativeDriver:false`. | setup.tsx:192–195, 211, 161, 174 | Render a skeleton until `state` exists. Animate `scaleX` natively. |
| P1 | Copy | "✓ All required steps complete — you're ready to go!", "Your store is ready!" and "Go to Dashboard" pile up exclamations and title case. The CTA gradient is a hard-coded `#10B981→#34D399`. | setup.tsx:244, 260, 265, 269 | "Setup complete" / "Your store is ready to publish." / "Go to dashboard". Use the theme gradient. |
| P1 | Visual | "Skip" is 11 pt `SUBTLE`, descriptions 11 pt, and static `CARD/BORDER/FG`. | setup.tsx:123, 126, 20–25 | 13 pt `theme.muted`. Use theme tokens. |
| P2 | A11y | The close X and check circle have no labels. | setup.tsx:202–208, 75–81 | "Close" / "Mark {task.label} complete". |

### Welcome to the Thread — `app/thread-explainer.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Copy | **New buyers loop between screens.** This file reads `'onboarding_owner_clerk_id'`, but onboarding and `_layout` write `ONBOARDING_OWNER_KEY = 'onboarding_owner_id'`. `ownerId` is always null, so the screen replaces to `/onboarding`, AuthGate sends the user back to `/thread-explainer` (buyer, explainer unseen), and the cycle repeats. | thread-explainer.tsx:42, 99–103; \_layout.tsx:261, 486–493 | `import { ONBOARDING_OWNER_KEY } from './_layout'` and delete the local constant. |
| P1 | Theme | Static `BG/CARD/FG/MUTED`, `GRAD_HERO` and `GRAD_DARK_FADE`: the buyer's first screen ignores the theme they may have chosen. | thread-explainer.tsx:31–39, 147, 196 | Use `theme.background`, `theme.card` and `theme.heroGradient`. |
| P1 | Copy | Long, generic body copy (2 lines each at 13 pt muted). "Like & Save" is title case. "Buy in one tap" is contradicted by the body ("add to cart, and check out"). | thread-explainer.tsx:49–75 | One line each: "The Thread — Drops and stories from brands you follow." / "Like and save — Double-tap to like. Tap the bookmark to save." / "Shop the post — Tap a tagged product to buy." / "Talk to brands — DM about sizing or custom orders." / "Repost — Share drops with your friends." |
| P2 | Motion | Blank BG screen while AsyncStorage resolves, then a 500 ms fade. | thread-explainer.tsx:136–139 | Keep this, but render the logo in the blank state so it doesn't flash empty. |

### Privacy Policy — `app/privacy.tsx` · Terms of Service — `app/terms.tsx` (rendered by `components/legal/LegalDocument.tsx`)

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Copy | Placeholder and draft text is visible to users: "[LEGAL ENTITY NAME — REQUIRED BEFORE LAUNCH]", "[A FINAL RETENTION SCHEDULE MUST BE APPROVED…]", "[COUNSEL MUST SET…]", "[GOVERNING LAW…]", "[LEGAL/SUPPORT EMAIL AND POSTAL ADDRESS…]", "In this draft". | privacy.tsx:11, 64; terms.tsx:11, 101, 108, 115 | Fill in the real entity, address and email, and remove every bracket before launch. |
| P0 | Copy | Draft banners render on both pages: the "Legal review required before launch" notice, the "OWNER + COUNSEL ACTION REQUIRED" card and the footer "Draft document for legal review." The reviewNotice prop says "first draft, not legal advice". | LegalDocument.tsx:100–108, 131–141; privacy.tsx:126; terms.tsx:140 | Remove the notice, placeholder card and draft footer. Footer: "© 2026 Brandthread". |
| P1 | Copy | Internal audit language: "our audit found no active request for GPS-derived precise or coarse device location" and "The app does not include a device-location library". | privacy.tsx:32 | "We don't collect your device's GPS location. If that changes, we'll ask first and update this policy." |
| P1 | Visual | Readability: body and bullets are `theme.muted` (58–72% white) at 15/25 over long runs. `maxWidth: 860` gives about 120 characters per line on web and tablet. There's no visible back control, only a "B Brandthread" wordmark that acts as back. | LegalDocument.tsx:141–144, 307–310, 322–327, 66–77 | Body in `theme.text` at ~85% and 16/26. `maxWidth: 680`. Add a sticky header with a 44 pt back chevron labelled "Back". |
| P2 | Visual | A fake "B" mark instead of `BrandthreadLogo`. On web `paddingTop` is at least 67 px. The 42 pt title wraps awkwardly on small phones. | LegalDocument.tsx:73–75, 46, 222 | Use `BrandthreadLogo`. Title 34 pt on widths under 400. |

### Languages — `app/languages.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P1 | Copy | Made-up stats on every row: "~60% of global e-commerce", "~8% of global e-commerce"… | languages.tsx:23–32, 126–128 | Delete the `marketShare` line and show the native name only. |
| P1 | Copy | The footer promises a feature that probably doesn't exist: "enable multi-language support from your plan settings". "Buyers will see content in this language" implies translation happens. | languages.tsx:145, 98 | "Sets the language for your storefront's buttons and emails." Remove the footer unless the feature ships. |
| P1 | Copy | A load failure silently shows English as selected. | languages.tsx:47–48 | Show an error row: "Couldn't load your language. Pull to refresh." |
| P2 | Copy | "Published languages" for a single choice. A "Default" badge marks the selected row. "Error" alert. 11 and 12 pt text. | languages.tsx:96, 121, 64, 170–172 | "Store language" / badge "Current" / "Couldn't save. Try again." / 13 pt minimum. |

### Help & support — `app/help.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P1 | Visual | No `KeyboardAvoidingView`: the Subject and Message inputs at the bottom of the scroll sit under the keyboard. | help.tsx:84, 173–191 | Use the existing `KeyboardAwareScrollViewCompat` (as login-methods does). |
| P1 | Copy | Title case everywhere: "Help & Support", "Email Us", "Live Chat", "Full Docs", "Frequently Asked Questions", "Send Message". | help.tsx:80, 106, 110, 114, 119, 200 | "Help", "Email us", "Chat", "Guides", "Common questions", "Send". |
| P1 | Copy | Risky claims: "We typically respond within 2 hours". "Order history is retained … for 90 days" contradicts the Privacy Policy. "Pre-orders are charged immediately" appears alongside the escrow promise. "Live Chat" opens an external `brandthread.app/chat`. | help.tsx:147, 21, 15–16, 108 | "We usually reply within one business day." Align the retention wording with privacy.tsx. Hide Chat until it exists. |
| P2 | Copy | "Got it! We'll be in touch shortly." / "Missing info … Please fill in…" / "Error". The fallback sends `unknown@brandthread.app` and "Brandthread User". | help.tsx:152, 46, 64, 51–52 | "Message sent. We'll reply by email." / "Couldn't send. Try again or email support@brandthread.app." |
| P2 | Motion | FAQ open state is keyed by the filtered index, so typing in search expands a different card. | help.tsx:123–130 | Key by `faq.q`. |

### Share profile — `app/share-profile.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P1 | Copy | The profile link is copied to the clipboard automatically on open, overwriting whatever the user had copied, without being asked. Instagram and Depop don't do this. | share-profile.tsx:98–119 | Copy only on "Copy link" tap. |
| P1 | Copy | Casing and exclamations: "Share Profile" (header, button and dialog title), "Copy Link", "Link Copied!", "Set Username". | share-profile.tsx:182, 308, 150, 294, 228 | "Share profile", "Copy link", "Copied", "Add username". |
| P1 | Theme | Static `BG/CARD/FG/BORDER`. Text and icons on accent use static `BG` instead of `theme.onAccent`. | share-profile.tsx:28–31, 227–228, 291–293, 325 | Use `theme.*` and `theme.onAccent`. |
| P2 | Copy | The no-username copy is robotic: "…must be 3–30 characters and contain only letters, numbers, and underscores." | share-profile.tsx:219 | "Pick a username to get your link, like brandthread.app/u/alex." |
| P2 | Motion | A spinner plus "Loading profile…" instead of a QR skeleton; `bounces={false}`. | share-profile.tsx:192–196, 190 | Show a 220×220 skeleton card. |

### Navigation isolation probe (CI) — `app/navigation-isolation-probe.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P1 | Consistency | **Users can reach it by deep link.** Expo Router registers every file in `app/` whether or not `<Stack.Screen>` is declared, so `brandthread://navigation-isolation-probe` opens a debug page ("Navigation isolation probe", six test buttons with hard-coded hex colours) for any signed-in user in production. It's only gated from *public* access (`_layout.tsx:269`). | navigation-isolation-probe.tsx:14–32; \_layout.tsx:146, 777–779 | At the top of the component: `if (process.env.EXPO_PUBLIC_NAVIGATION_ISOLATION_TEST !== '1') return <Redirect href="/" />;`. Or move the file to a test-only route group excluded from prod. |

### Dev bypass and debug surfaces (touches this slice) — `lib/devBypass.ts`, `app/_layout.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P1 | Consistency | In **every** `__DEV__` native build, `DEV_BYPASS_ROLE='seller'` permanently writes `onboarding_complete=true`, `user_role=seller` and `splash_seen=true` to AsyncStorage at module load. Anyone testing on Expo Go or a dev client **never sees splash, sign-in or onboarding**, so none of the findings above are visible in dev. The flags persist even after the bypass is set back to null. | devBypass.ts:5; \_layout.tsx:247–253, 446–452 | Default to `null`, opt in via `EXPO_PUBLIC_DEV_BYPASS_ROLE`, and never persist the flags; keep them in memory only. |
| P1 | Consistency | On web `PREVIEW_ROLE` returns `'buyer'` when no `?bt_preview` is set. If `EXPO_PUBLIC_NAVIGATION_ISOLATION_TEST=1` ever reaches a production web build, **every visitor** bypasses auth as a buyer. | \_layout.tsx:235–245 | Return `null` unless the param is explicitly `buyer` or `seller`, and assert the env is unset in the prod build. |
| P2 | Consistency | Onboarding device-probe controls (`deviceProbe=1`) and a 2×2 touch target are correctly `__DEV__`-gated. No leak, but `onDevClear`/`devReset` is used in production UI (see the onboarding finding). | onboarding.tsx:1919–1926, 2451–2458 | OK as gated. Rename and scope `devReset`. |

---

## Clean / low-risk
- `app/account-type.tsx` default export (redirect shim): fine.
- `components/onboarding/SellerPlanRecommendationStep.tsx`: read for context only; another auditor covers components. Note the hard-coded `'#FFF'` title (line 91) and all-caps "YOUR PERSONALIZED PLAN" and "RECOMMENDED".

## Cross-cutting patterns in my slice
- **Clerk "future" API misuse (3 flows broken).** Result objects `{ error }` are ignored or legacy methods are called via `as any`. This breaks OTP verify (onboarding.tsx:1273), send-code (1253), password reset (forgot-password.tsx:46, 65) and MFA sign-in (sign-in.tsx:73). Standardise one `authStep()` helper that checks `{error}` and `status`.
- **Raw error text shown to users in 4 mappers and about 10 alerts.** `mapClerkError`, `mapError` ×2 and login-methods alerts all fall back to `inner.message`/`e.message`, and one names the vendor ("Clerk").
- **Apple sign-in isn't HIG-compliant on 3 screens.** The Apple glyph is missing on 2 (sign-in.tsx:285, login-methods.tsx:92). The Apple button is theme-coloured in onboarding and always placed after Google. The Google "G" is faked in 4 places. `expo-apple-authentication` is installed but unused.
- **Keyboard handling is weak.** Only 1 `returnKeyType` in 16 files and 0 `oneTimeCode` autofill props across 4 code inputs. The onboarding footer CTA sits outside its KAV, and help.tsx has no KAV at all.
- **7 of 15 screens import static `BG/CARD/FG/BORDER/MUTED` from `lib/theme`** and ignore the runtime theme: account-type-settings, account-switcher, login-methods, setup, thread-explainer, languages, share-profile. The slice also has 25 hex literals and 16 `rgba()` literals.
- **Title case in UI copy on 9 screens and "Please" 26 times in 7 files.** Examples: "Go to Dashboard", "Login Methods", "Share Profile", "Copy Link", "Help & Support", "Account Type".
- **25 `Alert.alert` calls in 7 files.** They're used for success ("Password added", "Face ID enabled", "Account type updated"), for action menus (setup) and as blocking retry loops with no Cancel (onboarding).
- **Press feedback and buttons are bespoke.** 192 `TouchableOpacity` uses versus 0 `PressableScale`. The shared `PrimaryButton` appears only in setup; onboarding defines its own, and sign-in and forgot-password build gradient buttons by hand. That makes 4 different primary-button styles in the auth funnel.
- **Screens promise things that don't happen (4).** Biometric lock is never enforced. The notifications "Continue" never asks for permission. Languages suggests translation that doesn't exist. The TOTP screen says "scan the QR code" and shows none.
- **Small text: `fontSize` 11 or 12 appears 32 times in 8 files.** It covers legal links, hints, badges, sublabels and "Skip", which is key microcopy in the first-run flow.
