# TikTok rail pass — proof (390x844)

Captured from the Expo web preview at 390x844 (`demo=1` preview posts, plus
capture-only fixtures for a slideshow, a photo and a buyer post) with
`artifacts/mobile/scripts/tiktok-rail-screenshots.mjs`. Before = `dev`
(409ddcdc), after = this branch.

| File | What it shows |
| --- | --- |
| `rail-side-by-side-tiktok.png` | Our rail next to TikTok iOS (Mobbin, scaled to 390x844), with TikTok's measured rows as guide lines |
| `share-sheet-repost-first.png` | Share sheet with **Repost** first; after reposting it reads **Remove repost** |
| `after/repost-education.png` | First repost from the share sheet still shows the repost education sheet |
| `after/caption-you-reposted.png` | After reposting, the caption shows "You reposted" (only when true) |
| `caption-before-after.png` | Seller post with Shop button, buyer post, slideshow with a long caption: before vs after |
| `gap-above-tab-bar-zoom.png` | Progress line vs the floating tab bar, zoomed: 7pt gap after |
| `paused-icon-zoom.png`, `after/paused-icon*.png` | Paused icon (rounded, 60pt, 80% white, soft shadow), still up 3s into the pause |
| `swipe/` | Fast-swipe proof: `frame-diff.json`, `rail-filmstrip.png`, sample mid-scroll frames |

## TikTok measurements (Mobbin, 390x844)

| Element | TikTok | This PR |
| --- | --- | --- |
| Avatar top | y=374 | y=373 |
| Like / Comment / Save / Share glyph rows | 452 / 516 / 581 / 646 (65pt pitch) | 65pt pitch, rows at 446 / 511 / 576 / 641 (icon box tops; glyph tops ~3pt lower) |
| Sound disc bottom | y=747 | y=746 |
| Glyph centre from right edge | ~30pt | 30pt |
| Caption last line bottom | ~13pt above the bar | 8pt above the progress line |

## Fast-swipe frame diff

193 frames captured mid-swipe and settled across: 4 fast touch flings on
videos, then page-by-page animated scrolls through video -> slideshow ->
photo -> buyer photo -> photo -> video (feed loop). On every frame the rail's
avatar, Like, Comment, Save, Share and disc boxes are identical to the first
frame: **max shift 0pt**. The Like/Comment/Save/Share glyph pixels are
unchanged in every saved frame (worst 1.0 = 100% of glyph pixels still white).
