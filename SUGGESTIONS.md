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

## From the buyer settings sub-pages pass (batch 1)

- **buyer-settings.tsx** — "Soon" catalog rows (e.g. any future `soon: true` item in `BUYER_SETTINGS_CATALOG`) are rendered by reusing `ListRow`'s existing `value` text slot to show "Soon", since `ListRow` has no dedicated badge/pill slot. A proper "Soon" pill (small rounded badge, like the old `SettingsRow`'s `soon` badge in `components/settings/SettingsKit.tsx`) would need a new `badge`/`soon` prop added to `components/ui/ListRow.tsx`.
- **buyer-privacy-settings.tsx** — Privacy hub still shows/saves via native `Alert.alert` action sheets for single-choice pickers (profile visibility, audience selectors, DM privacy). A proper design-system picker sheet (built on `BottomSheet` + `ListRow`/radio rows) would read as more "Brandthread" than the OS action sheet, but that's a new mechanism, not a restyle of an existing one, so it's left as-is.
- **components/settings/SettingsKit.tsx** — `SettingsRow`/`SettingsSection` (used by the out-of-scope `seller-settings.tsx`) are effectively a parallel, hand-rolled implementation of `components/ui/ListRow.tsx` + `Card` + `SectionHeader`, predating this phase's `ListRow`. Buyer screens in this phase (`buyer-settings.tsx`, `buyer-privacy-settings.tsx`) were migrated off it onto the shared `ListRow`/`Card`/`SectionHeader`, but `SettingsKit.tsx` itself was left untouched since `seller-settings.tsx` (which still depends on it) is out of scope for this phase. Consolidating `SettingsKit.tsx` to be built on top of `ListRow` internally would remove the duplication for a future phase that includes seller settings.

## From the tab bar token-drift verification pass

Deferred items found while verifying `components/buyer-nav/BuyerTabBar.tsx`,
`components/SellerGlobalTabBar.tsx`, `components/tab-bar/TabBarParts.tsx`,
`components/buyer-nav/BuyerNavIcon.tsx`, `components/buyer-nav/buyerTabBarMetrics.ts`
against the Phase 1 design tokens. These are **not** fixed because a real fix
would require a structure/behavior change or a design decision, which is out
of scope for a token-alignment-only pass.

1. **`buyerTabBarMetrics.ts` `iconSize` (25 / 27) doesn't match the documented
   20/24/28 icon-size subset.** The values are hand-tuned per breakpoint
   (`isTablet ? 27 : 25`) as part of the already-approved capsule geometry —
   snapping them to 24/28 would visibly change icon size and the capsule's
   internal proportions across every screen width. That's a visual change,
   not a token substitution, so it needs design sign-off rather than a
   mechanical edit.

2. **Icon stroke-weight overrides away from the documented 1.8** appear in a
   few spots: the inline search-field glyph (`strokeWidth={2}`), the clear
   button "×" (`strokeWidth={2.4}`), the filters icon (`strokeWidth={1.9}`),
   the profile↔close circle icon (`strokeWidth={2}`), and `BuyerNavIcon`'s own
   `search`/`close` cases (`+0.5` when focused, `+0.2` baseline for `close`).
   These read as deliberate legibility compensation for small glyphs
   (12–20px render size), not accidental drift, but they are inconsistent
   with the spec's single 1.8 value. Flattening them all to 1.8 would
   visibly thin several tab-bar icons — worth a design review rather than a
   blind edit.

3. **`TabBarBadge` (`components/tab-bar/TabBarParts.tsx`) duplicates
   `CountBadge` (`components/Badge.tsx`) instead of reusing it.** The design
   doc's own `CountBadge` doc comment says it was extracted *from*
   `TabBarBadge`'s shape for reuse elsewhere — so `TabBarBadge` is the
   original, and it carries spring/bounce-on-count-change animation that
   `CountBadge` doesn't have. Swapping the tab bar over to `CountBadge` would
   remove that animation, a real behavior change, so it's left as-is.

4. **The tab bar's press/pop physics** (`PRESS_IN`, `PRESS_OUT`, `POP_UP`,
   `POP_SETTLE` in `TabBarParts.tsx`) are bespoke Reanimated springs, not the
   generic `PRESS_SCALE`/`PRESS_DURATION_MS` tokens from `constants/motion.ts`.
   This matches the design doc's explicit note that the tab bar's existing
   "squish + bounce-on-selection" feel was kept as-is rather than migrated to
   the generic `components/ui/` press token — flagging here only so a future
   pass doesn't "fix" it without realizing that's intentional.

## What was changed

- `components/buyer-nav/BuyerTabBar.tsx`: the search field's small "clear"/
  "filters" buttons used a hardcoded `scale: 0.94` press-feedback value that
  drifted from the documented press-scale token
  (`constants/motion.ts` `PRESS_SCALE = 0.97`). Replaced the literal with an
  import of `PRESS_SCALE`. No visual/behavioral change beyond a 0.03 scale
  delta on those two small buttons; no structure, order, or mechanism
  changed.

Everything else checked (typography sizes/weights, spacing, radii, badge
sizing, color sourcing) already matched the design-system tokens or was
already theme-driven — consistent with the design doc's note that the tab
bars were already a single, shared, polished implementation left
functionally unchanged in Phase 1.
