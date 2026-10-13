/**
 * Seller Close Friends — item 84 "Close Friends for top buyers".
 *
 * Reference: Instagram's Close Friends list, copied 1:1 and reskinned
 * (https://mobbin.com/screens/e7a3f368-06ec-41dc-9239-58f4697897bb): a
 * "we don't notify" line, Search, "Your list (N)" with Clear all, then
 * suggestions, each row avatar + name + username with a round toggle on the
 * right, and one full-width Done that saves. Instagram suggests from your
 * followers; a seller's first suggestions are their top buyers by spend
 * (GET /api/social/close-friends/suggestions), followers after that.
 *
 * Rows stay where they loaded while you toggle (as on Instagram) so nothing
 * jumps under your finger; the toggle circle is the buyer Close Friends
 * screen's star radio, so both lists read the same.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, SectionList, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { TYPE_SCALE } from '@/constants/typography';
import { SPACING } from '@/constants/spacing';
import { FONT } from '@/lib/theme';
import { hapticSuccessAction, hapticToggle } from '@/lib/haptics';
import { EmptyState, SearchBar } from '@/components/BrandthreadUI';
import { ScreenHeader } from '@/components/ScreenHeader';
import { ListRow, StickyBottomCTA } from '@/components/ui';
import { goBackOr } from '@/lib/navigation/goBackOr';
import {
  loadSellerCloseFriends, saveSellerCloseFriends,
  type CloseFriendPerson, type SellerCloseFriendsData,
} from '@/services/closeFriendsService';

type SectionKey = 'list' | 'topBuyers' | 'followers';
type Section = { key: SectionKey; title: string; data: CloseFriendPerson[] };

function matches(p: CloseFriendPerson, q: string): boolean {
  if (!q) return true;
  return p.name.toLowerCase().includes(q) || p.handle.toLowerCase().includes(q);
}

export default function SellerCloseFriends() {
  const colors = useColors();
  const { theme } = useAppTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const [data, setData] = useState<SellerCloseFriendsData | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const next = await loadSellerCloseFriends();
      setData(next);
      setSelected(new Set(next.list.map((p) => p.userId)));
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const toggle = useCallback((userId: string) => {
    hapticToggle();
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId); else next.add(userId);
      return next;
    });
  }, []);

  const sections = useMemo<Section[]>(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    const out: Section[] = [
      { key: 'list', title: `Your list (${selected.size})`, data: data.list.filter((p) => matches(p, q)) },
      { key: 'topBuyers', title: 'Suggested: your top buyers', data: data.topBuyers.filter((p) => matches(p, q)) },
      { key: 'followers', title: 'Followers', data: data.followers.filter((p) => matches(p, q)) },
    ];
    // "Your list" always shows (it carries the count); empty suggestion sections don't.
    return out.filter((sec) => sec.key === 'list' || sec.data.length > 0);
  }, [data, query, selected.size]);

  async function handleDone() {
    if (saving) return;
    setSaving(true);
    try {
      const result = await saveSellerCloseFriends(Array.from(selected));
      hapticSuccessAction();
      if (result.rejected.length > 0) {
        setSelected(new Set(result.userIds));
        Alert.alert(
          result.rejected.length === 1 ? "1 person couldn't be added" : `${result.rejected.length} people couldn't be added`,
          'Close Friends can be people who follow you, people you follow, or buyers with a paid order from your store.',
        );
        return;
      }
      goBackOr(router);
    } catch {
      Alert.alert("Couldn't save", 'Your Close Friends list wasn\'t saved. Try again.');
    } finally {
      setSaving(false);
    }
  }

  const totalPeople = data ? data.list.length + data.topBuyers.length + data.followers.length : 0;

  return (
    <View style={s.page} testID="seller-close-friends">
      <ScreenHeader title="Close Friends" />
      <Text style={s.note}>We don't send notifications when you edit your Close Friends list.</Text>
      <View style={s.searchWrap}>
        <SearchBar value={query} onChange={setQuery} placeholder="Search" />
      </View>

      {!data ? (
        loadFailed ? (
          <EmptyState icon="wifi-off" title="Couldn't load your list" description="Check your connection and try again." action={{ label: 'Retry', onPress: () => { void load(); } }} />
        ) : (
          <View style={s.loading}><ActivityIndicator color={colors.mutedForeground} /></View>
        )
      ) : totalPeople === 0 ? (
        <EmptyState
          icon="star"
          title="No one to add yet"
          description="Your buyers and followers show up here."
        />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(p, i) => `${p.userId}-${i}`}
          stickySectionHeadersEnabled={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={s.listContent}
          renderSectionHeader={({ section }) => (
            <View style={s.sectionHeader}>
              <Text style={s.sectionTitle} testID={`seller-cf-section-${section.key}`}>{section.title}</Text>
              {section.key === 'list' && selected.size > 0 ? (
                <Pressable onPress={() => { hapticToggle(); setSelected(new Set()); }} hitSlop={8} accessibilityRole="button" testID="seller-cf-clear-all">
                  <Text style={s.clearAll}>Clear all</Text>
                </Pressable>
              ) : null}
            </View>
          )}
          renderItem={({ item }) => {
            const on = selected.has(item.userId);
            return (
              <ListRow
                avatar={{ uri: item.avatarUrl, name: item.name }}
                title={item.name}
                subtitle={item.handle}
                onPress={() => toggle(item.userId)}
                testID={`seller-cf-row-${item.userId}`}
                right={(
                  <Pressable
                    onPress={() => toggle(item.userId)}
                    accessibilityRole="button"
                    accessibilityLabel={on ? `Remove ${item.name} from Close Friends` : `Add ${item.name} to Close Friends`}
                    accessibilityState={{ selected: on }}
                    hitSlop={8}
                  >
                    <View style={[s.radio, on && s.radioActive]}>
                      {on && <Feather name="star" size={14} color={theme.onAccent} />}
                    </View>
                  </Pressable>
                )}
              />
            );
          }}
        />
      )}

      <StickyBottomCTA label="Done" onPress={() => { void handleDone(); }} loading={saving} disabled={!data} testID="seller-cf-done" />
    </View>
  );
}

const makeStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  page: { flex: 1, backgroundColor: 'transparent' },
  note: {
    ...TYPE_SCALE.footnote, color: colors.mutedForeground, textAlign: 'center',
    paddingHorizontal: SPACING.xl, paddingTop: SPACING.xxs,
  },
  searchWrap: { paddingHorizontal: SPACING.md, paddingTop: SPACING.sm, paddingBottom: SPACING.xxs },
  loading: { paddingVertical: SPACING.xl, alignItems: 'center' },
  listContent: { paddingHorizontal: SPACING.md, paddingBottom: 140 },
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: SPACING.md, paddingBottom: SPACING.xxs,
  },
  sectionTitle: { ...TYPE_SCALE.body, fontFamily: FONT.semibold, color: colors.foreground },
  clearAll: { ...TYPE_SCALE.body, fontFamily: FONT.semibold, color: colors.mutedForeground },
  radio: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  radioActive: { backgroundColor: colors.primary, borderColor: colors.primary },
});
