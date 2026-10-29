# Full read, wave 1: mobile shared code

Scope: every file under `artifacts/mobile/lib`, `artifacts/mobile/services`,
`artifacts/mobile/hooks` and `artifacts/mobile/components` on `dev` at
`71a99506`: 2,217 files, 273,394 lines. Every line of every file was read
top to bottom. Files owned by other sessions were read for understanding and
not changed: `components/SellerGlobalTabBar.tsx`, `lib/theme.ts`,
`components/SellerStudioRadialMenu*`, `components/AccountSwitcherSheet.tsx`,
`components/navigation/*`, `components/globe/*`,
`hooks/usePreloadedSceneEffect.ts` and `lib/navigation/*`.

The slice was split into 25 chunks of about 11k lines, grouped by directory.
Each chunk file below holds that chunk's log:

- **Files read:** one row per file, with lines read (= file length), defects
  found and defects fixed.
- **Fixes:** file:line, the failure it caused, the fix and its test.
- **Judgment calls — not changed:** what was left alone and why.
- **Cross-chunk defects:** defects whose fix belonged in another chunk's
  files. Entries for files inside the slice were handed to the owning chunk
  and fixed there.
- **Test files touched / created.**

| chunk | files | lines | found | fixed |
| --- | ---: | ---: | ---: | ---: |
| [00](chunk-00.md) | 49 | 9,884 | 12 | 10 |
| [01](chunk-01.md) | 52 | 11,243 | 10 | 8 |
| [02](chunk-02.md) | 66 | 13,190 | 15 | 15 |
| [03](chunk-03.md) | 62 | 7,881 | 18 | 18 |
| [04](chunk-04.md) | 56 | 13,186 | 11 | 11 |
| [05](chunk-05.md) | 78 | 13,220 | 19 | 19 |
| [06](chunk-06.md) + globe (below) | 51 | 9,830 | 5 | 5 |
| [07](chunk-07.md) | 74 | 13,163 | 16 | 16 |
| [08](chunk-08.md) | 73 | 8,400 | 12 | 12 |
| [09](chunk-09.md) | 79 | 11,256 | 19 | 19 |
| [10](chunk-10.md) | 45 | 7,418 | 10 | 10 (story countdown fixed in chunk 25) |
| [11](chunk-11.md) | 144 | 12,439 | 12 | 12 |
| [12](chunk-12.md) | 112 | 11,282 | 14 | 12 |
| [13](chunk-13.md) | 54 | 5,642 | 10 | 7 |
| [14](chunk-14.md) | 74 | 11,475 | 6 | 5 |
| [15](chunk-15.md) | 157 | 11,467 | 10 | 10 |
| [16](chunk-16.md) | 158 | 11,363 | 10 | 10 |
| [17](chunk-17.md) | 137 | 12,803 | 15 | 15 |
| [18](chunk-18.md) | 23 | 3,831 | 2 | 2 |
| [19](chunk-19.md) | 126 | 11,244 | 13 | 13 |
| [20](chunk-20.md) | 128 | 11,454 | 10 | 10 |
| [21](chunk-21.md) | 151 | 11,458 | 13 | 13 |
| [22](chunk-22.md) | 153 | 12,201 | 17 | 15 |
| [24](chunk-24.md) | 61 | 13,928 | 20 | 20 |
| [25](chunk-25.md) | 54 | 14,136 | 14 | 14 |
| **total** | **2,217** | **273,394** | **313** | **301** |

(Chunk 23 was folded into chunk 18.) The 12 defects that were found but not
fixed are in files outside this slice or owned by another session, or need a
product decision; each is listed in its chunk log and in the PR.

## `components/globe/*` (read by the lead)

| file | lines read | defects found | defects fixed |
| --- | ---: | ---: | ---: |
| components/globe/FlatOrderMap.tsx | 114 | 0 | 0 |
| components/globe/GlobeSurface.tsx | 195 | 0 | 0 |
| components/globe/GlobeSurface.web.tsx | 231 | 0 | 0 |
| components/globe/OrderGlobePopover.tsx | 159 | 0 | 0 |
| components/globe/globeColors.ts | 34 | 0 | 0 |

## Lead adjustments after the chunk logs were written

- The chunk 25 log mentions stamping `receivedAt` in
  `app/buyer-story-viewer.tsx`. That edit was reverted because `app/` is
  outside this slice. Stories fetched by id and highlight stories fall back
  to the previous offset (`serverNow - Date.now()` at mount) until that screen
  passes stamped stories.
- The chunk 15 comment in `lib/dashboardAISuggestions.ts` quoted the removed
  `/inventory` path, which `tests/inventory-removal.structure.test.ts` flags.
  The comment was reworded.
- `components/live/LiveThreadCashSheet.tsx`: the recipient/stream guard was
  nested so `streamId` narrows for the `liveGift` call (typecheck). There is
  no behaviour change.
- Audit tests compare renderer node types as `unknown`, so they typecheck.
