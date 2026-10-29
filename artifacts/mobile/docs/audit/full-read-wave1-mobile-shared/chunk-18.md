# Chunk 18
## Files read
| file | lines read (= file length) | defects found | defects fixed |
|---|---|---|---|
| artifacts/mobile/lib/liveMap/arcs.ts | 214 | 0 | 0 |
| artifacts/mobile/lib/liveMap/globe.test.ts | 335 | 0 | 0 |
| artifacts/mobile/lib/liveMap/globe.ts | 245 | 1 (lying comment) | 1 |
| artifacts/mobile/lib/liveMap/liveMap.test.ts | 69 | 0 | 0 |
| artifacts/mobile/lib/liveMap/liveMap.ts | 209 | 0 | 0 |
| artifacts/mobile/lib/liveMap/worldLand.ts | 25 | 0 | 0 |
| artifacts/mobile/services/__tests__/adCampaignService.test.ts | 669 | 1 (stale header comment) | 1 |
| artifacts/mobile/services/__tests__/adReach.test.ts | 92 | 0 | 0 |
| artifacts/mobile/services/__tests__/aiBrandMemory.rebuild.test.ts | 68 | 0 | 0 |
| artifacts/mobile/services/__tests__/brandAssetsSync.test.ts | 29 | 0 | 0 |
| artifacts/mobile/services/__tests__/cartService.problemReport.test.ts | 116 | 0 | 0 |
| artifacts/mobile/services/__tests__/cartSync.test.ts | 205 | 0 | 0 |
| artifacts/mobile/services/__tests__/designService.mockupToModel.test.ts | 355 | 0 | 0 |
| artifacts/mobile/services/__tests__/metaAdsService.test.ts | 103 | 0 | 0 |
| artifacts/mobile/services/__tests__/orderService.accountSwitch.test.ts | 106 | 0 | 0 |
| artifacts/mobile/services/__tests__/productService.accountSwitch.test.ts | 102 | 0 | 0 |
| artifacts/mobile/services/__tests__/productService.draftSync.test.ts | 201 | 0 | 0 |
| artifacts/mobile/services/__tests__/productService.server.test.ts | 67 | 0 | 0 |
| artifacts/mobile/services/__tests__/productService.serverId.test.ts | 48 | 0 | 0 |
| artifacts/mobile/services/__tests__/productService.sort.test.ts | 117 | 0 | 0 |
| artifacts/mobile/services/__tests__/productService.stock.test.ts | 209 | 0 | 0 |
| artifacts/mobile/services/__tests__/profileService.test.ts | 185 | 0 | 0 |
| artifacts/mobile/services/__tests__/serverProducts.test.ts | 62 | 0 | 0 |

(worldLand.ts line 25 is the single generated WORLD_LAND_PATH data string, ~11 KB of M/L coordinates; I read its start and end and checked the format, not each coordinate. Its shape is also checked by the globe/liveMap tests.)

All 19 test files in the chunk (liveMap + services/__tests__) pass: 273/273 before the change and still passing after it. None of them is in the baseline-failing list. The baseline "cart sync" failures named in the brief are not in services/__tests__/cartSync.test.ts; they live outside this chunk.

## Fixes
- `artifacts/mobile/lib/liveMap/globe.ts:159`: the comment on `pulsePhase` said "0 → 1 → 0 pulse", but the function returns a 0 → 1 ramp that restarts every period. Its callers (components/globe/GlobeSurface.tsx:79-80, GlobeSurface.web.tsx:157) depend on that: they use it as a growing ring radius with opacity `1 - phase`. I changed the comment to say what the function does. The code is unchanged. This is a comment-only fix, so no test was added.
- `artifacts/mobile/services/__tests__/adCampaignService.test.ts:16`: the header listed "Reach estimate formula (shared with server)", but this file has no reach tests. Its own line 127 says reach moved to services/adReach.ts and adReach.test.ts. The header now says what the file covers: totalBudgetCents, with reach tested in adReach.test.ts. Comment-only fix, no test needed.

## Checked against the server (no defects)
- `liveMap.ts` RECENT_ORDERS_LIMIT=60 and the "last 7 days" comment match routes/seller-live-map.ts (RECENT_LIMIT=60, RECENT_WINDOW_DAYS=7). The route is mounted at /api/seller/live-map.
- The paths the tests assert match the real routes:
  - /api/ai/brand-memory/rebuild (routes/ai.ts:409)
  - /api/support/problem-reports (routes/support.ts:136)
  - /api/photography/{generate, mockup-to-model, mockup-to-model/retry} (routes/photography.ts)
  - /api/public/users/:id/videos and /api/public/products/:id/feed-videos (profile-media.ts)
  - /api/public/products?ownerId= (public.ts:159-167)
- The ad-campaign budget, duration and photo-count constants match routes/ad-campaigns.ts:62-93.
- `arcs.ts` ambientArcEnds offset math: I hand-checked that it covers 1…n-1 with no self-target for n=2, 3 and 4. pushArc and arcPhase boundaries are correct.

## Judgment calls — not changed
- None.

## Cross-chunk defects (not fixed)
- No new ones.
- The crosschunk.md entry for services/productService.ts:474/:522 (adjustInventory/adjustVariantStock) points at productService.ts, which is not in this chunk, so I did not verify or fix it here. productService.stock.test.ts (in this chunk) does not cover the case where updateProduct returns undefined. A regression test for that fix belongs with whoever owns productService.ts.

## Test files touched / created
- artifacts/mobile/services/__tests__/adCampaignService.test.ts: header comment only. No new test files.
