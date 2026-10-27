# Overlap & clipping audit

`scripts/overlap-audit.mjs` renders every route of the app at **390x844** in the
web preview harness (the same demo build, fake Clerk and fake API as
`scripts/cutoff-audit.mjs` and `scripts/store-screenshots/`), in both the buyer
and the seller preview, and flags anything that collides:

| kind       | what it means |
|------------|---------------|
| `overlap`  | two visible items (text, icon, control) whose boxes intersect while neither contains the other |
| `touching` | two painted boxes (pill, chip, card, tile: anything with a background or border) that overlap or meet with no gap |
| `clipped`  | an icon, image or control cut off by a clipping parent (`overflow: hidden`), or an icon/small tile sitting on the border of a rounded, bordered container so the corner shaves it |

Each screen is checked at the top and again with every scroller at its end.
Only items that are on top at their centre are compared, so content behind a
modal, a sheet or the floating tab bar is ignored, and content that scrolls
under pinned chrome (tab bar, sticky header, footer CTA) is left to
`cutoff-audit.mjs`'s `covered` check.

## Running it

```sh
cd artifacts/mobile
node scripts/overlap-audit.mjs                       # build, then audit every route as buyer and seller
node scripts/overlap-audit.mjs --skip-build          # reuse the last preview build
node scripts/overlap-audit.mjs --skip-build --roles seller --routes /analytics,/profile
node scripts/overlap-audit.mjs --skip-build --json out.json --shots shots/
```

It exits 1 when anything is flagged. If Playwright's pinned Chromium is not
downloaded (cloud containers), point it at a local one:
`PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium`.

Routes that redirect (role-gated, or needing params the static route list
does not have) print `skip … (landed on …)`; the screen they land on is
audited under its own route. Sheets and modals can be audited by appending
taps: `"/buyer-product-detail?productId=prod_nl_hoodie_ember >> Select options"`.

## Intentional overlaps

`ALLOWLIST` at the top of the script holds the overlaps that are part of the
design, one comment each: count badges on icons, the edit/story badge on an
avatar, video overlay controls, the globe popover, and modal/sheet/tip
layers. Keep it small. Before adding an entry, check that the overlap would
survive a design review as deliberate; a real collision gets a spacing fix
instead (minimal: a margin, a padding, a `flexShrink`, never a redesign).

## When to run it

After any change to layout, spacing, a shared row/pill/chip component, or a
screen's header. Fixes it has driven so far are guarded by unit tests in
`tests/overlap-spacing-fixes.test.ts`.
