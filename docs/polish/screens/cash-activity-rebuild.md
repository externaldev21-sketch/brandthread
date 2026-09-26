# Thread Cash & Notifications/Activity — visual rebuild

Cluster: Thread Cash (balance, history, send-to-friend, streak) +
Activity Center / Notifications. Visual layer only — no balance math,
transaction logic, payout/send eligibility, or API calls changed.

| Screen | Mobbin references | What changed | Before | After |
|---|---|---|---|---|
| Thread Cash — balance & history | [Apple Wallet card balance](https://mobbin.com/screens/e5c938d7-50d2-44b5-925f-5450cadc2713) · [Wise wallet balance + transaction icons](https://mobbin.com/screens/44daafcf-9304-46ce-8110-9323e4f5252b) · [KOHO total available + activity list](https://mobbin.com/screens/07ac1e5d-d822-4f9d-9799-e309726ea58a) | Rebuilt from a bare `ActivityIndicator` spinner + plain text rows into: a hero balance card with an icon badge (Wallet-card pattern), a grouped `BrandthreadCard` history list with a per-source icon + tint (check-in, streak bonus, sent, received, spend, refund, expiry all read differently at a glance, Wise-style), tabular-numeral amounts, and a real skeleton loading state (`SkeletonBlock` rows matching the final layout) replacing the spinner. | [before](../screenshots/cash-activity/thread-cash-before-390x844.png) | [after (390×844)](../screenshots/cash-activity/thread-cash-after-390x844.png) · [skeleton](../screenshots/cash-activity/thread-cash-skeleton-after-390x844.png) · [375×667](../screenshots/cash-activity/thread-cash-after-375x667.png) · [430×932](../screenshots/cash-activity/thread-cash-after-430x932.png) · [web 1440×900](../screenshots/cash-activity/thread-cash-after-1440x900.png) |
| Thread Cash — streak | [Cash App "Distribute paycheck" progress ring](https://mobbin.com/screens/5e07a78d-e7bf-42cd-a414-ca1683ca4ff5) · [Cash App goal-met ring](https://mobbin.com/screens/aefd8bc7-d9e1-480e-ac83-10a05700674b) · [Venmo referral progress bar](https://mobbin.com/screens/3c0a90a9-01b8-45eb-ad36-ce52da9c7e6b) | Added a day-progress bar above the streak pips (Venmo-style), a dedicated flame badge next to the streak title with a "Day N of 7" caption, and swapped the final bonus-day pip for a gift icon so the streak reward reads clearly instead of just a number. | [before](../screenshots/cash-activity/thread-cash-before-390x844.png) (same screen, streak card) | [after](../screenshots/cash-activity/thread-cash-after-390x844.png) |
| Thread Cash — daily check-in celebration (`components/thread-cash/CheckInSheet.tsx`) | [Cash App "Distribute paycheck" progress ring](https://mobbin.com/screens/5e07a78d-e7bf-42cd-a414-ca1683ca4ff5) · [Cash App "Goal met" ring](https://mobbin.com/screens/aefd8bc7-d9e1-480e-ac83-10a05700674b) | Added an animated SVG progress ring (react-native-svg `Circle` + `strokeDashoffset`) around the flame badge that fills to the buyer's day-in-cycle fraction as the sheet opens, instead of a flat colored circle — real visual delight on the moment that matters most. | (modal, reached via daily check-in — see confirm/success flow note below) | [after](../screenshots/cash-activity/thread-cash-checkin-celebration-after-390x844.png) |
| Thread Cash — send to a friend (`components/thread-cash/ChatAttachThreadCash.tsx`, `ThreadCashAttachButton`) | [Wealthsimple/Wise amount pad → Next](https://mobbin.com/screens/094cf8a7-a08e-4a4e-8ea6-cb7ef75a7ab2) · [Revolut "Review transfer"](https://mobbin.com/screens/56a5f862-10d8-43a9-b8c4-dd3ada2b1553) · [Revolut sent-in-chat bubble](https://mobbin.com/screens/2a4195e0-605e-4215-9091-7b885783635e) | Was a single amount-pad screen that sent immediately on tap. Rebuilt into a proper Apple-Cash-style 3-step flow in the same bottom sheet: **amount pad** (recipient name shown, sheet handle, shared `Button`) → **review/confirm** (gift icon, big amount, recipient, note, a plain-language "not real money / 14 days to claim" footnote — Revolut's "review transfer" pattern) → **success** (spring-scaled checkmark badge + "Done" button). The actual `api.threadCash.send()` call and its recipient/amount/idempotency payload are unchanged — only *when* in the flow it fires (now after an explicit review step) and how the result is presented. | [before (amount-only sheet)](../screenshots/cash-activity/thread-cash-send-amount-after-390x844.png) reflects the original single-step layout's amount screen, now restyled | [amount](../screenshots/cash-activity/thread-cash-send-amount-filled-after-390x844.png) · [review/confirm](../screenshots/cash-activity/thread-cash-send-confirm-after-390x844.png) · [sending](../screenshots/cash-activity/thread-cash-send-loading-after-390x844.png) |
| Activity Center (`app/activity-center.tsx`) | [Instagram Activities feed (grouped, follow-back rows)](https://mobbin.com/screens/e221ae52-7018-4e38-b3cb-d4873c2aa83b) · [TikTok Inbox rows](https://mobbin.com/screens/1c9fbd6f-ef59-4ccd-b7b1-9dc953cec274) | Reviewed against Instagram/TikTok activity patterns — already matches: grouped sections, avatar stacking with a "+N" chip, swipe-to-dismiss, inline follow-back, skeleton rows (not a spinner), themed empty/error states, all built from shared `Chip`/`PressableScale`/`SwipeActionRow`. No rebuild needed; left as-is. | [before](../screenshots/cash-activity/activity-center-before-390x844.png) | [after](../screenshots/cash-activity/activity-center-after-390x844.png) (unchanged) |
| Buyer Notifications (`app/buyer-notifications.tsx`) | [TikTok Inbox rows with colored icon badges](https://mobbin.com/screens/1c9fbd6f-ef59-4ccd-b7b1-9dc953cec274) | Reviewed against reference: category pills, dated sections, per-type icon + color, unread rail + dot, long-press options sheet (`BottomSheet`/`ListRow`) are already in place and match the reference quality bar. No rebuild needed; left as-is. | [before](../screenshots/cash-activity/buyer-notifications-before-390x844.png) | [after](../screenshots/cash-activity/buyer-notifications-after-390x844.png) (unchanged) |
| Your Activity (`app/buyer-your-activity.tsx`) | [Instagram Activities](https://mobbin.com/screens/e221ae52-7018-4e38-b3cb-d4873c2aa83b) | Already uses the `Card`/`ListRow`/skeleton primitives with a clean stat grid; matches the bar. No rebuild needed; left as-is. | [before](../screenshots/cash-activity/buyer-your-activity-before-390x844.png) | [after](../screenshots/cash-activity/buyer-your-activity-after-390x844.png) (unchanged) |

## Notes

- **Dev preview data**: `app/thread-cash.tsx` now shows clearly-labeled
  placeholder balance/history ("Preview data — not your real balance") when
  running under `?bt_preview=buyer` in dev web preview, mirroring the
  existing `isSellerDevPreview` pattern already used in `app/boost.tsx`. It
  never runs outside `__DEV__` web preview and never touches a real signed-in
  buyer's data or the real API call path.
- **Environment limitation**: this sandbox's egress proxy blocks
  `*.clerk.accounts.dev` (org policy), so a real signed-in session couldn't
  be reached to screenshot populated Activity Center / Notifications data or
  the live send-money success state end-to-end. Those three screens were
  therefore verified by code review against the Mobbin references (they
  already build from the shared component library and already have
  skeletons/empty states) rather than rebuilt; the send-flow's amount/review
  steps and the check-in ring were screenshotted through an isolated,
  temporary dev-only harness route that was deleted before committing.
- **Shared components used, none forked**: `BrandthreadCard`, `EmptyState`,
  `SkeletonBlock` (from `components/ui`), and `Button` (from
  `components/ui`) — the send-flow's "Next"/"Send"/"Done" actions now use the
  shared `Button` instead of one-off `TouchableOpacity` styling.
- All 12 themes read colors via `useAppTheme()` / `theme.*` — nothing
  hardcoded.
