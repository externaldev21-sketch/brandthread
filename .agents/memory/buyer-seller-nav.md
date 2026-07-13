---
name: Buyer/Seller navigation architecture
description: Account types, routing, and tab structure after "Both" removal
---

## Rule
Only two account types exist: `buyer` and `seller`. "Both" is removed from `UserRole`, `account-type.tsx`, `onboarding.tsx`, `settings.tsx`, both tab layouts, `ModeSwitcher`, and `ProfileTabButton`.

**Why:** Product spec requires exactly two roles; "Both" created dead code paths and complexity.

## Buyer tab structure
- **index** → Thread (re-exports `(tabs)/feed.tsx` — seller video feed, product tagging, likes, comments, purchase)
- **discover** → Discover (`(buyer)/discover.tsx` — hero drops, For You, Dropping Soon, Trending)
- **friends** → Friends
- **inbox** → Inbox
- **profile** → Profile
- Hidden (href: null): following, wishlist, edit-profile, search, feed

**How to apply:** When a buyer signs in, `/(buyer)/` resolves to Thread. Do not put non-seller content in Thread; buyer posts only appear on buyer profile.

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
