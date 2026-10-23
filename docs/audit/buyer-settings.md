# Screen audit 5/10 — Buyer settings, account and misc

Every screen below was read in code and rendered at 393×852 on the signed-in
buyer web harness (`scripts/store-screenshots/buyer-settings-audit.mjs`,
fresh data, plus `?section=` for each Settings detail page). Swipe actions,
long-press sheets and `…` menus were checked before anything was called
missing. `[FIXED]` items are fixed in this PR; the rest need a product
decision, a backend change, or touch shared/other-squad code, and are left
as found.

**Settings** (app/buyer-settings.tsx, services/settingsCatalog.ts, components/settings/SettingsKit.tsx)
- [FIXED] 25 row subtitles were cut off with "…" at phone width (e.g. "Password, email, phone, and sign-in m…", "Require Face ID, Touch ID, or fingerprint to open Brandthrea…"); buyer catalog descriptions shortened to fit one line.
- [FIXED] "Notifications" opened `/push-notifications`, a local-only list of store-admin toggles ("Critical alerts… expiring domain", "Fulfillments", "Setup tips") that were never loaded or saved; it now opens the real, server-backed buyer notification settings.
- [FIXED] "Who can message and see me" promised "tags, mentions, comments, and sharing", which that page doesn't have; description now matches its contents.
- [FIXED] "Content you see" promised "Favorites… and suggested content", which that page doesn't have; description corrected.
- [FIXED] "Accessibility & data usage" promised media quality and data usage controls that aren't on the page it opens; renamed "Accessibility" with an accurate description.
- [FIXED] "About Brandthread" promised "licenses" (there is no licenses screen); description corrected.
- [FIXED] "Close Friends" was Title Case while every other row is sentence case (the Menu already says "Close friends").
- [FIXED] Version line was hardcoded "Brandthread v1.0.0"; now read from the app config.
- [FIXED] A failed sign-out closed the sheet silently with an unhandled rejection; now shows an error and keeps you signed in.
- [FIXED] The search clear (x) button had no accessibility role or label.
- [FIXED] The profile card had a label but no button role.
- [FIXED] Raw `marginTop: 4` on the version line.
- "Language" opens the seller **store** language screen ("STORE LANGUAGE", "Select your store's primary language") — buyers have no app-language setting to point it at. Needs a product call (remove the row for buyers or build a buyer language page).
- "Orders & returns" group holds "Orders and returns", and "Help & support" holds "Help and support" — mixed "&"/"and" between group and row.
- SettingsKit off-scale sizes `fontSize: 18` (avatar initials) and `14` (confirm sheet message); not changed because the kit is shared with seller settings and community members.

**Menu** (app/buyer-settings-menu.tsx)
- [FIXED] Scroll content ignored the bottom safe area (`paddingBottom: SP.xl` only).
- [FIXED] A failed sign-out still navigated to Sign in while the session was alive; now only navigates on success and shows an error otherwise.
- [FIXED] "Log out" here vs "Sign out" in Settings, the catalog and the confirm sheet; unified on "Sign out".
- [FIXED] "Settings" pushed the `/settings` redirect (a loading flash) instead of `/buyer-settings`.
- [FIXED] Rewards and Gift cards used the same `gift` icon; Gift cards now uses `tag`.
- [FIXED] Off-token `fontSize: 12`/`15` and `borderRadius: 10` → FS.meta / FS.base / RADIUS.sm.

**Settings detail pages** (app/buyer-settings-detail.tsx)
- [FIXED] A load failure set `loadError` but rendered nothing — a blank page under the header; now shows an error with Retry.
- [FIXED] Stored enum values were shown raw ("everyone", "friends", "standard", "system"); mapped to labels ("Everyone", "Friends", "No one", …).
- [FIXED] Accessibility: "Text size: Default" and "High contrast icons: Off" were hardcoded fake values on disabled rows; removed.
- [FIXED] About: app version was hardcoded "1.0.0"; now read from the app config.
- [FIXED] About: "Open-source licenses" was a dead row (icon, no action, greyed); removed.
- [FIXED] Content: "Reset suggested content" was a dead row (icon, no action); removed.
- [FIXED] Messages page title "Messages and story replies" was clipped in the header ("Messages and story repl…"); now "Messages".
- [FIXED] Notifications: the "Email & in-app" subtitle was cut off; shortened.
- [FIXED] Raw `fontSize: 13` on the intro → FS.sm.
- Every row without a toggle or action renders disabled at 50% opacity with no explanation (Messages: "Who can add you to groups", "Story replies"; Content: "Sensitive content") — they look broken; they need either a picker or to be read-only styled.
- Messages toggles ("Message requests", "Read receipts", "Show activity status") write only to device storage and nothing reads them; Privacy has a separate server-backed read-receipts switch, so there are two conflicting read-receipt controls.
- Accessibility toggles ("Reduce motion", "Always show captions") are saved but no screen reads them.
- Unlinked sections still in the config (`activity`, `archive`, `story`, `tags`, `comments`, `sharing`, `hidden-words`, `suggested`, `payments`, `language`, `privacy-center`, `media`) are full of fake values ("0 people", "1 saved", "Autofill… On", "Daily average") and dead rows, and `hidden-words` binds two different toggles to the same key; they are only reachable by deep link. Recommend deleting them (note: tests pin the `payments` "Purchase protection" strings).
- An unknown `section` silently falls back to Content preferences.

**Accounts Center** (app/buyer-account-center.tsx)
- [FIXED] "Personal details — Name, email, phone and birthday": birthday can't be set anywhere; now "Name, username, email, and phone".
- [FIXED] "Ad and recommendation preferences" title and "Password, two-factor authentication and login alerts" / "Permanently delete your account and data" subtitles were clipped; shortened.
- [FIXED] "Control personalisation" (British spelling; the app uses US English) → "personalization".
- [FIXED] Same screen was "Biometric unlock" here but "App Lock" in Settings and on the screen itself; now "App Lock".
- [FIXED] Same screen was "Where you're logged in" here but "Login activity" in Settings and on the screen itself; now "Login activity".
- [FIXED] Missing serial commas ("Apple, Google and email").
- [FIXED] Off-scale hero type `fontSize: 11.5` (below the body floor) and raw `15`, `gap: 14`, `padding: 16` → FS.meta / FS.base / SP tokens.
- "Recommendation preferences" opens Content preferences, which has no ad controls (title now matches what's there).

**Personal details** (app/buyer-personal-details.tsx)
- [FIXED] Title "Personal Details" and CTA "Save Changes" were Title Case; now sentence case.
- [FIXED] Birthday was a permanently locked field with the placeholder "Set in Login methods", but Login methods has no birthday; row removed.
- [FIXED] Copy contradicted itself ("Email and birthday are managed by your sign-in provider", "Change your email in Login methods", with a Change email row right below); now points to the Change email / phone rows.
- [FIXED] If the profile load failed the screen stayed a blank view forever; now falls back to editable defaults.
- [FIXED] Loading state was an empty transparent view with no header or back button; now header + loading state.
- [FIXED] Save fired the success haptic before saving, had no saving state (double-tap saved twice), and a failure was an unhandled rejection that still navigated back; now saves once, shows a spinner, and alerts on failure.
- [FIXED] Right-aligned values overflowed the card edge ("@username", the lock icon) because the input had no `minWidth: 0`.
- Phone is a free-text field saved only on the device, right above the verified "Change phone number" flow; it should be read-only like email.

**Change password** (app/change-password.tsx)
- [FIXED] Success title said "Password changed" even when adding a first password; now "Password added" in that case.
- Raw spacing `marginTop: 20`, `paddingHorizontal: 16`, `8` in the screen styles.
- SecurityFormKit field label and error text use raw `fontSize: 11` (below the body floor); shared with seller security screens.

**Change email / Change phone** (app/change-email.tsx, app/change-phone.tsx, components/security/ChangeIdentifier.tsx)
- Success and "code sent" copy echo the raw typed value instead of the normalized one sent to Clerk (lowercased email, E.164 phone).
- If removing the old identifier fails the error is swallowed and the success screen implies it's gone.
- "Change phone number" title even when the account has no phone yet (it's an add).
- Raw spacing 20 / 16 / 8 in ChangeIdentifier styles.

**Login activity** (app/buyer-login-activity.tsx → components/security/LoginActivity.tsx)
- [FIXED] "Sign out everywhere" signed out but never left the screen, leaving a spinner; now goes to Sign in.
- [FIXED] Raw `fontSize: 11` on the section label and "This device" pill → FS.xs.
- "Password and two-factor authentication" link opens the seller-styled `/login-methods` instead of the buyer "Password and security" screen.
- The "This device" pill is green (`theme.success`), outside black/white/silver.

**Account type** (app/account-type-settings.tsx)
- [FIXED] Tag said "Current plan" on an account type; now "Current".
- [FIXED] Success copy "You are now a Seller." (mid-sentence Title Case) → "You're now using a seller account."
- [FIXED] Bare "Error" alert title → "Couldn't switch account type".
- [FIXED] Disclaimer body text at FS.xs (badges only) → FS.meta.
- A failed profile load is swallowed, so nothing is preselected and the "Save" state is wrong; needs an error/retry state.
- Missing `accountType` defaults to "seller".
- Type cards have no radio role/selected state.
- Back fallback is hardcoded to the buyer menu although seller settings also links here.

**Password and security** (app/buyer-security.tsx)
- [FIXED] A failed settings load left a header-only blank page forever; now falls back to defaults.
- [FIXED] Toggle save failures were unhandled and never reverted; now revert.
- [FIXED] "Where you're logged in" → "Login activity" (matches the screen and Settings).
- [FIXED] One subtitle ended with a period, the others didn't.
- "Login alerts" and "Save login info" only write to device storage and nothing in the app reads them — the controls promise security behavior that doesn't exist.
- Two-factor row shows no on/off status although it's available from Clerk.

**Delete account** (app/delete-account.tsx)
- [FIXED] "Enter the 6-digit code we email you" (wrong tense) → "we emailed you".
- [FIXED] On the done screen the title and lead were left-aligned inside a centered column; now centered.
- [FIXED] Raw `fontSize: 11` and `FS.xs + 1`, footnote body at FS.xs → FS tokens.
- Blocker button `paddingHorizontal: 12`, `height: 34` are off-grid.

**Privacy** (app/buyer-privacy-settings.tsx)
- [FIXED] "Who can message you: Followers only" meant the opposite — the server only allows people *you follow* (its own subtitle said so); label now "People you follow".
- [FIXED] Back saved silently and navigated away even when the save failed, dropping the change; now stays and shows the error.
- [FIXED] A failed local settings load left the skeleton forever; now falls back to defaults.
- [FIXED] Scroll ignored the bottom safe area (`insets` was declared and unused).
- Follow-request count is capped at 50 (`list(50, 0)`) with no "50+".
- The server's `canBePrivate` flag is ignored, so Private account shows even when not allowed.

**Blocked & muted** (app/buyer-blocked.tsx)
- [FIXED] The Blocked/Muted segmented control ran edge to edge with no side gutter.
- [FIXED] Unmute had no error handling (unhandled rejection on failure).
- [FIXED] Row subtitle started with a blank line when the account had no handle.
- A failed muted-users load is dropped and the Muted tab shows "No muted accounts".
- The Muted tab has no pull-to-refresh (Blocked does).
- Unmute here has no confirmation, unlike Muted accounts.

**Muted accounts** (app/buyer-muted.tsx)
- [FIXED] No loading state: "No muted accounts" showed while loading and after a failed load.
- [FIXED] A failed unmute left the button spinning forever.
- [FIXED] A search with no matches said "No muted accounts" even though accounts exist; now "No results".
- [FIXED] Copy contradicted Blocked & muted ("You'll remain friends…" vs "hides… on this device"); unified, with curly apostrophes.
- Search field uses raw `rgba(255,255,255,0.10)`, `gap: 10`, `borderRadius: 12`, padding 12/10.

**Restricted accounts** (app/buyer-restricted.tsx)
- [FIXED] No loading state: "No restricted accounts" flashed while loading.
- [FIXED] A failed unrestrict left the confirm sheet open with an unhandled rejection.
- [FIXED] A search with no matches said "No restricted accounts"; now "No results".
- [FIXED] Straight apostrophes in the intro.
- Same raw search-field values as Muted accounts.

**Close friends** (app/buyer-close-friends.tsx)
- [FIXED] No loading state: "No friends yet" with a "Find friends" button showed while loading.
- [FIXED] "Find friends" opened the Incoming requests tab; now opens Suggested.
- [FIXED] Alert copy "Close Friends list" (Title Case) → "close friends list".
- [FIXED] Friend/close-friend lookups could reject unhandled.
- Off-token `gap: 10`, `lineHeight: 17`, `rgba` fill, `height: 40`, `borderRadius: 12`, `marginLeft: 52`; dead `empty*`/`findFriendsBtn*` styles.

**Muted words** (app/muted-words.tsx)
- [FIXED] The input placeholder was cut off by the Mute button ("Add a word, phrase, #hashtag or (").
- [FIXED] A failed load showed the error card and "No muted words yet" together, with no retry; now error + Retry only.
- [FIXED] At the limit the input greyed out with no explanation; the hint now says to remove a word.
- [FIXED] Hint copy at FS.xs and raw `fontSize: 11` → FS.meta / FS.xs.
- Dead `header`/`headerBtn`/`headerTitle` styles; raw paddings 6/16/12/14/10.

**Connections / Follow requests** (app/buyer-friend-requests.tsx)
- [FIXED] Suggested tab had no loading state ("No suggestions yet" while loading).
- [FIXED] On a failed load the Retry row stacked above a contradicting empty state; now Retry only.
- Long-press Block fires without await/feedback and leaves the row in the list.
- "Dismiss" only hides the row until the next focus reload.
- With one request, Confirm shows the spinner even when Delete was tapped.
- Header says "Connections" but the entry rows say "Follow requests".
- Mixed alert styles ("Error" + message vs a sentence as the title).
- Request avatars render a purple fill (from the user's stored color), outside black/white/silver.

**Push notifications** (app/push-notifications.tsx)
- [FIXED] The whole screen was fake: store-admin toggles held in local state, never loaded or saved, reset on leaving. The route now redirects to the real buyer (or seller) notification settings.

**Email & in-app** (app/notification-channels.tsx)
- [FIXED] A load failure was swallowed and the default switch values looked like saved choices; now loading and error/Retry states.
- [FIXED] A failed save snapped the switch back with no message; now alerts.
- [FIXED] `paddingBottom: 140` ignored the safe area.
- A fast second toggle can roll back the first (closure over stale state).

**Appearance** (app/appearance.tsx; app/app-theme.tsx and app/app-icon.tsx redirect here)
- [FIXED] "Follow app theme" subtitle and icon names at FS.xs (badges only) → FS.meta.
- Dead `borderColor: '#000'` (always overridden); raw margins 4/2/6.
- `selectTheme` has no error handling.
- app-theme / app-icon redirects: clean.

**App Lock** (app/biometric-unlock.tsx)
- [FIXED] Off-scale `FS.xs + 1` and raw `fontSize: 11`; footnote body at FS.xs → FS tokens.
- [FIXED] Awkward footnote "Apps in the background for less than the time you choose open without asking." reworded.
- On web the method label is "Biometrics", so copy reads "Lock Brandthread with Biometrics" / "Require Biometrics" (capitalized mid-sentence).
- A failed save leaves the spinner on.

**Languages** (app/languages.tsx)
- [FIXED] Every row showed an unsourced statistic ("~60% of global e-commerce") as if it were data; removed.
- [FIXED] Footer pointed to "multi-language support from your plan settings", which doesn't exist; removed.
- [FIXED] Green "Default" badge (off palette) → neutral "Current" badge.
- [FIXED] Banner read "English — English"; the native name only shows when it differs.
- [FIXED] "Published languages" heading for a single-select setting → "Store language".
- [FIXED] Raw font sizes 15/12/14/11 (14 isn't on the scale) and 20pt gutter → FS/SP tokens; bottom safe area.
- [FIXED] Rows had no radio role or selected state.
- [FIXED] Bare "Error" alert title.
- A load failure silently selects English.
- See Settings: buyers reach this seller store-language screen from "Language".

**Tips** (app/first-run-tips-settings.tsx)
- [FIXED] After "Skip all tips" was on, the switch still looked live but turning it off did nothing; it now locks, and the subtitle says to use Replay tips.
- [FIXED] A failed Replay gave no feedback (unhandled rejection); now alerts.
- [FIXED] Subtitles at FS.xs → FS.meta; 20pt gutter and a wrong "SP.md's 14" comment → SP.md.
- [FIXED] `paddingBottom: 60` ignored the safe area.

**Help & support** (app/help.tsx)
- [FIXED] FAQ pointed to "Profile → My Orders", "Get Help" / "Return / Exchange" buttons and "Settings → Account → Delete Account", none of which exist; now names the real menu path and the real "Request Return" / "Report a Problem" buttons.
- [FIXED] "Live Chat" button only scrolled to the email form (there is no live chat); now "Message us".
- [FIXED] Bug / Feature category cards said "Contact us" but opened an empty filtered list; they now jump to the message form with that topic picked.
- [FIXED] Search with a trailing space ("drops ") matched nothing.
- [FIXED] Mixed Title Case ("Help & Support", "Email Us", "Full Docs", "Send Message") → sentence case.
- [FIXED] "Send another" link had no role and a tiny touch target.
- [FIXED] Scroll and article sheet ignored the bottom safe area.
- A user with no email sends the ticket from `unknown@brandthread.app`, so support can't reply.
- Raw `gap: 4`, `marginBottom: 4`, `paddingVertical: 4`.

**Report a problem** (app/buyer-problem-report.tsx)
- [FIXED] Success button always said "Back to Order", even for a general report; now "Done".
- [FIXED] If the order failed to load the form still showed and "Send report" silently did nothing; now an error state.
- [FIXED] Loading view had no header/back control.
- [FIXED] Remove-photo button was icon-only with no label/role, an 18pt target and raw `#00000099`/`#fff`; now labeled, hitSlop, theme tokens.
- [FIXED] Duplicate "Evidence note" comment.
- Raw spacing/radius (8, 6, 10) and `rgba(249,115,22,0.3)`; unused submit/done styles.

**Download your data** (app/buyer-download-data.tsx, components/security/EmailExportSection.tsx)
- [FIXED] Success view said "Save it or send it anywhere" with no way to do so; now has a "Share file" button.
- [FIXED] Without system sharing, it claimed the data was ready although the file was unreachable; now points to the email link.
- [FIXED] Before any request the email card said "We'll email you a link when it's ready", as if something was in progress; now "Get a download link by email instead."
- Raw icon size 40, magic `32` divider inset, `borderRadius: 12`, `gap: 8`.

**Thread Cash** (app/thread-cash.tsx)
- [FIXED] Section title `fontSize: 20` (off scale) → FS.xl; raw `13`/`12` → FS tokens; 20pt card padding → SP.lg.
- [FIXED] "Longest streak: 1 days" wasn't pluralized.
- After a failed load the streak card still shows default program terms as if real.
- Rules say earning comes from keeping the app open; the empty state says "Check in daily" (ledger says the same).
- Translucent `rgba(255,255,255,0.7)` hint text (marked theme-exempt in code).
- Fresh preview fixture shows "Day 0 of 7" (server starts at day 1).

**Thread Cash ledger** (app/thread-cash-ledger.tsx)
- [FIXED] Section title `fontSize: 20` → FS.xl; raw `marginTop: 4` → SP.xs.
- A failed filter change keeps the previous filter's rows under the new pill with no error.
- A failed "Show more" is silent.

**Thread Cash history** (app/thread-cash-history.tsx)
- [FIXED] The list was a plain View: up to 100 rows with no scrolling (and no bottom inset); now scrolls.
- [FIXED] A failed balance load showed "$0.00 balance" as if real; now "—".
- Running balances are computed from 0 while the balance is loading or failed.

**Thread explainer** (app/thread-explainer.tsx)
- [FIXED] `useHeaderTopInset()` was called inline after an early return (hook order changed when `checked` flipped).
- [FIXED] Headline `FS.h1 + 4` (40, off scale) → FS.h1.
- [FIXED] Unused `Dimensions`/`SW`.
- Rendering note: the signed-in harness redirects this route to onboarding, so it was verified in code only.

**Rewards** (app/loyalty.tsx)
- [FIXED] Loading view had no header/back control.
- [FIXED] "≈ $0.50 off your next order" showed under 100 points, the redeem minimum.
- [FIXED] Empty title used the uppercase section style ("NO POINTS YET").
- [FIXED] "Use points in Cart" (mid-sentence capital) → "in cart".
- The points input and its "= $X off" preview do nothing — Redeem ignores the number and just opens the cart.
- `redeeming` state is never set (dead spinner branch).
- Program terms ("500 pts", "$10") hardcoded instead of the referral constants; raw spacing/radius values; unused header styles.

**Gift cards** (app/buyer-gift-cards.tsx)
- [FIXED] Total `fontSize: 34` (off scale) → FS.h2.
- [FIXED] "Works only at ." when the store name is missing → "this store".
- Opening a card fetches history with no loading/error state, and a quick toggle can show another card's history.
- Magic `marginTop: 25`.

**Buy a gift card** (app/gift-card-buy.tsx)
- [FIXED] Said "Gift card sent… We emailed it" even when payment confirmation never came back as paid; now "Payment received… shortly".
- [FIXED] Raw `#8A8A8A` text → theme MUTED.
- [FIXED] Literal "$0" → formatted currency.
- Load failure has no Retry.
- Sends a made-up billing name "Gift card buyer" to Stripe.
- `SP.sm + 4`, `borderRadius: 22/14` off-token.

**Invite friends** (app/buyer-invite.tsx)
- [FIXED] A failed load still showed the full screen with "------", a dead Copy and Share, and $0 totals; now a Retry row.
- [FIXED] Hardcoded `1000` reward fallback → the referral constant.
- [FIXED] Code `fontSize: 32` (off scale) → FS.h2.
- Raw `gap: 4`, `paddingHorizontal: 14`.

**Invite link** (app/invite/[code].tsx)
- [FIXED] Signed-in state had no way out when opened from a deep link; added "Not now".
- [FIXED] "You are already on Brandthread" → "You're already on Brandthread".
- "$10" hardcoded instead of the referral constants.

**Saved** (app/buyer-saved.tsx)
- [FIXED] A failed load showed "Nothing saved yet"; now an error with Retry.
- [FIXED] Grid ignored the bottom safe area (`insets` was unused).
- [FIXED] Third-party brand in copy ("like a Pinterest for your wishlist").
- [FIXED] "Buy Now" / "Add to Cart" / "Cannot Add to Cart" Title Case beside sentence-case rows.
- [FIXED] Badge text raw `#0A0A0B` at `fontSize: 10` (below the 11 floor) → BG / FS.xs.
- [FIXED] `SPACING.xs + 2` off-token.

**Collection** (app/buyer-collection.tsx)
- [FIXED] Opened without an id it showed a blank page forever; now the error state.
- [FIXED] "Make public & share" shared the link even when making the board public failed.
- [FIXED] Tiles had no accessibility role/label (and no hint for long-press remove); the rename backdrop had no label.
- [FIXED] Grid ignored the bottom safe area.
- [FIXED] Public/private description had no font family and sat at FS.xs.
- Every refocus reloads non-silently, flashing the skeleton.

**Recently watched** (app/buyer-recently-watched.tsx)
- [FIXED] "Watched Xh ago" meta at FS.xs → FS.meta.
- Uses a raw RefreshControl instead of ThemedRefreshControl.
- Raw `borderRadius: 6`.

**Recent searches** (app/buyer-search-history.tsx)
- [FIXED] No loading state (blank page while loading).
- [FIXED] Title "Recent Searches" → "Recent searches".
- [FIXED] List had no bottom safe-area padding.
- [FIXED] A failed "Clear all" was swallowed and history came back next visit; now restores the list and alerts.
- "Clear all" sits higher than the header title (header right-slot alignment, shared ScreenHeader).

**Your activity** (app/buyer-your-activity.tsx)
- [FIXED] Title "Your Activity" → "Your activity".
- [FIXED] Reposts icon was yellow (`theme.warning`) beside grayscale stats.
- [FIXED] Dev-ish subtitle "Across all types" → "Posts, products, and stores".

**Archive** (app/buyer-archive.tsx)
- [FIXED] "Delete permanently" deleted immediately with no confirmation.
- [FIXED] No loading state ("No archived posts" before the fetch) and a failed load was an unhandled rejection; now loading and error states.
- [FIXED] Restore/Delete failures were unhandled with no feedback.
- [FIXED] Tab pills had no tab role/selected state; grid cells and sheet rows had no labels/roles.
- [FIXED] `paddingBottom: 80` ignored the safe area.
- The Stories tab is a hardcoded empty state; it never loads archived stories even though the API returns them.
- Captions at FS.xs; `gap: 6/14`, `paddingVertical: 14` off-token.

**QR code** (app/buyer-qr-code.tsx)
- [FIXED] "Your Name" placeholder shown as the profile name; now "—".
- [FIXED] While the profile loaded it said "Set a username to generate your QR code"; now a spinner.
- [FIXED] With no username, Share and the Link row presented the homepage as "my profile"; Share is disabled and the link shows "—".
- [FIXED] "Point a camera at this code…" showed with no code.
- [FIXED] Non-scrolling body clipped on small phones; now scrolls with a bottom inset.
- [FIXED] "QR Code" / "Share QR Code" → sentence case.
- Raw spacing 8/12/20/14 and height 50.

**My sizes** (app/buyer-my-sizes.tsx)
- [FIXED] While loading, every chip was disabled and read "Not set" with no indicator; now a spinner.
- [FIXED] The keyboard covered the measurement fields at the bottom; the scroll view now adjusts for it.
- The "cm / in" toggle also switches weight to kg/lb.
- Raw `+ 32`, `gap: 8`, `paddingVertical: 12`.

**Shopping preferences** (app/shopping-preferences.tsx, lib/buyerSettings.ts)
- [FIXED] A new account saw Tops "M", Bottoms "32", Shoes "10" and Streetwear + Vintage pre-selected as if chosen; defaults are now empty.
- [FIXED] Loading returned an empty view with no header/back button; now header + loading state.
- [FIXED] Load/save failures were unhandled; now alert.
- [FIXED] Title Case headings and CTA ("Shopping Preferences", "Your Sizes", "Preferred Fit", "Style Categories", "Save Preferences") → sentence case.
- [FIXED] Descriptions at FS.xs → FS.meta.
- Sizes here save only on the device while My sizes saves to the server, with different option sets; size recommendations read the server values.
- Categories save only on "Save preferences" while every other control saves instantly; leaving with Back drops category changes.
- "Preferred fit" still defaults to Regular.
- Size bubbles, fit rows and category chips have no radio/checkbox roles.

**Shipping addresses** (app/buyer-addresses.tsx)
- [FIXED] Postal code used a number pad, so UK/Canadian postcodes couldn't be typed.
- [FIXED] "Delete Address", "Save Address", "ZIP / Postal Code" Title Case → sentence case; bare "Error" alert title.
- Every field says "Next" on the keyboard but Next just dismisses it.
- The default checkbox can't be unchecked once ticked (kept: a test pins this behavior).
- Signed out, it shows an "Add new address" button whose save will fail.

**Payment methods** (app/buyer-payment-methods.tsx)
- [FIXED] A load failure showed "No saved payment methods"; now an error with Retry.
- [FIXED] Every refocus swapped the list for a full-screen spinner; now only the first load.
- [FIXED] "Make default" vs "Set as default" on addresses; unified.
- [FIXED] "Stored securely by Stripe" said three times on one screen; trimmed from the empty state.
- "Set as default" button is 24pt tall, under the 44pt minimum (Button has no hitSlop prop).
- Raw `fontSize: 11` and spacing 30/12/14/3/8.

**Legal pages** (app/terms.tsx, app/privacy.tsx, app/community-guidelines.tsx, app/refund-policy.tsx → components/legal/LegalDocument.tsx)
- Markdown heading `fontSize: 16` is off the scale.
- Fonts are string literals (`'Inter_700Bold'`) and sizes raw numbers instead of FONT/FS (all Inter and on-scale otherwise).
- Raw spacing 22/28/36/34/14/18/38/13/3/40 and `borderRadius: 10`.
- Unused `brandMarkText` style; doc comment says three documents (it covers five); hardcoded "© 2026".

**Settings redirect** (app/settings.tsx)
- Clean.

**Account control** (app/buyer-account-control.tsx)
- Clean (re-exports Delete account, covered above).

## App-wide, outside this squad's files

- Every `HapticSwitch` renders a green "on" track (visible on Settings detail, Privacy, Download data, Email & in-app), outside black/white/silver. It's the shared switch component, so it's left for the cross-cutting squad.
