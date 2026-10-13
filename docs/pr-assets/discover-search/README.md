# Discover search — in place, TikTok-style (screenshots)

Captured at 390×844 from the web preview (`?bt_preview=buyer&demo=1`; all trending/brand/product content shown is demo data that only appears with `&demo=1`). A 393×852 set is in [`393x852/`](393x852/). Re-capture with `node artifacts/mobile/scripts/discover-search-screenshots.mjs --port <N>`.

## Before — the bar pushed a separate page, and the focused state was empty

| Discover | Pushed search page | Focused | Results |
|---|---|---|---|
| <img src="390x844/before-1-discover.png" width="190"> | <img src="390x844/before-2-pushed-search-page.png" width="190"> | <img src="390x844/before-3-focused.png" width="190"> | <img src="390x844/before-5-results.png" width="190"> |

## After — the same bar becomes the search field

| Discover | Tap → focused | Focused with recents | Typing |
|---|---|---|---|
| <img src="390x844/after-1-discover.png" width="190"> | <img src="390x844/after-2-focused-empty.png" width="190"> | <img src="390x844/after-3-focused-recents.png" width="190"> | <img src="390x844/after-4-typing-suggestions.png" width="190"> |

| Results · Top | Results · Brands | Results · Products | Results · Fits | Cancel → back on Discover |
|---|---|---|---|---|
| <img src="390x844/after-5-results-top.png" width="190"> | <img src="390x844/after-6-results-brands.png" width="190"> | <img src="390x844/after-6-results-products.png" width="190"> | <img src="390x844/after-6-results-fits.png" width="190"> | <img src="390x844/after-7-closed.png" width="190"> |

Mid-animation frames: [opening](390x844/after-2a-opening-midframe.png), [closing](390x844/after-7a-closing-midframe.png). Recording of open/close: [`after-open-close.webm`](390x844/after-open-close.webm).

## TikTok reference (left) vs Brandthread (right)

Reference: Mobbin flow "Searching TikTok" — https://mobbin.com/flows/97a8565f-1675-4edb-b8e0-a2668bf009d7

<img src="side-by-side/typing.png" width="300"> <img src="side-by-side/results-top.png" width="300"> <img src="side-by-side/results-shop.png" width="300">
