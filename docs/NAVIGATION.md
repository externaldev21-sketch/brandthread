# Navigation: Back, Cancel, X, Discard and swipe-back

Brandthread's seller app follows the same three rules the best-in-class
commerce and social apps do (Mobbin flows reviewed: Shopify seller app,
Depop, Instagram, TikTok, Etsy Sell). Every screen follows them; the
helpers that enforce them live in `artifacts/mobile/lib/navigation/`.

**The one rule behind all three:** Back, Cancel, X, Discard and swipe-back
always return the user to the **exact screen (and tab) they came from**.
Pop history when there is any; only with no history fall back to a route,
and that route must be the originating screen — never a generic tabs index
and never the Studio menu.

## Rule 1 — Pushed screens pop exactly one level

A screen reached by tapping into it (a product, an order, a settings row, a
Studio tile) is **pushed** onto the root stack with the standard
`ios_from_right` push. It gets a bare back chevron top-left and iOS
swipe-back (`gestureEnabled: true` on the root `Stack`). Back pops **one**
level: the scene underneath is the one the user left, with its scroll
position intact.

- Use `router.push(...)` to open it. Never `router.replace(...)` from the
  screen the user will want to return to — `replace` deletes that scene from
  the stack, and the exit then has nowhere real to go.
- Back controls call `goBackOr(router, '<logical parent>')`
  (`lib/navigation/goBackOr.ts`). It pops whenever `router.canGoBack()`;
  the parent route only fires on a cold deep link with no history. The
  parent of each screen that passes one is documented in
  `lib/navigation/parentFallback.ts`.

## Rule 2 — Creation and edit flows dismiss back to the screen underneath

Add product, create post / Thread, edit profile, create drop, quote
request, shipping zones and every other creation/edit flow is a **modal
in behaviour**: Cancel/X (and Done after saving) dismiss it back to the
exact screen it was opened from, on the same tab. A **"Discard changes?"**
confirmation appears only if the user actually entered something
(`hasUnsavedChanges` / `isDirty` guards); an untouched form closes at once.

- The entry point passes its origin explicitly and **pushes**:
  `router.push(withOrigin('/add-product', 'dashboard'))`
  (`lib/navigation/flowOrigin.ts`). Known origins: `dashboard`,
  `products`, `orders`, `profile`, `setup`, `studio` (plus the legacy
  `seller-setup`, which resolves to the dashboard).
- The flow's Cancel/X/Discard/Done call `leaveFlow(router, params.from,
  '<last resort>')` — or `leaveSetupFlow(router, params.from)` for the nine
  seller-setup tasks (`lib/setupNavigation.ts`). Order of preference:
  1. `router.back()` when there is history (always the case in-app);
  2. the explicit `from` origin (cold deep link / no history);
  3. the screen's logical parent as the last resort.
- Opening a flow from the dashboard goes **directly** into that flow — no
  intermediate products page.
- After a successful save that lands the user on the created thing (e.g.
  "View product"), `replace` the flow with the detail screen: Back from the
  detail screen then pops to the flow's origin, as the user expects.

Presentation note: `create-post` and `camera-capture` already slide up
(`presentation: 'fullScreenModal'`, `slide_from_bottom`). `add-product`,
`seller-drop-create`, `edit-profile` and the other creation forms still
use the standard push animation; switching them to slide-up is a one-line
`Stack.Screen` option each in `app/_layout.tsx`, but it is a visual change
and is deliberately **not** part of the logic-only back/cancel fix PR.

## Rule 3 — Tabs: active tab pops to its root; leaving a flow never switches tabs

The four seller tabs (Dashboard, Products, Orders, Profile) live in one
`(tabs)` navigator; every pushed screen sits above it on the root stack.

- Tapping a tab in the global bar calls `router.navigate('/(tabs)/<tab>')`.
  From a pushed screen that **pops the root stack back to the existing
  `(tabs)` scene** and focuses the tab — so tapping the active tab brings
  the user to that tab's root, and no second `(tabs)` instance is ever
  stacked (that is why `replace('/(tabs)/…')` is not used for this).
- Because a flow is popped rather than re-routed, the tab that was active
  when it opened is still the active tab when it closes: **leaving a flow
  never switches tabs.**
- The **Studio menu** is an overlay above the active tab, not a route.
  Opening a tile pushes that tile's screen; Back pops to the same tab and
  the menu **re-opens** (menu → tile → back ⇒ menu). A deliberate tab tap
  from inside the tile cancels that re-open
  (`lib/navigation/studioReturn.ts`, observed by `SellerBarGate` in
  `app/_layout.tsx`).

## When is `router.replace` allowed?

Only when the screen being replaced must *not* be returnable:

| Allowed | Example |
| --- | --- |
| Auth / role boundaries | boot → `/(tabs)/` or `/(buyer)/`, sign-in → `/`, onboarding → `/(tabs)/`, mode switch |
| Flow completion that lands on the result | add-product → `/product-detail?id=…`, drop create → drop preview, group create → chat |
| Alias / redirect routes | `/store/product/[id]` → `/product-detail`, `/settings` → role settings |
| Context reset | switching store context, accepting a team invite |
| Error / not-found recovery | `+not-found`, `ErrorFallback` → `/` |

Never allowed: a Back/Cancel/X/Discard/Done that `replace`s to `/`,
`/(tabs)/`, `/(buyer)/` or any tab while the user has history to pop.

## Verification

- Unit: `lib/navigation/flowOrigin.test.ts`, `lib/navigation/studioReturn.test.ts`,
  `lib/navigation/parentFallback.test.ts`, `tests/seller-setup-product-navigation.test.ts`.
- E2E (web preview, 393×852, `?bt_preview=seller&demo=1`):
  `artifacts/mobile/e2e/navigation-back-cancel.spec.ts` covers
  dashboard → add product → Cancel / hardware back ⇒ dashboard,
  products tab → add product → Cancel ⇒ products tab,
  menu → tile → back ⇒ menu, menu → tile → tab tap ⇒ that tab (menu closed),
  and the common detail-screen entry/exit pairs on every tab.
  Run with the Expo web dev server up:
  `BASE_URL=http://127.0.0.1:8081 pnpm exec playwright test -c e2e/playwright.config.ts e2e/navigation-back-cancel.spec.ts`.
