/**
 * Pending tags — tags waiting for approval while "Manually approve tags" is on
 * (Settings → Tags and mentions). Server-backed: GET
 * /api/interaction-settings/pending-tags; Approve shows the post or story on
 * your Tagged tab, Remove untags you. Pending tags never reach your Tagged
 * tab, Story mentions or notifications.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, FlatList, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { useApi } from '@/lib/api';
import { TYPE_SCALE } from '@/constants/typography';
import { SPACING } from '@/constants/spacing';
import { hapticSuccessAction } from '@/lib/haptics';
import { EmptyState } from '@/components/BrandthreadUI';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Button, ListRow } from '@/components/ui';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { isBuyerDevPreview } from '@/lib/devPreview';
import { PendingTag, pendingTagTitle } from '@/lib/interactionSettings';
import { shortRelativeTime } from '@/lib/safety';

export default function BuyerPendingTags() {
  const colors = useColors();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const api = useApi();
  const previewOnly = isBuyerDevPreview();
  const [items, setItems] = useState<PendingTag[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadFailed(false);
    // Signed-out web preview: no protected API calls; a fresh account has no pending tags.
    if (previewOnly) { setLoading(false); return; }
    try {
      const { items: pending } = await api.interactionSettings.pendingTags();
      setItems(Array.isArray(pending) ? pending : []);
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [api, previewOnly]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  async function act(tag: PendingTag, action: 'approve' | 'remove') {
    const key = `${tag.kind}:${tag.id}`;
    if (busyKey || previewOnly) return;
    setBusyKey(key);
    try {
      if (action === 'approve') await api.interactionSettings.approveTag(tag.kind, tag.id);
      else await api.interactionSettings.removeTag(tag.kind, tag.id);
      setItems(prev => prev.filter(item => `${item.kind}:${item.id}` !== key));
      hapticSuccessAction();
    } catch {
      Alert.alert(action === 'approve' ? 'Could not approve tag' : 'Could not remove tag', 'Try again.');
    } finally {
      setBusyKey(null);
    }
  }

  function confirmRemove(tag: PendingTag) {
    Alert.alert('Remove tag?', `You won't be tagged in this ${tag.kind === 'story' ? 'story' : 'post'}.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => { void act(tag, 'remove'); } },
    ]);
  }

  return (
    <View style={s.page}>
      <ScreenHeader title="Pending tags" variant="push" onBack={() => goBackOr(router, '/buyer-settings-detail?section=tags')} />
      <Text style={s.intro}>
        Approve a tag to show it on your profile's Tagged tab. Remove it to untag yourself.
      </Text>
      {loading ? null : (
        <FlatList
          data={items}
          keyExtractor={item => `${item.kind}:${item.id}`}
          renderItem={({ item }) => {
            const key = `${item.kind}:${item.id}`;
            return (
              <ListRow
                avatar={{ uri: item.thumbnailUrl, name: item.authorName ?? item.authorUsername ?? undefined }}
                title={pendingTagTitle(item)}
                subtitle={shortRelativeTime(item.createdAt)}
                right={(
                  <View style={s.actions}>
                    <Button
                      label="Approve"
                      onPress={() => { void act(item, 'approve'); }}
                      size="compact"
                      loading={busyKey === key}
                      disabled={busyKey !== null && busyKey !== key}
                      accessibilityLabel={`Approve tag from ${item.authorUsername ?? item.authorName ?? 'this account'}`}
                    />
                    <Button
                      label="Remove"
                      onPress={() => confirmRemove(item)}
                      variant="secondary"
                      size="compact"
                      disabled={busyKey !== null}
                      accessibilityLabel={`Remove tag from ${item.authorUsername ?? item.authorName ?? 'this account'}`}
                    />
                  </View>
                )}
              />
            );
          }}
          contentContainerStyle={{ paddingHorizontal: SPACING.md, paddingBottom: insets.bottom + SPACING.xxl }}
          ItemSeparatorComponent={() => <View style={s.separator} />}
          ListEmptyComponent={loadFailed ? (
            <EmptyState
              icon="wifi-off"
              title="Couldn't load pending tags"
              description="Check your connection and try again."
              action={{ label: 'Try again', onPress: () => { void load(); } }}
            />
          ) : (
            <EmptyState
              icon="tag"
              title="No pending tags"
              description="When Manually approve tags is on, new tags of you wait here until you approve them."
            />
          )}
        />
      )}
    </View>
  );
}

const makeStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  intro: { ...TYPE_SCALE.footnote, color: colors.mutedForeground, padding: SPACING.md, paddingBottom: SPACING.sm },
  actions: { flexDirection: 'row', gap: SPACING.xs },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: 52 },
});
