# Suggestions — deferred, not built

Aggregated across all Phase 2 workstreams in this PR. Nothing below was
built; each item either needs a new mechanism or belongs to a screen owned
by another Phase-2 workstream, so it's listed here per the "no new
mechanisms" rule.

## From the search overlay pass

- Search screen "TRENDING"/"BRANDS TO FOLLOW" data currently has no error state distinct from empty (a failed fetch and a genuinely-empty response render identically). A shared inline error affordance (reusing `ErrorState`) that only new plumbing (distinguishing "failed" from "empty" in the trending/suggested API hooks) would enable is a new mechanism, not built here.
- The "People" search results have no explicit empty/zero-follow-suggestions copy distinct from the generic `EmptyState` no-results message — a people-specific empty illustration/copy variant would need new content, deferred.
- `Chip`'s new `onRemove` affordance (added in this pass for recent-search chips) could replace the older ad hoc "row + x button" recent-search patterns elsewhere in the app (if any exist) for consistency — not investigated outside this screen's scope.

## From the error/offline states pass

Screens with local error/retry blocks not migrated to `ErrorState`: these
render a small "something went wrong" box similar in shape to
`components/ui/ErrorState.tsx`, but each is embedded inside a larger screen
whose body is out of this workstream's scope (full-screen public landing
pages, multi-step flows, or a component explicitly commented as owned by
another surface). Retokenizing just the error branch without touching the
surrounding screen would leave the rest of that screen's local styling
untouched and inconsistent, so these are left for whichever Phase-2
workstream owns each screen:

- `components/ShopProductSheet.tsx` (`phase === 'error'`, ~line 628) —
  `components/buy-now/VariantPickerSheet.tsx`'s own header comment notes this
  file "is owned by another surface and is not edited here"; left alone for
  the same reason.
- `components/FinanceMoneyFlow.tsx` (`error && !summary`, ~line 54) — part of
  a large, entirely non-tokenized finance component (raw `fontSize` /
  `'Inter_600SemiBold'` strings throughout); the error block alone isn't
  worth touching without retokenizing the rest of the file, which is a
  bigger finance-surface job.
- `app/u/[username].tsx` (`state.kind === 'error'`, ~line 379) — one branch
  of a public profile landing screen that also has its own `not_found`
  branch with different icon/copy/CTA; migrating only the error branch would
  make the two branches look inconsistent with each other.
- `app/c/[collectionId].tsx` (`state.kind === 'error'`, ~line 84) — same
  pattern as above (shared not_found/error branch, public collection
  landing).
- `app/design-campaign.tsx` (`initError`, ~line 1042) — error branch of a
  multi-step ad-campaign flow; its CTA is "Go back" (not a retry), and the
  screen already has its own step-flow chrome (`renderHeader()`, stage
  headings) that a stray `ErrorState` swap wouldn't match.

`components/InlineFeedback.tsx` (`InlineError`, `SectionError`) was reviewed
and left as-is — it's a deliberately different "compact, inline" variant
(not a duplicate of `ErrorState`), and it already reads from `lib/theme.ts`
tokens (`FONT`/`FS`/`SP`/`RADIUS`/`CARD`/`BORDER`/etc.), not raw numbers, so
it isn't part of the audit's "raw fontSize/fontWeight" finding.

## No new mechanisms identified in these passes

Everything above is a migration/consistency task, not a new capability — no
new mechanism is needed to do it, just scope/ownership boundaries each
workstream deliberately did not cross.
