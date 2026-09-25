# Suggestions — deferred, not built

Notes from the app-wide error/offline states pass (Phase 2). Nothing below was
built; each item either needs a new mechanism or belongs to a screen owned by
another Phase-2 workstream, so it's listed here instead per the "no new
mechanisms" rule.

## Screens with local error/retry blocks not migrated to `ErrorState`

These render a small "something went wrong" box similar in shape to
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

## No new mechanisms identified in this pass

Everything above is a migration/consistency task, not a new capability — no
new mechanism is needed to do it, just scope/ownership boundaries this
workstream is deliberately not crossing.
