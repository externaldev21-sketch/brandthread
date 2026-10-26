# Discover video tap → the real Threads feed at that post (390x844, web, dark)

Captured with `capture.mjs` in this folder against the Expo web dev server
(`?bt_preview=buyer`, the repo's Clerk stub). The API host is mocked at the network layer:
`/api/public/discover` returns real-shaped (UUID) video posts, `/api/posts/:id` resolves each,
and `/api/public/posts` returns three distinct Threads For You posts ("FEED POST ONE/TWO/THREE")
so you can see the swipe leave the Discover grid and enter the feed's own content.

| Step | File | Result |
|---|---|---|
| Discover, grid scrolled 160px | `1-discover.png` | scrollTop 160 |
| Tap a video tile | `2-tap-opens-feed.png` | URL `/discover-player?postId=<id>`; header is the feed's own `LIVE · Following · Threads` with cart + search (no "Discover" title, no back arrow); tapped post playing |
| Like / comments / share / avatar | (log) | like → `POST /api/posts/<id>/interact`; comments sheet opens; share sheet opens; avatar → `/seller-profile` |
| Swipe up ×3 | `3-swiped-into-feed.png` | FEED POST ONE → TWO → THREE (the feed's normal For You data) |
| Back | `4-back-to-discover.png` | Discover, scrollTop 160 → 160 |
| Demo (`&demo=1`) tap a preview tile | `demo-2-tap-opens-feed.png` | preview post opens in the feed with the same header |
| Demo swipe | `demo-3-swiped-into-feed.png` | continues into the preview Home feed |
| Reference | `reference-home-feed.png` | buyer Home for comparison (same header; Home also has the tab bar) |
