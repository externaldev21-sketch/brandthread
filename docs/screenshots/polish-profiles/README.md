# Profile polish: before / after (390x844)

Captured with `artifacts/mobile/scripts/polish-profiles-capture.mjs` (demo harness:
`?bt_preview=…`, seeded storage, fake API). `before/` is `origin/dev` @ 409ddcdc,
`after/` is this branch, and `compare/` puts each pair side by side.

| Screen | File | Items it shows |
| --- | --- | --- |
| Buyer's own profile, top | `own-01-top.png` | #56 chip icon, #57 bell, #61 Buyer chip, #62 highlights, #63 / #74 tabs, #64 empty state |
| Own profile, scrolled | `own-02-scrolled.png`, `own-03-bottom.png` | #65 sticky mini-header |
| Own profile ••• menu | `own-04-more-menu.png` | Edit profile, Share profile, Orders (#63), View as visitor |
| Brand profile (buyer viewing Northline Studio) | `brand-01-top.png`, `brand-02-scrolled.png` | #66 name, #67 stats, #69 badges, #71 header, #72 icons, #74 tabs |
| Brand ••• menu | `brand-03-more-menu.png` | unchanged menu |
| Another buyer's profile | `other-01-top.png`, `other-02-scrolled.png` | #61, #65, #66, #67, #71, #72, #74 |

In dev-preview, `buyer-other-profile` deliberately ignores route params (see
`trustRouteParams`), so that screen shows "Unknown" with a load error in
both shots. It still shows the layout. #73 (no "▶ 0") is covered by
`tests/profile-polish.test.tsx`, because every demo video has 1,200 views.
