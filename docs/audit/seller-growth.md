# Seller growth — screen audit (7/10)

Seller preview harness (`bt_preview=seller`, 393×852), fresh and `demo=1`, plus code read of every screen. 54 screens · 362 findings · 266 [FIXED] · 96 open.

**Analytics** (`artifacts/mobile/app/(tabs)/analytics.tsx`)
- [FIXED] Visits / Revenue tiles were not equal columns: the Revenue wrapper was `flex: 1` without `minWidth: 0`, so a long revenue value widened it at the Visits tile's expense. Both cells now share `statCell: { flex: 1, minWidth: 0 }`.
- [FIXED] If the first `GET /api/analytics/home` failed, the error was swallowed and the tab showed "0" visits and "$0.00" revenue as if they were real numbers. A failed first load now shows `ErrorState` ("Couldn't load analytics." + Retry) in place of the tiles and chart. A failed refresh still keeps the last good numbers.
- [FIXED] The tab padded for the floating bar through `useReportBottomInset()` (an InsightFrame helper) and did not use the tab-screen helper `useTabBarClearance(2)`. It now calls `useTabBarClearance(2)` directly. Same value, and `header-clearance-sweep` now passes for this file.
- [FIXED] Chart heights were magic numbers inline (`140 : 120`). They are now the `CHART_HEIGHT` / `EMPTY_CHART_HEIGHT` constants with a `chartEmpty` flag, which the Analytics-tab test expects.
- [FIXED] Reports list: "Customer cohorts and lifetime value" used the same `users` icon as "Audience" two rows above. Changed to `pie-chart` (components/analytics/AnalyticsReportsList.tsx).
- `CHART_TITLE` ("Revenue by hour/day/month") is defined but never used, so the chart card always says "Revenue", the same as the Revenue tile beside it. Not fixed: `tests/seller-profile-analytics-layout.test.ts` pins `<SectionTitle>Revenue</SectionTitle>`.
- Dead code: unused imports (`getSalesAnalytics`, `saveFilterState`, `DATE_RANGE_OPTIONS`, `Feather`, `TouchableOpacity`, …) and unused styles (`advancedRow`, `proChip*`). Not user-facing, so left alone.

**Advanced analytics** (`artifacts/mobile/app/analytics-advanced.tsx`)
- [FIXED] Report screen bottom clearance was doubled: the stack scene already adds the seller-bar clearance as a margin, and InsightFrame / the Pro gate added `useTabBarClearance(2)` again. This left a blank band of about 160px under "Top customers" (demo, Month). `useReportBottomInset()` now returns `SP.lg` (components/analytics/InsightFrame.tsx). The same fix applies to every InsightFrame screen.
- [FIXED] The "Repeat buyers" KPI tile showed a bare "—" under the value (no delta available). It now shows a real caption, e.g. "48 returning", from `totals.repeatBuyers`.
- [FIXED] Pro gate (fresh account): "See plans" opened `/plans` without Pro preselected, unlike every other Pro lock. It now uses `proUpgradeHref('analytics-advanced')`, i.e. `/plans?highlight=pro&source=…`. The gate title "Included with Pro" now has `accessibilityRole="header"`.
- [FIXED] The end-of-line dot on the "Average order value" line chart was cut in half by the SVG's right edge. Added a 4px right inset to `InsightLineChart` (components/analytics/InsightCharts.tsx). Also fixes the Views and Follower growth charts.
- This Pro gate ("Included with Pro" / "See plans", custom layout) differs from the Pro lock on Customer cohorts and Customer analytics (`ProLockedState`: "… is a Pro feature" / "See Brandthread Pro"). Unifying them is a product/design decision.
- "Conversion" shows "+0.0%" when the change is zero (TrendChip in AnalyticsKit.tsx). AnalyticsKit is shared with growth-links / link-in-bio, so not edited.
- InsightFrame's RefreshControl is hard-wired to `refreshing={false}`, so pull-to-refresh snaps back at once with no spinner while reloading. Left as is: it needs a `refreshing` prop threaded through every report, including group B's.

**Audience** (`artifacts/mobile/app/analytics-audience.tsx`)
- [FIXED] "Top regions" rows used raw codes for the country ("CA, US", "NY, US"). They now use the screen's own `countryName()`: "CA, United States", matching "Top locations".
- [FIXED] The footnote "Groups with fewer than 5 people are hidden." was body copy at FS.xs (11, which is reserved for badges). Now FS.meta (12).
- [FIXED] Double bottom clearance: a large empty band below the footnote at the end of the scroll (demo, Month). Fixed through InsightFrame (see Advanced analytics).
- [FIXED] Follower growth chart: the last-point dot was clipped at the right edge (InsightCharts inset).

**Customer cohorts** (`artifacts/mobile/app/analytics-cohorts.tsx`)
- [FIXED] Fresh account: the "Customer cohorts" card rendered only a header row ("Month New Repeat Revenue") with no rows, and a loose centred note under it. When there are no cohort customers it now shows one card with "Cohorts fill in as customers place orders.".
- [FIXED] The error state said "Couldn't load advanced analytics." on the Customer cohorts screen. It now says "Couldn't load customer cohorts.".
- [FIXED] The Pro lock used the default title "Advanced analytics is a Pro feature" and upgrade source `analytics-advanced`. It now uses "Customer cohorts are a Pro feature" and source `analytics-cohorts`.
- [FIXED] The cohort column "New" actually holds the cohort's customer count. It is now headed "Customers". Header labels moved from FS.xs to FS.meta.
- [FIXED] Hard-coded `paddingBottom: 120` on top of the stack-scene bar clearance left a double gap. Changed to `SP.lg`.
- The "Average order value" card puts its SectionTitle inside the card, while "Customer cohorts" puts it above the card. Mixed idiom within one screen, left as is (layout change).
- The exported component is named `AnalyticsAdvancedScreen` (copy-paste name). Cosmetic, left as is.

**Threads and videos** (`artifacts/mobile/app/analytics-content.tsx`)
- [FIXED] Double bottom clearance: a large empty band under "By format" at the end of the scroll (demo, Month). Fixed via InsightFrame.
- [FIXED] Views chart: the last-point dot was clipped at the right edge (InsightCharts inset).
- Header title is "Content Analytics" (Title Case). The Reports row and the Export section that open it say "Threads and videos", and other reports use sentence case. Not fixed: `e2e/seller-dashboard-fixes.spec.ts:263` asserts the header text `['Content Analytics']`. Needs that spec updated together with the title.
- Compact numbers use an upper-case K ("12.6K", "$3.2K" from lib/compactFormat) while chart axes on the same screen use a lower-case k ("$1.2k"). This is a shared lib, so not edited.

**Customer analytics** (`artifacts/mobile/app/analytics-customers.tsx`)
- [FIXED] In the seller preview (fresh and demo) the screen showed only "Couldn't load customer analytics." + Retry, because it had no preview branch and the preview `serviceRequest` throws. It now follows the other reports: fresh gives real zeros and an empty Top customers list, and `&demo=1` gives a small sample (inside `isPreviewDemoMode()` only).
- [FIXED] "Cohort retention" and "Top locations" always rendered as an empty header strip and an empty bordered card. `getCustomerAnalytics` always returns `cohorts: []` / `topLocations: []`. Both sections now render only when they have rows.
- [FIXED] Title Case and abbreviations: the header "Customer Analytics" is now "Customer analytics". Section titles changed from "Top Customers / Cohort Retention / Top Locations" to sentence case. Overview labels came from the service as "Total Customers", "Returning Customers", "Repeat Rate", "Avg. Orders per Customer" and are now "Customers", "Returning customers", "Repeat rate", "Orders per customer". Cohort headers changed from "M+1/M+2/M+3", "Avg LTV" to "Month 1/2/3", "Lifetime value".
- [FIXED] The "Lifetime value" cohort cell was drawn in `colors.warning` (orange) for no reason. Now `colors.foreground`.
- [FIXED] The hard-coded 120px bottom spacer doubled the stack-scene clearance (now `SP.lg`). Content had no top padding under the header (now `SP.sm`). The customer row meta changed from FS.xs to FS.meta.
- Retention cells (when the API ever returns cohorts) are coloured green/orange/red by `retColor`, outside the monochrome palette. Left as is: semantic heat colours are a design decision.
- The screen is only reachable from Customers, not from the Analytics Reports list. Product decision.

**Export** (`artifacts/mobile/app/analytics-export.tsx`)
- [FIXED] The range pills at the top had no label, while the other two groups are labelled "Include" and "Format". Added the section title "Date range".
- [FIXED] With every section unchecked, "Export CSV" just went disabled with no explanation. It now shows "Select at least one section to export." above the button.
- [FIXED] When sharing is unavailable, the alert title was "Export ready" even though nothing was delivered. Now "Couldn't share export".
- [FIXED] Row descriptions ("One row per order with totals…") were body copy at FS.xs. Now FS.meta. The double bottom inset was removed via `useReportBottomInset()`.
- The range control here is the equal-width `SegmentedPills`. Every other report uses the Dashboard's `SellerDashboardRangePills`, so the same Today/Week/Month/Year/All control looks different on this screen. Left as is (visual change).

**Goals** (`artifacts/mobile/app/analytics-goals.tsx`)
- [FIXED] Goal editor sheet (Add goal / Edit goal): Period pills read "week / month / quarter / year" in lower case, because "This " was stripped from the labels. Now "Week / Month / Quarter / Year".
- [FIXED] For non-revenue measures (Orders, Units sold, Visits, New followers), the Target input used a `decimal-pad` keyboard although the value is rounded to a whole number. Now `number-pad`. Revenue keeps `decimal-pad`.
- [FIXED] Off-scale goal amount: `fontSize: 28` changed to `FS.xxl` (26). The progress bar margin `SP.sm + 2` (10) changed to 12. The "of $12,000.00  ·  64%" line had double spaces around the dot; now single.
- [FIXED] The card accessibility label "Edit Revenue goal" dropped the period, so two Revenue goals sounded identical. Now "Edit goal: Revenue this month".
- [FIXED] Double bottom clearance under "Add goal" (fixed via InsightFrame).
- In the editor the disabled "Add goal" button (empty target) renders as plain grey text with no button shape (`PrimaryButton` disabled style in components/BrandthreadUI.tsx). Shared component, not edited.
- `STATUS_TEXT.not_started` = "Just started" reads oddly for a goal with no progress. Needs product wording.

**Marketing Analytics** (`artifacts/mobile/app/analytics-marketing.tsx`)
- `getMarketingAnalytics()` in services/analyticsService.ts always rejects ("Marketing analytics are not available yet"), so every visit, fresh or demo, shows "Couldn't load marketing analytics." with a Retry button that can never succeed. Left as is: it needs the endpoint or a product decision to hide the route. services/ is outside this group.
- [FIXED] Hero "Marketing Revenue" change line always showed a trending-up icon, green colour and a hard-coded "+" prefix, so a drop would read "+-5.0% vs prev period". The icon, colour and sign now follow the sign of the change, and "prev" now reads "previous".
- [FIXED] Influencer avatar initial used `name.slice(1, 2)`, which assumes an "@handle". A name like "Maya" showed "A". Now the leading "@" is stripped and the first letter is used.
- [FIXED] Jargon and abbreviations: campaign rows "…/rec." became "…/recipient". Influencer rows "4.2× ROC" became "4.2× return". "Abandoned cart recovered:" became "Recovered from abandoned carts".
- [FIXED] Campaign rows are tappable TouchableOpacity rows but had no accessibilityRole or label. They now have role "button" and a label with the name and revenue.
- [FIXED] Off-scale styles: the hero value used fontSize 40 and now uses FS.h1 (36). Gaps and margins of 5/6/4 px in the bar label row, hero change row and recovered row now use SP.xs.
- [FIXED] A 120px bottom spacer added a second tab-bar clearance on top of the stack scene's clearance, leaving a large dead gap after the Referral Program card. It is now SP.lg.
- Tapping any campaign row navigates to the Marketing tab, not the tapped campaign, because no campaign-detail route covers email/SMS/push/automation. Needs a product decision.
- Revenue-by-channel bars repeat colours: Discounts and Influencers both use `warning`, and Automation and Referrals both use `info`. They also use non-monochrome status colours, against the black/white/silver palette. Left as is: it needs a design decision on the series palette.

**Product stats** (`artifacts/mobile/app/analytics-product-stats.tsx`)
- [FIXED] Top products row subtitle "1,895 views · 218 carts · 70 sold" was cut off in every row ("… 218 carts · 7…"), so the sold count was never visible. Seen in demo with Month selected; the probe flagged 4 clipped rows. The subtitle is now "views · sold". Cart counts are still shown in the Funnel card.
- [FIXED] Funnel rates had no labels and had stray double spacing ("519  ·  11.5%", "166  ·  32%"), so it was unclear what each % was a share of. They now read "519 · 11.5% of views" and "166 · 32% of carts". The removed `pct` helper's "—" placeholder no longer appears.
- [FIXED] Empty state ("No product activity", the default Today range, shown in fresh and demo on open) only said "…for this period show here." with no next step. It now says "No product views, add-to-carts or purchases in this period. Try a longer range." On the All range it uses wording that does not suggest a longer range.
- KPI trend chips ("+2.0% vs last month") render in green (rgb 127,240,176), which is non-monochrome. Left as is: they come from the shared KpiGrid/TrendChip in components/analytics (group A).
- Top-product value label uses the abbreviation "3.7% conv.". Left as is: the same idiom is used across the shared RankedRow screens and changing it needs a cross-screen copy decision.

**Production Analytics** (`artifacts/mobile/app/analytics-production.tsx`)
- `getProductionAnalytics()` always rejects ("not available yet"), so fresh and demo both show "Couldn't load production analytics." with a Retry button that never succeeds. Left as is: it needs the endpoint or a product decision.
- [FIXED] Header pill used the abbreviation "Mfr. Hub". It is now "Suppliers", the term the Manufacturer Hub itself uses ("Compare Suppliers"). It is short enough not to squeeze the "Production Analytics" title.
- [FIXED] Manufacturer card stat label "Sample ok" had inconsistent casing. It is now "Samples OK".
- [FIXED] Manufacturer cards were spaced 16px apart: the wrapper's `gap: SP.sm` and each card's `marginBottom: SP.sm` both applied. The wrapper gap is removed.
- [FIXED] Manufacturer cards are tappable (they open the manufacturer profile) but had no accessibilityRole or label. Both are added.
- [FIXED] The 120px bottom spacer doubled the stack scene's tab-bar clearance and is now SP.lg. Header row margin `SP.sm + 2` (10, off-scale) is now `SP.sm + 4`.
- Card spend and unit cost are built as "$" + toLocaleString() ("$12,000", "$8.5/unit avg"), not with formatCents like the rest of analytics. Left as is: the endpoint does not exist yet, so the units of `totalSpend`/`avgUnitCost` are unknown.

**Product Analytics** (`artifacts/mobile/app/analytics-products.tsx`)
- [FIXED] Every product row showed a grey "—" status pill. The service maps `inventoryStatus` from /api/analytics/products, which does not return it, so `statusLabel` fell through to "—". The pill now renders only when a real stock status is known.
- [FIXED] The list's section title only repeated the selected pill ("Revenue" / "Units") above a product list. It now reads "Top products by revenue" / "Top products by units".
- [FIXED] Product rows had no accessibilityRole or label. They now have role "button" and a label with name, revenue and units. The productId is now URL-encoded, and the row opens the product's Analytics tab (`&tab=analytics`), the same as the Product stats rows.
- [FIXED] Off-token spacing: row horizontal padding `SP.sm + 2` (10) is now `SP.sm + 4`, and status pill padding 7 is now SP.sm. The units count now has thousands separators. The 120px double-clearance spacer is now SP.lg.
- Row thumbnails are always a generic package icon. The service does not map product images, and services/analyticsService.ts is outside this group.

**Profit & Payout** (`artifacts/mobile/app/analytics-profit.tsx`)
- `getProfitAnalytics()`/`getPayoutAnalytics()` always reject, so both the Profit and Payouts tabs always show "Couldn't load profit data — Tap to retry" / "Couldn't load payout balance — Tap to retry" (fresh and demo). Left as is: it needs the endpoints.
- The retry row reads "— Tap to retry" with a capital T after the em dash. Left as is: it comes from the shared components/ui/RetryRow.tsx, which ~10 screens outside this group import.
- [FIXED] The hero margin line ("x% margin") was always green, even for a negative margin. It is now red when the margin is below 0.
- [FIXED] The "Est. Profit" total row amount was amber (`warning`), making the bottom line look like a warning. It now uses foreground.
- [FIXED] Note casing was inconsistent: the breakdown said "estimate" and the payout rows said "est.". Both now read "Estimate". The hero disclaimer now ends with a period like the payout disclaimer.
- [FIXED] Hero value fontSize 44 (off-scale) is now FS.h1. The 120px double-clearance spacer is now SP.lg.
- Breakdown amounts are built as "$" + toLocaleString() ("−$1,200"), not with formatCents. Left as is: the endpoint does not exist and the units are unknown.

**Sales Analytics** (`artifacts/mobile/app/analytics-sales.tsx`)
- [FIXED] The Orders / Units / Avg order / Refunds chart pills always rendered an empty chart area with only "Start … Today" under it, because the service returns `[]` for those series. Sales did the same for a period with no sales. The chart now shows "No <series> data for this period." when the series is empty.
- [FIXED] The 120px double-clearance spacer is now SP.lg. The hard-coded 16px padding on the breakdown empty text is now SP.md.
- "By Product" always shows "No product breakdown is available for this period." because the service hard-codes `breakdown: []`. "Revenue Breakdown" holds a single Gross Sales row, and the service's `orders` metric is never shown. Left as is: it needs service/API work.
- Chart x-axis labels are always "Start" / "Today" whatever the saved filter range, and the screen has no range control. Left as is: it needs a product decision.

**Store Analytics** (`artifacts/mobile/app/analytics-store.tsx`)
- `getStoreAnalytics()` always rejects, so the screen always shows "Couldn't load store analytics." with a Retry button that never succeeds. This screen is reachable: the seller Home dashboard's Traffic sources "See all" and its source rows (components/SellerHomeCommerceDashboard.tsx) push /analytics-store, so a real seller hits a dead end. Left as is: it needs the endpoint or a re-target of that link outside this group.
- [FIXED] Section rows used the jargon "x% CTR". They now say "x% click rate", matching the "Click rate" wording on Page stats.
- [FIXED] Store section rows (chevron, they open Store Sections) had no accessibilityRole or label. Both are added.
- [FIXED] Funnel and section row vertical padding `SP.sm + 3` (11, off-scale) is now `SP.sm + 4`. The 120px double-clearance spacer is now SP.lg.

**Post Analytics** (`artifacts/mobile/app/post-analytics.tsx`)
- [FIXED] The "Boost Post" button text was invisible. It sits on `colors.gradient`, which is #FFFFFF→#FFFFFF in the default monochrome theme, and the text used `colors.text` (#FFFFFF), white on white. The label now uses primaryForeground like its icon.
- [FIXED] The "Back" quick action's arrow icon used primaryForeground (#000000) on a black card, so it was invisible. It now uses colors.text.
- [FIXED] The loading state ("Loading post…") had no header or back arrow and used unstyled 16px system-font text. It now keeps the "Post Analytics" header and back arrow, and shows "Loading stats…" in Inter at FS.base.
- [FIXED] The error state said "Pull to refresh or try again." but the screen has no pull-to-refresh. With no `id` param, "Try again" was a dead tap. The copy is now "Check your connection and try again." A missing id shows "Post not found / Open stats from one of your posts." with no dead button.
- [FIXED] Several Text styles had no fontFamily (caption, type badge, hero labels, row details, info note, loading text), so they fell back to the system font instead of Inter. Sizes 14/16 were off the type scale. They now use FONT.* and FS.sm/FS.base/FS.meta. The 11px detail copy is raised to FS.meta (12), per the theme's body-copy floor.
- [FIXED] A post with no caption showed a blank line in the preview card. It now shows "No caption" in muted text.
- [FIXED] The "Average watch time" row ("Not tracked / Shown after valid watch-time events are recorded") showed on photo posts, where it can never apply. It now shows only for video posts or when retention is tracked.
- [FIXED] Developer-ish copy rewritten: "From non-cancelled attributed orders" became "From orders placed through this post, excluding cancellations". "N watch samples" became "Based on N views". The info note "Unavailable metrics are labeled “Not tracked.” Brandthread never estimates post performance." became "Metrics marked “Not tracked” have no recorded data for this post yet. We never estimate post performance." The note's text now has flex: 1 so it wraps beside the icon.
- [FIXED] The Boost and Back quick-action TouchableOpacitys had no accessibilityRole. Role and label are added. `paddingBottom: 120` doubled the scene's tab-bar clearance and is now SP.lg.
- The header's right side shows a static, non-tappable "Live" pill styled like the range buttons on other analytics screens. It reads as a control or a live-stream badge. Needs a product decision to remove or reword.
- The "Back" quick action duplicates the header back arrow. The retired layout had "Share Results" there. Needs a product decision.
- The preview thumbnail is a flat colour gradient even though the response includes `post.mediaUrl`. Left as is: rendering media (including video posters) is more than a surgical fix.
- About 200 lines of commented-out "retired demo analytics layout", plus unused helpers and state (EngagementBar, CountryBar, RetentionChart, formatPeakHour, activeRange/cycleRange, headerTopInset), are still in the file. Left for a dedicated cleanup.
- Remaining off-token spacing in the live layout: card padding 14, grid/action gaps 10, radii 14/16. Left as is: changing it means retuning the hero-card width maths, which is beyond a surgical pass.

**Page stats** (`artifacts/mobile/app/link-in-bio-stats.tsx`)
- [FIXED] All counts (tiles, per-link clicks, referrers, countries) were rendered with `String(n)`, with no thousands separators ("12345"). They now use toLocaleString().
- [FIXED] When only "Shop my store" / "Featured products" had clicks (no custom links), the last row kept its bottom divider inside the card. `last` is now computed for those rows.
- [FIXED] The error state used ErrorState's generic "Something went wrong. Please try again." and sat at the top of the screen instead of centred. It now reads "Couldn't load page stats." and fills and centres in the remaining space.
- [FIXED] `paddingBottom: 140` doubled the stack scene's tab-bar clearance. It is now SP.lg.
- The "Last 30 days" note only appears under "Clicks per link". The Views / Clicks / Click rate tiles above it, which use the same 30-day window, carry no period. Left as is: a layout or product choice where to state it.
- "Top countries" shows raw ISO codes from the API ("US", "PT" in the demo fixtures) rather than country names. Left as is: it needs an API/formatting decision.

**Marketing** (`artifacts/mobile/app/(tabs)/marketing.tsx`)
- [FIXED] Stat row labels "Email Subs" / "SMS Subs" are abbreviations in title case (both states). Renamed to "Email subscribers" / "SMS subscribers".
- [FIXED] Campaigns empty state said "Create a Meta ad to put your products in front of new buyers.", but both "Create a campaign" and "New +" open /design-campaign, which is the in-app "Create Ad" flow. Running on Meta is only a secondary link on that screen. Copy changed to "Create an ad to put your products in front of new buyers."
- [FIXED] Section titles used mixed casing: "Discount Codes" and "Referral Program" next to "Reach your followers", "Growth" and "Email". Both now use sentence case ("Discount codes", "Referral program").
- [FIXED] The Growth list card (Links / Link in bio / Pixels) had no bottom margin, so the "Email" section header sat about 4px under it while every other card has 24px. Added `marginBottom: 24`.
- [FIXED] The header "View analytics" icon rendered about 11px above the title's centre line. PressableScale had no size and was 20x44 with the icon pinned to the top. Gave it a centred 44x44 box (`styles.headerIconBtn`, COMP.iconBtn).
- [FIXED] The Klaviyo CTA had awkward Title-Case copy with a colon ("Connect Klaviyo: Email Marketing & SMS") and no accessibilityRole. Copy is now "Connect Klaviyo for email and SMS" with role=button.
- [FIXED] Campaign rows (populated state) and the "Invite and earn" referral card had no accessibilityRole or label. Added role=button plus labels (campaign headline, status and budget; "Invite and earn").
- [FIXED] Tapping the discount-code copy icon gave no visual confirmation. The icon now switches to a check for 1.5s, and its a11y label reads "Code X copied".
- [FIXED] Referral earnings used `$${(cents/100).toFixed(0)}`, which rounds $10.50 to "$11" and skips the money formatter. Now uses `formatCents`.
- Both "New +" section actions expose the same accessibility name "New +", because SectionHeader uses the action text as its label and has no label prop. Left unfixed: SectionHeader is a shared component with importers outside group C.
- When Klaviyo is not connected, the subscriber stats show "0" rather than "—" or a prompt, which reads as a real zero count. Left unfixed: product decision.
- "Follower push" and "Giveaways" are two separate cards 24px apart, while the Growth links are grouped in one list card, so the grouping is inconsistent. Left unfixed: changing it is layout rework.

**Automation** (`artifacts/mobile/app/automation.tsx`)
- [FIXED] The "Back to dashboard" button called `goBackOr(router)`, so it popped to whichever screen pushed it (for example Marketing) instead of the dashboard. It now does `router.navigate('/(tabs)')`, and the unused goBackOr import is removed.
- The copy "Automations are coming" / "Soon you'll set restock alerts, win-backs and more." is a promise of future features, and the description wraps to a lone "more." line. Left unfixed: the file is on `tests/no-coming-soon-lint.test.ts`'s allowlist, so rewriting it means deleting that allowlist line too, and the test is outside my file list.
- The route has no entry point: nothing in app/, components/ or lib/ navigates to `/automation`. Left unfixed: whether to delete the screen or link it is a product decision.

**Rewards** (`artifacts/mobile/app/loyalty.tsx`) — buyer screen. In the seller preview it shows only "Couldn't load your rewards", so I also rendered it with a buyer-role copy of the harness.
- [FIXED] The loading state was a bare spinner with no ScreenHeader, so there was no back arrow or title until data arrived. It now renders the "Rewards" header above the spinner. The now-unused `useHeaderTopInset` was removed.
- [FIXED] "How to earn" mixed "1 point per $1 spent" with the abbreviations "500 pts per referral" and "100 pts on sign-up". All three now say "points".
- [FIXED] The zero-balance state said the same thing twice. The hero says "Earn your first points by making a purchase or referring a friend." and the bottom empty block repeated it under an uppercase "NO POINTS YET" title, because the title inherited the sectionLabel style. The bottom block now explains the history list ("No activity yet" / "Points you earn and redeem show up here.") in sentence case.
- [FIXED] Mid-sentence capital letters: "Use points in Cart" and "Choose your points in Cart…". Now "Use points in cart" and "…in your cart…".
- [FIXED] Title-Case alert titles: "Minimum 100 Points" became "Minimum 100 points" and "Insufficient Points" became "Not enough points".
- [FIXED] The redeem button had no accessibilityRole, label or disabled state, and the points TextInput had no accessibilityLabel. Added them.
- Inside the "REDEEM POINTS" section, the card's field label is a second uppercase label ("POINTS TO REDEEM (MIN 100)"), which reads as two stacked headers. The `redeeming` state is never set to true, so it is dead code. Left unfixed: low impact.

**Email campaigns** (`artifacts/mobile/app/email-campaigns.tsx`)
- [FIXED] The header said "Email" while the Marketing entry card is titled "Email campaigns". The header is now "Email campaigns".
- [FIXED] The scroll content added `insets.bottom + 140` bottom padding on top of the stack-scene tab-bar clearance (ScreenChrome), leaving a large dead area under the list. Changed to `SP.xl`, and the unused safe-area import was removed.
- [FIXED] The empty campaign list was a bare "No campaigns yet." with no next step. It now reads "No campaigns yet. Tap New campaign to write your first email."
- The "Email sending isn't set up yet. Drafts are saved and nothing is sent." notice (fresh state) has no action or link, so the seller cannot do anything about it. Left unfixed: sending is set up at platform level, and there is no seller-side route to link to.

**New campaign / Edit campaign** (`artifacts/mobile/app/email-campaign-compose.tsx`)
- [FIXED] Data-loss bug: when loading an existing campaign failed, it showed an Alert and then left an empty, editable "Edit campaign" form, and "Save draft" would overwrite the stored campaign with blanks. It now shows a RetryRow screen ("Couldn't load this campaign") with a working retry (`reloadToken`).
- [FIXED] Double bottom padding (`insets.bottom + 140` on top of the scene clearance) left about 140px of empty scroll under "Save draft" (fresh, frame 3). Changed to `SP.xl`.
- [FIXED] When sending is off, the full "Email sending isn't set up yet…" message appeared twice: in the top Notice and again as the Send-section hint. The hint is now the short "Sending is unavailable until email is set up."
- [FIXED] In a live account the email preview header always said "YOUR STORE" and ignored the seller's saved sender name. It now uses `settings.fromName` (falling back to defaultFromName). Demo mode uses the demo sender.
- [FIXED] The loading state header said "Campaign" and then jumped to "Edit campaign". It now says "Edit campaign" throughout (loading only happens when an id is present).
- [FIXED] The schedule option "Tomorrow at 9:00" used a 24-hour format unlike the rest of the app. It now reads "Tomorrow at 9 AM".
- [FIXED] Product prices in the preview used a hand-rolled `$${(c/100).toFixed(2)}`. Now uses `formatCents`.
- [FIXED] Opening a demo draft did not load its button label or link into the CTA fields. The live path did. The demo branch now sets them too.
- "Schedule" and "Send now" share `busy === 'send'`, so both buttons show a spinner during either action. Left unfixed: minor.

**Campaign results** (`artifacts/mobile/app/email-campaign-results.tsx`)
- [FIXED] Endless spinner: with no `id`, or an id that is not in the preview fixtures (fresh state), the screen spun forever (verified in the fresh render). It now shows "This campaign couldn't be found."
- [FIXED] The scheduled time used `toLocaleString()`, which includes seconds ("4/12/2026, 9:00:00 AM") and differs from the "Mar 3, 2026" format used for sent dates. Now month, day and time without seconds.
- [FIXED] Stat numbers used an off-scale `fontSize: 28`. Now `FS.xxl` (26).
- [FIXED] The unschedule failure alert was titled "Not changed". It is now "Schedule not cancelled" with "Try again." added.
- [FIXED] The generic header "Results" is now "Campaign results". A campaign with an empty subject rendered a blank heading and now falls back to "Untitled campaign", matching the list.
- [FIXED] Double bottom padding (`insets.bottom + 140`). Changed to `SP.xl`.
- "Cancel schedule" cancels right away with no confirmation. Left unfixed: needs a product decision on confirmation copy.

**Audience** (`artifacts/mobile/app/email-audience.tsx`)
- [FIXED] The headline count used an off-scale `fontSize: 44`. Now `FS.h1` (36).
- [FIXED] The segment labels "Also ordered" / "Also follow you" were cryptic. Now "Have ordered from you" / "Follow you".
- [FIXED] The suppression line "N unsubscribed · N bounced (never emailed again)" read like a developer note. Now "…bounced. These addresses won't be emailed again."
- [FIXED] On a device without the share sheet (for example web), "Export CSV" did nothing at all. It now alerts "Sharing isn't available on this device."
- [FIXED] Double bottom padding (`insets.bottom + 140`). Changed to `SP.xl`.
- The API's `hasMore` is ignored. "Recent signups" silently shows only the first page, with no "load more" or total. Left unfixed: needs a pagination API decision.

**Sender details** (`artifacts/mobile/app/email-settings.tsx`)
- [FIXED] "Save" accepted any text in "Reply-to email" (for example "hello") and relied on a server error. It now checks client-side and alerts "Check your reply-to email / Enter a full email address, like hello@yourstore.com."
- [FIXED] Double bottom padding (`insets.bottom + 140`). Changed to `SP.xl`.
- The "Confirm new subscribers by email" toggle title is FS.md (17) semibold, larger than every field label (13), which inverts the form hierarchy. The helper text uses a `marginTop: -8` hack. Left unfixed: needs a design call.
- There is no unsaved-changes guard: leaving with the back arrow drops edits silently. Left unfixed: product decision.

**Follower push** (`artifacts/mobile/app/seller-push-broadcast.tsx`)
- [FIXED] "Past pushes" dates used `formatNextSend` (written for future times), which returns "today at …" for any past date, so a push from last week showed "today at 3:00 PM". Now uses `formatDay`.
- [FIXED] Lead copy "Send one push to your 0 reachable followers" / "1 reachable followers" had bad pluralisation and an awkward zero state. Now it pluralises ("…to 1 follower who can receive it…"), and zero reads "None of your followers can receive a push yet…". The sent banner ("Sent to N followers") is pluralised the same way.
- [FIXED] Developer-ish fallback errors "Could not send." / "Could not review this message." / "Couldn't load your push status." became "Couldn't send this push." / "Couldn't review this push." / "Couldn't load follower push."
- [FIXED] Double bottom padding (`insets.bottom + 140`). Changed to `SP.xl`.
- The "Link" row's value shows only the link type ("Product", "Drop", "Post"), never which item was picked. Left unfixed: the ListRow value does not shrink, so a long product name could overflow, and it needs a layout tweak in the shared ListRow.
- The load-error state is ad-hoc muted text plus a full-width secondary "Try again" button, unlike the RetryRow used on the other screens in this group. Left unfixed: cosmetic. Note that in the harness this screen always shows that error, because `sellerPush.status` fails in the preview.

**Push results** (`artifacts/mobile/app/seller-push-broadcast-results.tsx`)
- [FIXED] With no `id` the screen spun forever (fresh render). It now shows the failure row.
- [FIXED] The failure state was plain text with no way to retry. Now a RetryRow ("Couldn't load these results") with a working `load` callback.
- [FIXED] "Sent today at …" for every past push (the `formatNextSend` misuse described under Follower push). Now `Sent <formatDay>`.

**Connect Meta** (`artifacts/mobile/app/meta-ads-connect.tsx`)
- [FIXED] Not-connected intro card: the body ("Connect your Facebook & Instagram to run real ads…") repeated the title "Run real ads on Facebook & Instagram" word for word. Reworded the body to say what connecting does ("Link your Meta business account to launch and manage campaigns from Brandthread…").
- [FIXED] Picker step, ad-account rows: the subtitle printed Meta's raw numeric `account_status` (e.g. "USD · 1", and the server sends a number). Added `adAccountStatusLabel()` so it reads "USD · Active", "Disabled", "In risk review" and so on.
- [FIXED] Picker step headings used Title Case for common nouns ("Choose your Business", "Choose an Ad Account"). Changed to sentence case, keeping "Facebook Page" because that is Meta's product name.
- [FIXED] Connected state: the check circle was success-green (`colors.success` plus a tint), which breaks the black/white/silver palette. Changed it to `colors.elevated` with a `colors.foreground` icon at `ICON.md` (the size was a hard-coded 22).
- [FIXED] Picker sub-lines and SummaryRow labels ("Business", "Ad account", "USD · Active") were 11pt (`FS.xs`), which is reserved for badges. Raised them to `FS.meta` (12).
- [FIXED] Disconnect failure alert had the generic title "Error". It now reads "Could not disconnect" / "Please try again."
- [FIXED] The ScrollView added `insets.bottom` on top of the stack-scene tab-bar clearance (which already includes the safe-area inset). Changed to `SP.lg` and removed the unused `useSafeAreaInsets`.
- Picker rows (business, ad account and page) are `BrandthreadCard onPress` and have no `accessibilityRole="radio"` or checked state, so screen readers announce no selection. Not fixed: `BrandthreadCard` is a shared component with many importers outside this group.
- If `/meta-ads/connection` fails (for example a network error), the screen falls through to "not connected" and offers Connect Meta again instead of an error with Retry. Not fixed: it needs an extra error step, which is a product decision.

**Run a Meta ad** (`artifacts/mobile/app/meta-ads-setup.tsx`)
- [FIXED] Audience → Min age / Max age steppers: the "−" and "+" were icon-only TouchableOpacitys with no role or label. Added `accessibilityRole="button"` and "Decrease min age" / "Increase max age" style labels.
- [FIXED] Selected interest chips are labelled "Name ✕" and announced as a checked radio. Chip now takes an optional `accessibilityLabel`; removable chips are announced as the button "Remove <interest>".
- [FIXED] When the form was incomplete, the sticky "Launch · $20/day" button sat disabled with no reason given. Added a helper line above it: "Choose what to promote and add a headline to launch."
- [FIXED] The connection-check and resume-draft loading states were a bare spinner with no header or back button. They now render the "Run a Meta ad" ScreenHeader above the spinner.
- [FIXED] Budget section: the reach card used success-green background, border and icon. Changed it to monochrome (`colors.elevated`, `colors.border`, foreground icon at `ICON.sm`).
- [FIXED] Schedule section: the label "Start date (YYYY-MM-DD)" had a placeholder date already in the past ("2026-10-01"), and the label didn't match "End date (optional)". Changed to the label "Start date" with the placeholder "YYYY-MM-DD".
- [FIXED] The section titled "Budget & duration" contains no duration control (Schedule is a separate section). Renamed it "Budget".
- [FIXED] All helper and body copy (`s.helper`: product/video empty text, objective descriptions, rejection reason, launch error) was 11pt. Raised it to `FS.meta`.
- [FIXED] Content was double-padded at the bottom: ScrollView `insets.bottom + 110` above a sticky footer that is in normal flow, and the footer added `insets.bottom` again even though the scene clearance already covers it. Changed to `SP.lg` and `SP.md`, and removed `useSafeAreaInsets`.
- [FIXED] The incomplete-launch alert title "Incomplete" read like developer copy. It is now "Finish your ad" / "Add a headline, budget and creative before launching."
- The ScrollView keeps `gap: SP.xl` (32) between every section, which the harness couldn't show because the meta-ads API isn't seeded. Left as is because it would be layout rework.
- Interest search results and "Start date" are free-text with no validation; an invalid date only fails at launch. Not fixed: needs a date picker or validation rules (product decision).

**Meta Ads** (`artifacts/mobile/app/meta-ads-manage.tsx`)
- [FIXED] Campaign card subtitle showed the raw enum ("$20/day · sales"). It now uses the `META_OBJECTIVE_OPTIONS` label ("$20/day · Sales").
- [FIXED] Pressing any action (Pause, Edit budget, Duplicate, Refresh) turned every action button on the card into a spinner. Added `busyAction` so only the tapped button spins; all of them stay disabled while busy.
- [FIXED] The ROAS stat printed a bare "2.35". It now reads "2.35x".
- [FIXED] Four failure alerts were titled "Error". They are now "Could not pause/resume campaign", "Could not duplicate campaign", "Could not refresh results" and "Could not update budget".
- [FIXED] The Edit budget modal didn't say whether the number was daily or total, or what the minimum was. Added the line "Daily budget / Total budget, in whole dollars (minimum $5)." and gave the input `accessibilityLabel="Budget in dollars"`.
- [FIXED] The initial connection-check state was a bare spinner with no header or back button. It now shows the "Meta Ads" ScreenHeader.
- [FIXED] Card sub-lines, stat labels and action button text were 11pt. Raised them to `FS.meta`.
- [FIXED] The ScrollView added `insets.bottom` on top of the scene clearance. Changed to `SP.lg`.
- If a pull-to-refresh fails, the error EmptyState renders and the old campaign cards stay below it. Not fixed: whether to keep stale rows is a product call.
- A network error on the connection check shows "Connect Meta to run ads" (same as Connect Meta). Not fixed: needs an error state.

**Promote** (`artifacts/mobile/app/boost.tsx`)
- [FIXED] Post picker (demo): tiles with no thumbnail were black-on-black boxes with no border and no Video/Slideshow badge, so only a floating caption showed. Tiles now have a `BORDER` outline and always show the media-kind badge.
- [FIXED] The flow's header switched from "Promote" (step 1 and success) to "Boost" on the budget step. It is now "Promote" throughout.
- [FIXED] The error state for any failure to load posts read "Sign in to continue / Your session may have expired", even for network errors. It now reads "Couldn't load your posts / Check your connection and try again…" with a Retry action.
- [FIXED] Fresh state: the subhead "Only your published videos and slideshows (2+ images) are eligible." repeated the empty-state text right below it. It now shows only when there are posts to pick.
- [FIXED] Copy casing and tone: "Create a Post" is now "Create a post", "Past Boosts" is now "Your boosts" (the list also holds live boosts), and "Boost active!" is now "Your boost is live". The pause/cancel alerts went from "Pause Boost" / "Keep Running" to "Pause boost?" / "Keep running" (and "Keep boost" for cancel), and their messages no longer repeat the title question.
- [FIXED] History row meta used the abbreviation "$25.00 · 7d". It now reads "7 days".
- [FIXED] Selected-post banner: a slideshow with no count rendered "Slideshow ·  images". It now falls back to "Slideshow". The date "9/17/2026" now uses the "Sep 17" format.
- [FIXED] The "Change" link (budget step) had a label but no `accessibilityRole="button"`. Added it.
- [FIXED] Success title used an off-scale font size (`FS.xl * 1.2` = 26.4). Changed to `FS.xxl`.
- [FIXED] Body copy was 11pt in the summary labels, banner meta, history lines, "Put your brand at the top of Discover", the reach disclaimer and the Stripe payment note. Raised it to `FS.meta`.
- [FIXED] Three alerts titled "Error" (create boost, start checkout, update boost) now have specific titles.
- [FIXED] Bottom padding was `insets.bottom + 90` on scroll views. On the budget step that left about 120px of dead space above the sticky footer, which is in normal flow. Changed to `insets.bottom + SP.xl`. Boost is deny-listed from the tab bar, so it still pads its own inset.
- History "Pause"/"Cancel" button has a hit area about 26pt tall (`paddingVertical: SP.xs`). Not fixed: raising it changes card height, which would be layout rework.
- The fallback thumbnail in the selected-post banner still shows a film icon, contradicting the "honest UI" rule used for grid tiles. Not fixed: needs a design decision.

**Featured on Discover** (`artifacts/mobile/app/featured-slot.tsx`)
- [FIXED] When availability failed to load (and in both harness states), the screen was completely blank under the header; the failure was only an Alert titled "Featured". It now renders an inline `ErrorState` ("Couldn't load Featured availability.") with Retry, and the Alert is gone.
- [FIXED] The header read just "Featured". Changed it to "Featured on Discover" to match the Promote entry row.
- [FIXED] Length options used `accessibilityRole="radio"` with `accessibilityState={{ selected }}`, which screen readers ignore for radios. Changed to `checked`.
- [FIXED] The open slot's "Cancel" link had a tap area about 26pt tall and no specific label. Added `hitSlop` 12 and `accessibilityLabel="Cancel Featured slot"`.
- [FIXED] Three alerts titled "Featured" or "Error" now read "Could not start checkout" / "Could not cancel". The confirm alert title is now a question ("Cancel Featured slot?").
- [FIXED] Body copy was 11pt: the meta lines "Starts today", "Next opening…" and the date ranges, plus the note "Reviewed before it goes live…". Raised it to `FS.meta`.
- [FIXED] Bottom padding was `insets.bottom + 140` on top of the scene-level tab-bar clearance. Changed to `SP.xl` and removed `useSafeAreaInsets`.
- The populated demo state (`&demo=1`) still renders blank in the harness: neither the demo fixture nor an API call fires. Not verified visually, and the cause looks like the `!isSignedIn` demo gate in the harness rather than the screen. Flagged for the integrator.

**Links** (`artifacts/mobile/app/growth-links.tsx`)
- [FIXED] Link card subtitles showed raw UTM values ("Store · instagram · spring-drop", "Store · newsletter · …"). They now use the preset label ("Store · Instagram · spring-drop", "Store · Email · …"), as do the unnamed-link title and the accessibility label.
- [FIXED] The ScrollView added `paddingBottom: 120` on top of the scene-level tab-bar clearance. Changed to `SP.xl`.
- The header title "Links" is generic next to Marketing's "Link in bio". Left unchanged because it matches the Marketing row label "Links".
- RefreshControl has no `tintColor`, so the spinner uses the platform default grey on black. Left as minor.

**New link** (`artifacts/mobile/app/growth-link-new.tsx`)
- [FIXED] When `getDestinations()` failed, the screen showed the misleading "Publish your store or set a username to link to it." It now tracks `destFailed` and says "Couldn't load your link destinations. Go back and try again."
- [FIXED] With Destination → Product selected and no product chosen, "Create link" was disabled with no explanation. Added the hint "Choose the product to link to."
- [FIXED] The heading "Where will you share it" was missing its question mark.
- [FIXED] The preset chip rows sat only 8px above the "Source" field, cramped compared with the other sections. Gave that row `marginBottom: SP.md`.
- [FIXED] Hard-coded `8` spacing (label margin, chip gap) changed to `SP.sm`. Removed the `paddingBottom: 120/140` double clearance on both the form and the "Link ready" view (now `SP.xl`).
- Product chips are silently capped at 30 (`slice(0, 30)`) with no search or "more". Not fixed: needs a product decision.
- The disabled "Create link" button renders as bare grey text with no button shape (fresh state). Not fixed: that is shared `PrimaryButton` styling.

**Link detail** (`artifacts/mobile/app/growth-link-detail.tsx`, header shows the link's label, e.g. "Instagram bio")
- [FIXED] Clicks chart axis labels were raw "MM-DD" slices ("08-20", "09-18"). Added `shortDay()` so they read "Aug 20".
- [FIXED] Missing UTM values in the Campaign card showed a hyphen "-". Changed to an em dash "—".
- [FIXED] The archive failure alert had a title and no message. Added "Please try again."
- [FIXED] `paddingBottom: 140` on top of the scene clearance left a large empty area under "Archive link". Changed to `SP.xl`.
- "Top countries" lists raw ISO codes ("US", "GB"). Not fixed: needs a country-name map, and `Intl.DisplayNames` isn't reliable on Hermes.
- With an unknown or missing `id` the screen shows the generic "Something went wrong. Please try again." with a Retry that can never succeed. Not fixed: needs a not-found state from the API.

**Drops** (`artifacts/mobile/app/seller-drops.tsx`)
- [FIXED] The empty state showed a bare message, "No drops yet — create your first one", followed by a hand-rolled "+ New drop" button with no `accessibilityRole`. It now uses the shared layout `EmptyState` with the title "No drops yet", a one-line message and a built-in "New drop" action (44pt, role=button).
- [FIXED] The list loaded only on mount (`useEffect`). After a drop was created, edited or cancelled in seller-drop-create, going back showed stale rows and status. It now refetches on focus with `useFocusEffect`.
- [FIXED] Status badges showed the raw server enum in upper case ("ACTIVE", "DRAFT", "CLOSED", "FULFILLED"). They now use sentence-case labels ("Live", "Draft", "Closed", "Fulfilled"), matching other StatusBadge call sites such as store-domain.
- [FIXED] The error banner (rendered in both preview states) read "Could not load your drops. Tap to retry." next to its own "Retry" button, which said the same thing twice. It now reads "Couldn't load your drops."
- [FIXED] The drop rows had no accessibilityRole or label. They now read "<name>, <status>" with role=button and a hint.
- [FIXED] The header "+" (New drop) button was 36x36, below the 44pt target. It is now 44x44.
- [FIXED] A launch date in a past year rendered without the year ("Jan 1, 6:00 PM"), so an old drop looked upcoming. The year is now added when it isn't the current year.
- [FIXED] Spacing was off-token (row padding 13, list gap 10, marginTop 3, loader paddingVertical 40) and the launch-date line was 11px (FS.xs is badge-only). These now use SP.md, 12, SP.xs and SP.xl, and the date is FS.meta. The `insets.bottom + SP.xl` bottom padding doubled the scene-level tab-bar clearance and is now SP.xl.
- No in-app route links to `/seller-drops`. The list is reachable only by URL (SellerCreateFAB links straight to seller-drop-create). Left unfixed: the entry point belongs in another group's files (More, Control Center or Products) and needs a product decision.

**New drop / Edit drop** (`artifacts/mobile/app/seller-drop-create.tsx`)
- [FIXED] In edit mode, a failed `api.drops.get` showed a native alert and then rendered a blank "Edit drop" form with live "Save changes" and "Cancel drop" buttons (seen rendering `?dropId=abc`). It now shows an error `EmptyState`, "Couldn't load this drop", with a Retry that refetches.
- [FIXED] The two toggles, "Set an end time" and "Early access for followers", had no accessible name (the probe reported `switch @335,691 42x24` as unlabeled). They now have accessibilityLabels.
- [FIXED] The icon-only controls had no labels or roles: the hero "x" remove button (also only a 28x28 target, now with hitSlop), the timezone modal "x" close button and the "Enter an exact date & time" disclosure (now has an `expanded` state). All are now labelled.
- [FIXED] The Pre-order/Pre-made segment had no role or selected state, and the timezone selector, Add photo/video, Create drop/Save changes, Preview and Cancel drop buttons had no role. The segment now has radio role and state, and the others have role=button.
- [FIXED] The text inputs (drop name, raw date, raw time, early-access minutes, timezone search) relied on placeholder text alone. They now have accessibilityLabels.
- [FIXED] The "Today"/"Tomorrow" day chips were computed once when the module loaded, so they went stale if the app stayed open past midnight. They are now built each time the picker mounts.
- [FIXED] The validation alerts were developer-ish ("Enter the launch date as YYYY-MM-DD and time as HH:MM (24h)") even though the main input is a chip picker. They now say "Pick a launch day and time, or enter an exact date…", and the end-time alert says "End time required" instead of "End date invalid".
- [FIXED] Searching the timezone modal with no matches showed a blank list. It now says "No timezones match "…"". The modal list now also clears the home indicator and keeps taps while the keyboard is open.
- [FIXED] Typography fixes: "Video selected" and "minutes before everyone else" had no `fontFamily` (system font), and the former was 11px. Both now use FONT.* and FS.meta/FS.sm. The `insets.bottom + SP.xxl` scroll padding doubled the scene clearance and is now SP.xl.
- The two toggles render iOS green (`rgb(52,199,89)`, off-palette). Left unfixed: this comes from the shared `HapticSwitch` in components/BrandthreadUI.tsx, which other screens also use.
- "Cancel drop" uses a hard-coded `#FF3B30`. Left as is: the theme's `error` token is a pale pink, so changing it is a design decision.
- "Add a product first, then come back to include it." has no link to add a product. Left unfixed: it needs a product decision on where that link should go.

**Drop preview (Buyer view)** (`artifacts/mobile/app/seller-drop-preview.tsx`)
- [FIXED] `api.drops.get` had no `.catch`, so a failed load was an unhandled rejection (the probe logged 1 page error). Load errors are now caught.
- [FIXED] The "Couldn't load this drop." state offered only a "Back" text link with no role and no way to retry. It now has a Retry button (when a dropId is present) next to Back, both with role=button and on-scale type (FS.base).
- [FIXED] The hero back button was an icon-only circle with no accessibilityLabel or role. It is now labelled "Back".
- [FIXED] `computeCountdownParts` reports "live" for any past or missing release time, so the preview said "LIVE NOW" for a closed or fulfilled (cancelled or ended) drop and for an undated draft. It now shows "Drop closed" or "No launch date set" in those cases.
- [FIXED] Off-scale type: the drop name was 32 (now FS.h2), the "BUYER VIEW" badge used a literal 11 (now FS.xs), and the early-access line was 11 (now FS.meta). The `insets.bottom + SP.xl` padding doubled the scene clearance and is now SP.xl.

**Waitlist demand** (`artifacts/mobile/app/waitlist-demand.tsx`)
- [FIXED] A failed `GET /api/waitlist/seller` was swallowed (`setRows([])`) and showed "No one is waiting", which misled the seller. It now shows a "Couldn't load your waitlist" state with Retry. A failed refresh keeps the last list.
- [FIXED] The screen was one of the few still on the legacy layout `Header`, which has a centered title and a chevron back button (visible in the render). Every sibling seller screen uses a left-aligned title with an arrow back button. It now uses `ScreenHeader`, falling back to `/products`, where the screen is opened from.
- [FIXED] The empty-state copy "When a shopper taps Notify me on a sold-out size" did not set off the button name. It now quotes it: "Notify me".
- [FIXED] The "Notify now" accessibilityLabel read "Notify 3 waiting for Tee " (trailing space, no noun when there is no variant). It now reads "Notify 3 shoppers waiting for Tee (M)".
- [FIXED] The summary count was a literal 28 (now FS.xxl) and the row meta text was 11 (now FS.meta). The `insets.bottom + 24` bottom padding doubled the scene clearance and is now SP.xl.

**Customers** (`artifacts/mobile/app/customers.tsx`)
- [FIXED] The header's bar-chart button is labelled "View customer analytics" but navigated to the generic `/(tabs)/analytics`. It now opens `/analytics-customers` (Customer Analytics).
- [FIXED] The empty state was `compact`, which drops the message, so "Try a different name, email or tag." (no search matches) and the "Once someone buys…" explanation never rendered. `compact` is removed.
- [FIXED] The sort chips (Recent / Top spender / Name A-Z) had no role or selected state and were about 30px tall. They now have role=button, a selected state, "Sort by …" labels and a 36px minimum height.
- [FIXED] The customer rows had no accessibilityRole or label. They now read "<name>, <email>" with a hint. The customerId in the push URL is now `encodeURIComponent`'d.
- [FIXED] The search input had no accessibilityLabel and now does (with returnKeyType=search). The customer email and phone were 11px (badge-only floor) and are now FS.meta.
- [FIXED] The "Avg. spend" stat used a heart icon, which means favourites rather than money. It now uses dollar-sign.
- The "Total" stat counts the current search results, so typing a search changes "Total". Left unfixed: needs a product decision (separate total from match count).
- The More tab entry "Customers — Browse your customer list" and the Control Center entry (`lib/sellerControlCenter.ts`) both route to `/customer-accounts`, the "Not configurable" stub, instead of this list. Left unfixed: `app/(tabs)/more.tsx` and `lib/sellerControlCenter.ts` are outside this group (see notes).
- In the web preview (signed-in harness, `?bt_preview=seller`) the list shows "Couldn't load your customers." because `serviceRequest` rejects every seller-preview call, while the preview short-circuit only checks `!userId`. Left unfixed: this is dev-preview only, and `tests/seller-fresh-preview-no-demo-data.test.ts` pins that exact condition.

**Customer accounts** (`artifacts/mobile/app/customer-accounts.tsx`)
- [FIXED] The More tab and Control Center send sellers here for "Browse your customer list", but the screen was a dead end with no way forward. The empty state now explains that the list lives under Customers and has a "View customers" action (`/customers`).
- [FIXED] It used a bespoke bare icon with hard-coded `fontSize: 17/13` and `'Inter_…'` strings, centered mid-screen, unlike every other seller empty state. It now uses the shared layout `EmptyState` (badge ring, FS/FONT tokens).
- The wrong More and Control Center routes (`/customer-accounts` for "Customers") are not fixed. They are outside this group's files.

**Customer events** (`artifacts/mobile/app/customer-events.tsx`)
- [FIXED] The title "Not available yet" is the placeholder phrase the audit bans on customer-accounts (`tests/seller-commerce-audit-hard-findings.test.ts`) and promises a feature with no date. It now reads "Not configurable from the app" with "Event pixels and customer-event tracking aren't managed here."
- [FIXED] Same bespoke icon and hard-coded type as customer-accounts. It now uses the shared `EmptyState`.
- Nothing in the app links to `/customer-events`. It is reachable only by URL or the parentFallback map. Left unfixed: needs a decision on whether the stub should exist at all.

**Customer privacy** (`artifacts/mobile/app/customer-privacy.tsx`)
- [FIXED] Same banned "Not available yet" placeholder wording. It now reads "Not configurable from the app" with "Privacy and data-sharing settings aren't managed here."
- [FIXED] Same bespoke icon and hard-coded `fontSize`/`fontFamily`. It now uses the shared `EmptyState`.
- Nothing in the app links to `/customer-privacy`. It is an orphan route, left unfixed for the same reason as customer events.

**Customer orders** (`artifacts/mobile/app/customer-orders.tsx`)
- [FIXED] The order rows were plain `View`s, so a seller could see an order but not open it. Each row now pushes `/order-detail?id=…` with role=button and a full accessibilityLabel.
- [FIXED] Status badges rendered the raw lower-case server value ("delivered", "partially_refunded"). They now show sentence case with spaces ("Delivered", "Partially refunded").
- [FIXED] With no `customerId` (rendered `/customer-orders`), the screen showed "ORDER HISTORY — No orders yet" as if it were a real customer with no orders. It now shows "This customer couldn't be found." with a "Back to customers" button.
- [FIXED] The fallback header title "Customer Orders" was in Title Case and is now "Customer orders". The source label "Order History" is now "Order history".
- [FIXED] Off-scale type: the name and avatar were 16 (now FS.base), and the order date and tracking text were 11 (now FS.meta). The scroll `paddingBottom: 100` doubled the scene-level tab-bar clearance; padding is now SP.md/SP.xl.

**Reviews** (`artifacts/mobile/app/seller-reviews.tsx`)
- [FIXED] `error` was set on a failed `api.reviews.mine()` but never rendered (the `errorText`/`retryBtn` styles existed unused), so a failed load showed "No reviews yet". There is now an error state, "Couldn't load your reviews…", with a 44pt Retry.
- [FIXED] The header was "My Reviews": Title Case, and not what the More tab calls it ("Reviews"). It is now "Reviews".
- [FIXED] The reply form copy: the button "Post Reply" (Title Case) is now "Post reply", and the failure alert, titled just "Error", is now "Couldn't post reply".
- [FIXED] Accessibility: the star rows had no label and now announce "4 out of 5 stars". "Reply publicly", Cancel, Post reply and Retry had no role and now do. Post reply exposes disabled/busy state, and the reply input is labelled. "Reply publicly" was about 28px tall and now has more padding plus hitSlop.
- [FIXED] The stat label "Pending" was ambiguous next to "Replied" and is now "Awaiting reply".
- [FIXED] Off-scale type: the stat values were 18 (now FS.lg), the empty title 16 (now FS.md), the "on <product>" line 11 (now FS.meta) and the error text 14 (now FS.sm). The `paddingBottom: 100` doubled the scene clearance and is now SP.xl.
- A posted reply can't be edited or deleted, and the list has no pull-to-refresh. Left unfixed: these are feature additions (the API has no edit or delete endpoint for replies).

**Giveaway** (`artifacts/mobile/app/giveaway.tsx`)
- [FIXED] Any load failure (network, 5xx) showed "This giveaway isn't available." with no way to retry. A real 404 now keeps that copy, and every other error shows a "Couldn't load this giveaway — Tap to retry" RetryRow that re-fetches.
- [FIXED] Signed-out viewer, or the brand viewing its own giveaway (`me === null`), on a live giveaway: the steps showed with no CTA and no explanation. It now says "Sign in to enter this giveaway." or "This is your giveaway, so you can't enter it." (uses `g.isOwner`).
- [FIXED] Winners list joined name and handle with two raw spaces ("Maya Chen  @mayachen"). It now uses the app's " · " separator ("Maya Chen · @mayachen").
- [FIXED] The status meta line ("3d 4h left · 2 winners" / "Winners drawn · 2 winners") used FS.xs (11). The theme reserves 11 for badges, so it now uses FS.meta (12).
- Seller viewing this page inside the seller shell: `paddingBottom: insets.bottom + 140` stacks on top of the scene-level tab-bar clearance and leaves about 140px of dead space at the end. Left alone because this is the buyer/shared-link page, and buyer-side clearance rules are outside this audit.
- Off-scale spacing in the step rows and "You won" banner (`paddingVertical: 10`, `padding: 14`, `gap: 10`). Left so the visible layout does not shift. Cosmetic only.
- The signed-out state has a note but no "Sign in" button. Adding one needs a product/auth-flow decision (return-to-giveaway after sign-in).

**Giveaways** (`artifacts/mobile/app/seller-giveaways.tsx`)
- [FIXED] Row subtitle said "1 entries" (demo, a giveaway with one entry). It now pluralises correctly ("1 entry" / "184 entries").
- [FIXED] Ended and drawn rows read "Winners drawn · … · ends Oct 26, 2026" (wrong tense), and scheduled rows showed the end date instead of the start. They now read "ends …" (live), "starts …" (scheduled) and "ended …" (ended/drawn/cancelled).
- [FIXED] Load error was a dead sentence ("Couldn't load your giveaways.") with no retry. It is now a RetryRow that reloads.
- [FIXED] In the fresh seller preview (signed-out, no `demo`) the list always showed the load error, because the API client rejects with `dev_preview_offline`. It now shows the real "No giveaways yet" empty state in that case only. No fake data is added.
- [FIXED] `paddingBottom: insets.bottom + 140` doubled the stack-scene tab-bar clearance (ScreenChrome), leaving a large empty tail. Changed to `SP.xl`.
- Long giveaway titles are cut to one line ("Spring tee giveaway with a really long title t…"). ListRow has no `titleNumberOfLines` prop. Shared component, not edited.

**New giveaway** (`artifacts/mobile/app/seller-giveaway-create.tsx`)
- [FIXED] "Start giveaway" sat disabled (rendered as bare grey text) with no hint about what was missing. When the form is invalid it now shows "Add a title, a prize and the official rules to start." above the button.
- [FIXED] Entry post value and the Entry post sheet options were hard-sliced mid-word with no ellipsis ("New season lookbook: the", "…in four wa"). They now go through `clip()`, which trims and adds "…".
- [FIXED] Field labels (Title, Prize, Winners, Runs for, How people enter, Region, Eligibility, Official rules) used FS.xs (11), which is below the theme's body/meta floor. They now use FS.meta (12).
- [FIXED] `paddingBottom: insets.bottom + 140` double-counted the scene tab-bar clearance. Changed to `SP.xl`.
- The Region and Eligibility placeholders ("United States", "Open to people aged 18 or older") look like filled values, but the rules template is generated with empty region/eligibility. Needs a product decision (prefill vs. hint copy).
- If the rules-template request fails, the rules stay empty and the form can't be submitted. Only the new hint explains it, and there is no retry for the template. Needs an API/UX decision.
- The prize product and entry post pickers list only the first 20 items and have no search. Product decision.
- Winners chip "1" is a 32×34 tap target. It comes from the shared ChipGroup, which was not edited.

**Giveaway** (`artifacts/mobile/app/seller-giveaway-detail.tsx`)
- [FIXED] Meta line read "Ended · ends Oct 23, 2026" / "Winners drawn · ends …" (redundant, wrong tense). It now reads "ended …" for past giveaways and "starts …" for scheduled ones.
- [FIXED] "End now" ended a live giveaway on a single tap and can't be undone. It now needs a confirming second tap ("Tap again to end the giveaway"), the same pattern as Remove creator.
- [FIXED] Opening "Redraw" on a winner showed a reason field with no way to back out. Added a "Cancel" tertiary button that closes it and clears the reason.
- [FIXED] Draw log timestamps were raw locale strings with seconds ("10/23/2026, 4:06:18 PM"). They now read "Oct 23, 2026, 4:06 PM".
- [FIXED] Load error was plain text with no retry. It is now a RetryRow.
- [FIXED] Meta line and the "Eligible entries" / "Winners" stat labels used FS.xs (11). They now use FS.meta.
- [FIXED] `paddingBottom: insets.bottom + 40` double-counted the scene clearance. Changed to `SP.xl`.
- The API has `sellerGiveaways.cancel`, but the screen has no Cancel giveaway action for scheduled or live giveaways. Needs a product decision.
- The "Unmark" button on a shipped winner is ambiguous out of context. A clearer label ("Not shipped") needs copy sign-off and must fit the compact button.
- "fingerprint 9f2c41ab77e0" in the draw log is audit jargon for sellers. Kept because it is the draw-integrity record. Copy decision.

**Creator program** (`artifacts/mobile/app/seller-creator-program.tsx`)
- [FIXED] Creator rows said "LEOK4 · 1 orders" (demo). They now pluralise ("1 order").
- [FIXED] With the program off, "Send invite" was disabled with no reason given. It now shows "Turn on the creator program to invite creators." under the button.
- [FIXED] Invite result ("Invite sent", or the error) was flashed in the note at the very top of the scroll, off-screen while the seller is at the invite field. It now shows under the Send invite button and stays until the next attempt.
- [FIXED] The program toggle used react-native `Switch` with `theme.success`. On web this draws a teal default thumb on a thin green track, and the repo lint `no-direct-switch-import-lint` forbids the import. Swapped to the app's `HapticSwitch`.
- [FIXED] A creator with no display name showed a bare username ("nia"). It now shows "@nia", and the name is limited to one line so long names don't push the status pill.
- [FIXED] Creator row meta lines used FS.xs (11). They now use FS.meta.
- [FIXED] `paddingBottom: insets.bottom + 120` double-counted the scene clearance. Changed to `SP.xl`.
- "Approve" on a pending creator row has no loading/disabled state, so a double tap sends two approvals, and it is a button nested inside the row button. A proper fix means restructuring the row. Not mechanical.
- Toggle/copy-link feedback still appears only in the top note. That is fine while the card is in view, so left as is.

**Creator** (`artifacts/mobile/app/seller-creator-detail.tsx`; header shows the creator's name)
- [FIXED] Status pill fell through to "Invited" for any other status, including `removed` (reachable by deep link). It now uses a status label map (Active / Needs approval / Paused / Invited / Removed / Declined).
- [FIXED] An error message from a failed Save rate / Pause / Approve stayed on screen after a later action succeeded. `msg` is now cleared at the start of each action.
- [FIXED] "@username", the "This creator isn't in your program." empty text and the "%" suffix had no fontSize and rendered at the browser default 14px (off the FS scale). They are now FS.sm / FS.sm / FS.base.
- [FIXED] Header showed a bare username when there is no display name. It now shows "@username".
- [FIXED] The rate help text ("A new rate applies to future orders…") used FS.xs. It now uses FS.meta.
- "Remove creator" is styled exactly like "Pause creator" (outline), and its "Tap again to remove" state never resets. Destructive styling is an ActionButton (AffiliateUI) API addition, so it was left for the integrator.
- Save rate gives no success confirmation and has no client-side range check (e.g. 150 or −5 is sent as-is). Needs a decision on validation bounds (the server validates).

**Program settings** (`artifacts/mobile/app/seller-creator-settings.tsx`)
- [FIXED] Clearing a field and tapping Save silently saved 0 (`Number('') === 0`), e.g. a 0% default commission. Empty fields now show "Enter numbers in every field." like non-numeric input does.
- [FIXED] The validation/error message stayed visible after the input was corrected and Save tapped again. It is now cleared at the start of each save.
- [FIXED] The "Approve applications automatically" toggle used react-native `Switch` (teal web thumb, lint-forbidden import). Swapped to `HapticSwitch`, and the label is now `flex: 1` with a gap so it wraps instead of colliding with the switch at large text sizes.
- [FIXED] Field help text used FS.xs (11) with `marginTop: 4`. It now uses FS.meta / `SP.xs`. The unit suffixes (%, days, USD) had no fontSize (rendered 14px) and are now FS.base.
- No range validation (commission over 100%, negative days). Leaving the screen with unsaved edits gives no warning. Product decisions (the server validates ranges).

**Creator program** (`artifacts/mobile/app/creator-program.tsx`)
- [FIXED] Each brand card labelled the attribution window just "Window". It now says "Attribution window", matching the join screen and seller settings.
- [FIXED] (via AffiliateUI) KeyStatRow notes ("Until the order is delivered and the return window ends", "Paid out on the next payout run", payout history dates) used FS.xs (11) for caption text. They now use FS.meta.
- Fresh account, Payouts tab: the copy says "Payouts are not configured on this server yet." This is developer wording from `EMPTY_CREATOR_OVERVIEW` in lib/previewAffiliate.ts (not in my list) and/or the server `reason`. Left unfixed.
- A brand whose program is paused ("Program paused" pill) still shows the code with active "Copy code" / "Share link" buttons. Whether sharing should be blocked is a product decision.
- "Code copied" / "Link copied" feedback appears in the note under the tabs, which is off-screen when copying from a lower card. Fixing it means relocating the toast, which is layout rework.

**Creator program** (`artifacts/mobile/app/creator-program-join.tsx`)
- [FIXED] Opened without a `brand` param (or after a 404), the screen was a dead end showing only "No brand selected". It now adds an "Open creator program" button that goes to /creator-program.
- [FIXED] Status sentences had no closing period ("No brand selected", "We couldn't find that brand", "Sign in to join a creator program"), unlike the rest of the screen's copy. Periods added.
- When the viewer already has an invite from this brand (`mine.status === 'invited'`), the screen offers "Apply" instead of accepting the invite. Needs an API/product decision.
- An apply error shows in the same muted body style as normal copy, so it isn't distinguishable as an error. Minor, left.
