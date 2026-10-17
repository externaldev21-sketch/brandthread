# Replit-only changes (reference, not built here)

These files exist only in the Replit workspace (`artifacts/mobile/components/buyer-feed/`),
not on GitHub `dev` or any PR head, so they could not be typechecked, tested or
screenshotted in this PR. Each `.txt` is the full Replit file as read on
2026-10-17 (~21:50 UTC) with the changes below applied. Diff against your copy
and re-apply by hand.

- `FollowingTrendingCreators.tsx.txt`
  - Dev's card fix: `trendingCardSize` is 3:5 (about 250x417 at 390pt, was 71% wide at 3:4),
    so a 9:16 video is only trimmed about 6% top and bottom. New `previewFit` picks `cover`
    (centered) or `contain` over a blurred poster for non-vertical media. A real size comes
    from the poster `onLoad` or the video track.
  - The uniform 0.18 scrim becomes a light top fade plus a bottom fade. Avatar (80 to 40pt),
    name, handle and Follow (36pt) fit in the bottom third.
  - #16: the subtext uses `theme.text` at 0.8 opacity instead of `theme.muted`.
  - #17: the X has a 44x44 tap area with a 28pt dark circle behind the glyph.
  - #18: after a successful follow, the row glides to the next creator, and the new
    `onFollowed(c)` prop lets the Following screen reload its feed.
    The parent still needs to pass `onFollowed`.
- `TrendingCreatorPreview.tsx.txt`: new `fit` prop (cover/contain) and `onSize`
  (from `videoTrackChange`). Still muted, looping, and only the centered card plays.
- `trendingCardGeometry.test.ts.txt`: unit tests for `trendingCardSize` and `previewFit`.
