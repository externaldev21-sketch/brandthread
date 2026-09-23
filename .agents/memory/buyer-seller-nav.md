---
name: Buyer/Seller navigation architecture
description: Account types, routing, and tab structure after "Both" removal
---

## Rule
Only two account types exist: `buyer` and `seller`. "Both" is removed from `UserRole`, `account-type.tsx`, `onboarding.tsx`, `settings.tsx`, both tab layouts, `ModeSwitcher`, and `ProfileTabButton`.

**Why:** Product spec requires exactly two roles; "Both" created dead code paths and complexity.

## Buyer tab structure
- **index** → Home (re-exports `(tabs)/feed.tsx` with `showFashionPreview` — seller videos, product tagging, likes, comments, purchase). The first tab is called **Home** everywhere; never "Thread".
- **discover** → Discover · **inbox** → Inbox · **search** → Search · **profile** → Profile
- Routes with no slot (`href: null`): friends, cart, orders, following, edit-profile, feed. They stay inside the buyer Tabs so the bar remains on screen; `BUYER_ROUTE_SLOT` lights up the control they were opened from (friends/cart → Home, orders/following/edit-profile → Profile).
- Friends is reached from the Home header (top-left people icon, like the Sora reference) and from the Profile menu.

The bar lives in `components/buyer-nav/BuyerTabBar.tsx`; all geometry comes from the pure `getBuyerTabBarMetrics()` in `buyerTabBarMetrics.ts`. It is a content-sized capsule (Home · Discover · Inbox · Search, ~77–84% of phone width including the circle) plus a separate circle as tall as the capsule. iPad gets its own larger, centred size class and a wider search capsule; split-view windows narrower than 600pt stay on phone metrics.

Search is a slide, not a swap: one critically damped, `overshootClamping` Reanimated spring drives everything. Home never moves or hides. The field grows leftward from the Search slot (edges computed from the measured slot-row width), Discover/Inbox fade out underneath, and the Profile circle morphs into Close. The capsule width is constant on phones; on iPad it animates to a fixed target, never a measured feedback loop. The field unmounts after the reverse animation finishes.

The typed query goes through `BuyerSearchContext` (query, filters request, submit, keyboard height). Never route keystrokes through `router.setParams`; that re-rendered the navigator per keystroke and caused the old bounce.

Keyboard follow uses `useAnimatedKeyboard` inside a component mounted only while search is open, with both Android translucency flags `true`. Without them Reanimated adds status/nav bar margins to the root view and, on unsubscribe, turns `decorFitsSystemWindows` back on, which breaks edge-to-edge app-wide.

**Screens behind the bar:** every buyer screen pads scroll content with `useBuyerTabBarInset()`; bottom-anchored UI (cart checkout summary, feed rail/caption/shop tag/progress) sits above it. Home video fills edge to edge (`cover`) only when that crops ≤30%; otherwise it letterboxes over a blurred poster (e.g. a vertical clip on a landscape iPad).

**Why:** The owner rejected the stretched bar, the static field, and the old slide that hid Home and bounced. He wants the reference slide (IMG_8922/8923) with Home always reachable and nothing covered by the bar.

**Glass:** iOS and web use a live `BlurView` under a theme-tinted layer. Android uses a denser tint instead, because expo-blur's Android blur needs a `BlurTargetView` around the whole navigator, which can't sample video surfaces and redraws the feed every frame.

## Seller tab structure (unchanged)
Dashboard · Products · Feed (center pill) · More · Profile

## AuthGate routing
- `storedRole === 'buyer'` → `/(buyer)/` (Thread)
- anything else (seller) → `/(tabs)/` (Dashboard)
- Role mismatch correction: buyer in (tabs) → redirect to (buyer); seller in (buyer) → redirect to (tabs)

## Dead code retained
`ModeSwitcher` and `ProfileTabButton` still exist as components but are effectively no-ops (ModeSwitcher only renders when `isBoth`, which can never be true; ProfileTabButton double-tap is a void no-op). Do not re-enable "both" logic in them.

## TypeScript notes
- `(buyer)/inbox.tsx NotifRow` needed `const router = useRouter()` — was missing (pre-existing bug, now fixed)
- `chat/[id].tsx` useEffect cleanup needed `return () => { unsub(); }` not `return unsub` (pre-existing, now fixed)
- ProfileTabButton `role === 'both'` comparison removed (no longer valid after UserRole narrowing)
