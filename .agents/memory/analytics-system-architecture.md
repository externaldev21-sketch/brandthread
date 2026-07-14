---
name: Analytics System Architecture
description: Brandthread seller analytics — 10 screens, 2 service files, nav entry points, design rules.
---

## Files
- `services/analyticsTypes.ts` — 25+ types, plus `DATE_RANGE_OPTIONS`, `COMPARISON_OPTIONS`, `ANALYTICS_SECTIONS` constants
- `services/analyticsService.ts` — all service functions; stable seeded demo data (no Math.random); AsyncStorage keys `bt:analytics:filter:v1` (filter state) and `bt:analytics:insights:v1` (dismiss/complete state)

## Screens (all registered in `app/_layout.tsx`)
- `app/(tabs)/analytics.tsx` — hub: date/comparison/section pills, switchable bar chart, 14 KPI cards with sparklines, Insights
- `app/analytics-sales.tsx` — P&L waterfall, 5-chart switcher, product breakdown
- `app/analytics-products.tsx` — 8 sort modes, product rows with inventory badge
- `app/analytics-customers.tsx` — 11 KPIs, VIP/at-risk/churn, cohort retention, top locations
- `app/analytics-content.tsx` — 11 metric tiles, top videos/slideshows, retention bar graph
- `app/analytics-store.tsx` — traffic + conversion KPIs, conversion funnel, section performance rows
- `app/analytics-marketing.tsx` — revenue by channel, campaign table, influencer ROC, referral stats
- `app/analytics-inventory.tsx` — alert cards, sell-through gauge, 4-tab product list
- `app/analytics-production.tsx` — KPI tiles, on-time gauge, manufacturer performance cards
- `app/analytics-profit.tsx` — profit/payout toggle; profit waterfall; payout balance + next payout

## Design rules
- All charts are custom `View` bar/sparkline components — no chart library installed
- Import colors from `@/lib/theme` directly; do NOT use `useColors()` hook

## Navigation entry points (all wired)
- More tab ✅ (GROWTH section → `/(tabs)/analytics`)
- Seller Home ✅ (NavigationCard + search action item)
- Products ✅ ("View analytics" action sheet item)
- Profile ✅ (CONTENT_TABS includes "Analytics")
- Content hub ✅ — analytics icon button added to header
- Marketing ✅ — bar-chart-2 icon button in headerRow
- Customers ✅ — ScreenHeader `rightElement` bar-chart-2 button
- Store Builder ✅ — "Analytics" added to quickActions array on store status card
- Orders ✅ — bar-chart-2 IconButton added to headerRight

**Why:** ScreenHeader already supports `rightElement` prop — always use that for header icon buttons on screens using ScreenHeader; build the icon+style inline for custom headers.
