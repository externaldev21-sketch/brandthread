# Discover tap-through — before / after (390x844, web, dark)

Captured with `capture.mjs` in this folder against the Expo web dev server
(`?bt_preview=buyer`, demo Clerk stub). The API host is mocked at the network
layer: `/api/public/trending` returns six real-shaped (UUID) brand video posts
and `/api/posts/:id` returns each as a real video post. All six share one
VP9/Opus test clip with a sine-tone audio track, so the player's video matches
the coat clip rather than each tile's poster. Headless Chromium can't decode
the bundled H.264 runway clips, and those clips have no audio.

| Step | Before (dev @ Oct 9) | After (this PR) |
|---|---|---|
| Discover, grid scrolled 160px | `before-1-discover.png` | `after-1-discover.png` |
| Tap a video tile | `before-2-tap-opens.png`: separate `DiscoverPostViewer` overlay with a different rail and icons, poster image only (no `<video>` element), no feed rail testIDs | `after-2-tap-opens.png`: the Threads feed player (`<video>` `paused=false`, `muted=false`, `currentTime` ≈ 3s; no autoplay override, since the tap is the user gesture), same RightActionRail, caption block and sound row as Home |
| Like | (n/a) | `after-3-liked.png`: heart filled in place |
| Swipe up | (n/a) | `after-4-swiped-next.png`: next Discover post (Okra Supply) |
| Back | `before-5-back-to-discover.png` | `after-5-back-to-discover.png`: Discover, grid `scrollTop` 160 → 160 |

Script log (after):

```
discover scrollTop before tap: 160
tapping discover-tile-trend_7d1c0e2a-0000-4000-8000-000000000004
video: {"count":2,"paused":false,"muted":false,"volume":1,"currentTime":3.02,"src":".../media/clip.webm","error":null}
rail: [["like-btn-",true],["save-btn-",true],["repost-btn-",true]]
discover scrollTop after back: 160
```

Script log (before): `video: null`, `rail: like/save/repost all false`.

Reproduce (from `artifacts/mobile`, with the dev server on :8171):
`CHROMIUM_PATH=/opt/pw-browsers/chromium node ../../docs/screenshots/discover-tap-through/capture.mjs after <outDir> <clip.webm> $PWD/assets/videos`
