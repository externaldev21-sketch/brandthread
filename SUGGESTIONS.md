# Suggestions

- Search screen "TRENDING"/"BRANDS TO FOLLOW" data currently has no error state distinct from empty (a failed fetch and a genuinely-empty response render identically). A shared inline error affordance (reusing `ErrorState`) that only new plumbing (distinguishing "failed" from "empty" in the trending/suggested API hooks) would enable is a new mechanism, not built here.
- The "People" search results have no explicit empty/zero-follow-suggestions copy distinct from the generic `EmptyState` no-results message — a people-specific empty illustration/copy variant would need new content, deferred.
- `Chip`'s new `onRemove` affordance (added in this pass for recent-search chips) could replace the older ad hoc "row + x button" recent-search patterns elsewhere in the app (if any exist) for consistency — not investigated outside this screen's scope.
