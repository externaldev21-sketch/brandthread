/**
 * Shared FlatList tuning for long, server-driven lists (comments,
 * notifications, people, saved items, messages, reviews).
 *
 * Spread it onto a FlatList next to `keyExtractor`:
 *   <FlatList {...LONG_LIST_TUNING} ... />
 *
 * React Native's defaults render 10 rows first and keep 21 viewports mounted,
 * which for a 500-row list means hundreds of mounted rows after a few
 * flicks. These values render one screen first, batch further rows in
 * small steps and keep roughly 4 screens around the viewport. Nothing here
 * changes how a row looks; rows that are scrolled back to simply mount
 * again. `removeClippedSubviews` is Android-only on purpose: on iOS and web
 * it can leave blank gaps with sticky headers and inverted lists.
 *
 * Do not use it on paging carousels that depend on every page being mounted
 * (see lib/feedPager.ts) or on lists that are always short.
 */
import { Platform } from 'react-native';

export const LONG_LIST_TUNING = {
  initialNumToRender: 12,
  maxToRenderPerBatch: 8,
  updateCellsBatchingPeriod: 50,
  windowSize: 9,
  removeClippedSubviews: Platform.OS === 'android',
} as const;

/** Stable key for rows that have an `id`, falling back to the index. */
export function keyByIdOrIndex(item: { id?: string | number } | null | undefined, index: number): string {
  return item?.id != null ? String(item.id) : `row-${index}`;
}
