# Suggestions — Tab bar token-drift verification pass

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
