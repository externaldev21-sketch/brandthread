# QA P2/P3 — Seller studio, store & settings (part 1): before / after

Each image is one route × role × data mode at 390×844, captured from an exported
web preview (`?bt_preview=<role>[&demo=1]`, signed out, every API call answering 401 —
how the real web preview behaves):

`[ dev: top | dev: scrolled to end ] ▌red bar▐ [ this PR: top | this PR: scrolled to end ]`

`invalid-route-example__*.jpg` shows what every audit route that doesn't exist on dev
(e.g. `/p/demo`, `/hashtag/…`, `/seller-push-broadcast`) renders on both sides: the
standard Not found screen with the shared header.
