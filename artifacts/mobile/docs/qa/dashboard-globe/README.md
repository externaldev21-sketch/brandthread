# Seller dashboard: data cross-check and order globe QA

Web harness at 390×844 (Expo web, Chromium). Two checks:

1. **API vs tables.** `artifacts/api-server/src/routes/__tests__/dashboard-crosscheck.integration.test.ts`
   seeds one seller in Postgres (paid / unpaid / cancelled orders today, yesterday and
   earlier, shipped to 8 world cities, visits, return requests), calls the real routes the
   dashboard uses and compares each figure with an independent SQL query on
   `orders` / `order_items` / `returns` / visits. With `DASHBOARD_CROSSCHECK_OUT=<file>`
   it saves the real responses (`crosscheck-api-responses.json`).
2. **Screen vs API.** `harness/screen-crosscheck.mjs` signs the dashboard in (Clerk stub),
   serves it those real responses and reads what the screen renders
   (`crosscheck-screen-vs-api.json`).

## Screen vs API (21/21 match)

| Number | API | Screen | |
|---|---|---|---|
| Total sales (Today) | $474.00 | $474.00 | ✅ |
| Sales change vs same hours yesterday | 464.3% |  464.3% vs yesterday | ✅ |
| Orders tile | 3 | ORDERS TODAY 3 ↑ 200% | ✅ |
| Visitors tile | 12 | VISITORS 12 ↑ 200% | ✅ |
| Conversion tile | 25.0% | CONVERSION RATE 25.0% | ✅ |
| AOV tile | $158.00 | AVG ORDER VALUE $158.00 ↑ 88.1% | ✅ |
| Top product Wool Overcoat | Wool Overcoat 2 units sold $480.00 | Top products See all Wool Overcoat 2 units sold $480.00 Silv | ✅ |
| Top product Silver Gown | Silver Gown 3 units sold $234.00 | Top products See all Wool Overcoat 2 units sold $480.00 Silv | ✅ |
| Top product Silk Scarf | Silk Scarf 6 units sold $90.00 | Top products See all Wool Overcoat 2 units sold $480.00 Silv | ✅ |
| Recent order #XC1001 | #XC1001 · 1 item | Recent orders See all  Ana Buyer #XC1001 · 1 item $246 New | ✅ |
| Recent order #XC1002 | #XC1002 · 2 items | Recent orders See all  Ana Buyer #XC1001 · 1 item $246 New | ✅ |
| Recent order #XC1003 | #XC1003 · 1 item | Recent orders See all  Ana Buyer #XC1001 · 1 item $246 New | ✅ |
| Recent order #XC1004 | #XC1004 · 1 item | Recent orders See all  Ana Buyer #XC1001 · 1 item $246 New | ✅ |
| Recent order #XC1005 | #XC1005 · 1 item | Recent orders See all  Ana Buyer #XC1001 · 1 item $246 New | ✅ |
| Traffic feed | 6 | Traffic sources See all 12 store visits this period ↑ 8 (200 | ✅ |
| Traffic search | 3 | Traffic sources See all 12 store visits this period ↑ 8 (200 | ✅ |
| Traffic external | 3 | Traffic sources See all 12 store visits this period ↑ 8 (200 | ✅ |
| Orders to ship (= Orders tab Unfulfilled; 3 of them paid) | 4 | 4 Orders to ship Ship now | ✅ |
| Returns to review | 1 return to review | To do 4 Orders to ship Ship now  1 item low on stock   1 | ✅ |
| Live (orders today) | 3 | 3 | ✅ |
| Globe caption | 5 orders · last 7 days | 5 orders · last 7 days | ✅ |

"Orders to ship" is the Orders tab's own Unfulfilled count (pending/processing), which also
includes one unpaid pending order in this seed (3 of the 4 are paid).

## Globe popovers vs API `recent` rows

| Order | Popover | |
|---|---|---|
| #XC1001 | #XC1001 Wool Overcoat $246.00 Tokyo, JP 47m ago | ✅ |
| #XC1002 | #XC1002 Silver Gown + 1 more $177.00 Paris, FR 1h ago | ✅ |
| #XC1003 | — (never faced the viewer (same spot as a newer order)) | ⏭ |
| #XC1006 | #XC1006 Silver Gown $84.00 Toronto, CA 1d ago | ✅ |
| #XC1007 | #XC1007 Wool Overcoat $246.00 Austin, TX 3d ago | ✅ |

⏭ = the dot did not rotate to the front within the script's 40 s wait on this run; it
matched on the previous run ("#XC1003 Silk Scarf $51.00 Sydney, AU 1h ago").

## Re-running

```
# 1. API cross-check (needs Postgres; see api-server vitest config)
DASHBOARD_CROSSCHECK_OUT=/tmp/xc.json pnpm --filter @workspace/api-server exec vitest run src/routes/__tests__/dashboard-crosscheck.integration.test.ts
# 2. Expo web with a dummy Clerk key (the stub replaces Clerk at runtime)
CI=1 EXPO_OFFLINE=1 EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_Y2xlcmsuYnJhbmR0aHJlYWQudGVzdCQ= pnpm exec expo start --web --port 8081
# 3. Screen cross-check / globe / card shots (pre-installed Chromium)
node docs/qa/dashboard-globe/harness/screen-crosscheck.mjs /tmp/xc.json /tmp/out
node docs/qa/dashboard-globe/harness/globe-check.mjs /tmp/out
node docs/qa/dashboard-globe/harness/card-shots.mjs /tmp/out
```

## Screenshots

- `dashboard-demo-390x844.png`, `globe-demo-frame-1/2.png` (rotation), `globe-demo-popover.png`, `globe-demo-zoomed.png`: demo preview.
- `dashboard-real-api-390x844.png`, `globe-real-api-popover.png`: signed in, real API responses.
- `globe-native-skia-on-canvaskit.png`: the native Skia renderer (`components/globe/GlobeSurface.tsx`) drawn on CanvasKit, Skia's own web build.
- `card-before-*.png` / `card-after-*.png`: "List your first product" at default and Larger text.
