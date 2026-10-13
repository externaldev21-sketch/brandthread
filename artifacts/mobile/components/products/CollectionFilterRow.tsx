/**
 * "Collection" filter row for the bulk editor (Select products).
 *
 * A collection is a product category or tag name — the same thing a
 * collection sale targets (GET /api/sales/collections lists them; the bulk
 * list filters with ?collection=). Tapping the row opens the shared
 * OptionSheet, like Shopify iOS's product filter list. Renders nothing until
 * the seller has at least one collection.
 */
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { ListRow } from '@/components/ui/ListRow';
import { OptionSheet } from '@/components/ui/OptionSheet';
import { useApi } from '@/lib/api';

export const ALL_COLLECTIONS = '';

export function CollectionFilterRow({ value, onChange, enabled }: {
  value: string;
  onChange: (collection: string) => void;
  /** False in the signed-out preview / before auth loads: never calls the API. */
  enabled: boolean;
}) {
  const api = useApi();
  const [names, setNames] = useState<string[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    api.sales.collections()
      .then((list) => { if (alive) setNames(Array.isArray(list) ? list.filter((n) => typeof n === 'string' && n.trim()) : []); })
      .catch(() => { if (alive) setNames([]); });
    return () => { alive = false; };
  }, [api, enabled]);

  if (names.length === 0 && !value) return null;

  return (
    <View>
      <ListRow
        title="Collection"
        value={value || 'All'}
        chevron
        onPress={() => setOpen(true)}
        testID="bulk-collection-filter"
      />
      <OptionSheet
        visible={open}
        onClose={() => setOpen(false)}
        title="Collection"
        options={[{ id: ALL_COLLECTIONS, label: 'All collections' }, ...names.map((n) => ({ id: n, label: n }))]}
        selectedId={value}
        onSelect={(id) => { onChange(id); setOpen(false); }}
        testID="bulk-collection-sheet"
      />
    </View>
  );
}
