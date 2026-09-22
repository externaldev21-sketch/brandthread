---
name: Buyer/Seller navigation architecture
description: Account types, routing, and tab structure after "Both" removal
---

## Rule
Only two account types exist: `buyer` and `seller`. "Both" is removed from `UserRole`, `account-type.tsx`, `onboarding.tsx`, `settings.tsx`, both tab layouts, `ModeSwitcher`, and `ProfileTabButton`.

**Why:** Product spec requires exactly two roles; "Both" created dead code paths and complexity.

## Buyer tab structure
- **index** → Home/Thread (re-exports `(tabs)/feed.tsx` — seller video feed, product tagging, likes, comments, purchase)
- **discover** → Discover (`(buyer)/discover.tsx` — hero drops, For You, Dropping Soon, Trending)
- **inbox** → Inbox
- **search** → Search
- **profile** → Profile
- Hidden (href: null): friends, following, wishlist, edit-profile, feed

The buyer bar is a compact four-item capsule (Home, Discover, Inbox, Search) plus a separate circular Profile button. Selecting Search swaps the capsule contents without animation: Home stays fixed, a capped-width inline search field appears, and Profile stays anchored.

Its sizing follows the selected reference rather than generic edge-to-edge mobile spacing: about 8% side margins, 68% main capsule width, a 1–2% gap, and a 14–15% Profile circle. The capsule and Profile circle are the same height.

**Why:** Search must remain part of the navigation, but sliding/scaling two overlapping tab layers caused bounce, imbalance, and temporarily hid Home. The user explicitly rejected that behavior and oversized proportions.

**How to apply:** When a buyer signs in, `/(buyer)/` resolves to Home/Thread. Search mode must never animate the bar’s width or replace Home; switch contents in place, cap the field width, preserve the separate Profile control, and keep equal control heights. Do not put non-seller content in Thread; buyer posts only appear on buyer profile.

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
