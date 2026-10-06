/**
 * Hide story from — the people who never see your stories, even when they
 * follow you. Server-backed (GET/PUT /api/interaction-settings/story-hidden)
 * and enforced on every story read path.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, FlatList, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { useApi } from '@/lib/api';
import { TYPE_SCALE } from '@/constants/typography';
import { SPACING } from '@/constants/spacing';
import { hapticSuccessAction, hapticToggle } from '@/lib/haptics';
import { EmptyState } from '@/components/BrandthreadUI';
import { ScreenHeader } from '@/components/ScreenHeader';
import { ListRow, StickyBottomCTA } from '@/components/ui';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { isBuyerDevPreview } from '@/lib/devPreview';
import { hiddenListChanged, peopleCountLabel } from '@/lib/interactionSettings';

type Follower = { userId: string; name: string; handle: string };

export default function BuyerStoryHidden() {
  const colors = useColors();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const api = useApi();
  const previewOnly = isBuyerDevPreview();
  const [followers, setFollowers] = useState<Follower[]>([]);
  const [saved, setSaved] = useState<string[]>([]);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoadFailed(false);
    // Signed-out web preview: no protected API calls; a fresh account follows no one.
    if (previewOnly) { setLoading(false); return; }
    try {
      const [list, current] = await Promise.all([api.social.followers(), api.interactionSettings.storyHidden()]);
      setFollowers(list.map(f => ({ userId: f.userId, name: f.name, handle: f.handle })));
      setSaved(current.userIds);
      setHidden(new Set(current.userIds));
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [api, previewOnly]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  function toggle(userId: string) {
    hapticToggle();
    setHidden(prev => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId); else next.add(userId);
      return next;
    });
  }

  const changed = hiddenListChanged(saved, hidden);

  async function handleSave() {
    if (saving || !changed || previewOnly) return;
    setSaving(true);
    try {
      const result = await api.interactionSettings.setStoryHidden(Array.from(hidden));
      setSaved(result.userIds);
      hapticSuccessAction();
      goBackOr(router, '/buyer-settings-detail?section=story');
    } catch {
      Alert.alert('Could not save', 'Try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={s.page}>
      <ScreenHeader title="Hide story from" variant="push" onBack={() => goBackOr(router, '/buyer-settings-detail?section=story')} />
      <Text style={s.intro}>
        People you choose won't see your stories, even if they follow you. They aren't notified.
      </Text>
      {hidden.size > 0 ? <Text style={s.count}>{peopleCountLabel(hidden.size)} hidden</Text> : null}
      {loading ? null : (
        <FlatList
          data={followers}
          keyExtractor={f => f.userId}
          renderItem={({ item }) => (
            <ListRow
              avatar={{ name: item.name }}
              title={item.name}
              subtitle={item.handle}
              toggle={{ value: hidden.has(item.userId), onChange: () => toggle(item.userId) }}
            />
          )}
          contentContainerStyle={{ paddingHorizontal: SPACING.md, paddingBottom: insets.bottom + 120 }}
          ItemSeparatorComponent={() => <View style={s.separator} />}
          ListEmptyComponent={loadFailed ? (
            <EmptyState
              icon="wifi-off"
              title="Couldn't load your followers"
              description="Check your connection and try again."
              action={{ label: 'Try again', onPress: () => { void load(); } }}
            />
          ) : (
            <EmptyState
              icon="users"
              title="No followers yet"
              description="Your stories are shown to people who follow you. Anyone who follows you will appear here."
            />
          )}
        />
      )}
      {followers.length > 0 ? (
        <StickyBottomCTA label="Save" onPress={() => { void handleSave(); }} loading={saving} disabled={!changed} />
      ) : null}
    </View>
  );
}

const makeStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  intro: { ...TYPE_SCALE.footnote, color: colors.mutedForeground, padding: SPACING.md, paddingBottom: SPACING.sm },
  count: { ...TYPE_SCALE.caption, color: colors.foreground, paddingHorizontal: SPACING.md, marginBottom: SPACING.xxs },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: 52 },
});
