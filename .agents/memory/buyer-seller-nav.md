---
name: Buyer/Seller navigation architecture
description: Account types, routing, and tab structure after "Both" removal
---

## Rule
Only two account types exist: `buyer` and `seller`. "Both" is removed from `UserRole`, `account-type.tsx`, `onboarding.tsx`, `settings.tsx`, both tab layouts, `ModeSwitcher`, and `ProfileTabButton`.

**Why:** Product spec requires exactly two roles; "Both" created dead code paths and complexity.

## Buyer tab structure
- **index** → Home (re-exports `(tabs)/feed.tsx` with `showFashionPreview` — seller videos, product tagging, likes, comments, purchase). The first tab is called **Home** everywhere; never "Thread".
- **discover** → Discover · **inbox** → Inbox · **activity** → Activity · **profile** → Profile
- Routes with no slot (`href: null`): search, friends, cart, orders, following, edit-profile, feed. They stay inside the buyer Tabs so the bar remains on screen.
- Friends is reached from the Home header (top-left people icon, like the Sora reference) and from the Profile menu.

The bar is a content-sized capsule (Home · Discover · Inbox · Activity) plus a separate Profile circle. Search stays reachable from other entry points, especially Discover, without occupying a permanent tab slot.

Search is a slide, not a swap: Home never moves or hides. When opened from another entry point, the field grows leftward from the fourth slot's position, the other slots fade beneath it, and the Profile circle morphs into Close. The field unmounts after the reverse animation finishes.

The typed query goes through `BuyerSearchContext` (query, filters request, submit, keyboard height). Never route keystrokes through `router.setParams`; that re-rendered the navigator per keystroke and caused the old bounce.

Keyboard follow uses `useAnimatedKeyboard` inside a component mounted only while search is open, with both Android translucency flags `true`. Without them Reanimated adds status/nav bar margins to the root view and, on unsubscribe, turns `decorFitsSystemWindows` back on, which breaks edge-to-edge app-wide.

**Screens behind the bar:** every buyer screen pads scroll content with `useBuyerTabBarInset()`; bottom-anchored UI (cart checkout summary, feed rail/caption/shop tag/progress) sits above it. Home video fills edge to edge (`cover`) only when that crops ≤30%; otherwise it letterboxes over a blurred poster (e.g. a vertical clip on a landscape iPad).

**Why:** The owner rejected the stretched bar, the static field, and the old slide that hid Home and bounced. He wants the reference slide (IMG_8922/8923) with Home always reachable and nothing covered by the bar.

**Why (Activity slot):** The owner specifically chose to replace the magnifying-glass tab with an Activity page rather than keeping Search as a permanent tab. Preserve existing search access without putting the magnifying glass back in the capsule.

**How to apply:** Keep buyer Activity as a real notification/activity destination and pad it above the floating bar; retain Search as a hidden buyer route opened through contextual controls.

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
