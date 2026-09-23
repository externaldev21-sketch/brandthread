/**
 * Test stand-in for @shopify/flash-list (aliased in vitest.config.ts).
 *
 * The real FlashList measures layout and recycles native views, neither of
 * which exists under react-test-renderer. This renders every item in order,
 * like the FlatList mocks the screen tests already use, so tests can find rows.
 */
import React from 'react';

type Props<T> = {
  data?: readonly T[] | null;
  renderItem: (info: { item: T; index: number; target: 'Cell' }) => React.ReactNode;
  keyExtractor?: (item: T, index: number) => string;
  ListHeaderComponent?: React.ComponentType | React.ReactElement | null;
  ListEmptyComponent?: React.ComponentType | React.ReactElement | null;
  ListFooterComponent?: React.ComponentType | React.ReactElement | null;
  ItemSeparatorComponent?: React.ComponentType | null;
  [key: string]: unknown;
};

function renderSlot(slot: Props<unknown>['ListHeaderComponent']) {
  if (!slot) return null;
  return React.isValidElement(slot) ? slot : React.createElement(slot as React.ComponentType);
}

export function FlashList<T>({
  data,
  renderItem,
  keyExtractor,
  ListHeaderComponent,
  ListEmptyComponent,
  ListFooterComponent,
  ItemSeparatorComponent,
  ...rest
}: Props<T>) {
  const items = (data ?? []).map((item, index) => (
    <React.Fragment key={keyExtractor ? keyExtractor(item, index) : String(index)}>
      {index > 0 && ItemSeparatorComponent ? <ItemSeparatorComponent /> : null}
      {renderItem({ item, index, target: 'Cell' })}
    </React.Fragment>
  ));
  return React.createElement(
    'FlashList',
    rest,
    renderSlot(ListHeaderComponent),
    items.length > 0 ? items : renderSlot(ListEmptyComponent),
    renderSlot(ListFooterComponent),
  );
}

export type ListRenderItemInfo<T> = { item: T; index: number; target: 'Cell' };
