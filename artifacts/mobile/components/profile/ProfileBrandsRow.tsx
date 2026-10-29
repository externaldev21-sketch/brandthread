/**
 * The brands on a buyer's profile, as one quiet row of outline chips under
 * the highlights: a small brand avatar, the name, and what this buyer is to
 * that brand ("Day 1"). Renders nothing when there's nothing to show, and
 * scrolls sideways past a phone width. Tapping opens the brand.
 */
import { openProfilePeek } from '@/components/peek/QuickPeek';
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Avatar } from '@/components/ui/Avatar';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';

export type ProfileBrandItem = {
  sellerId: string;
  name: string;
  avatarUrl: string | null;
  /** Short tags shown after the name, e.g. ["Day 1"]. */
  tags: string[];
};

export function ProfileBrandsRow({ items, testID = 'profile-brands' }: { items: ProfileBrandItem[]; testID?: string }) {
  const router = useRouter();
  const { theme } = useAppTheme();
  if (items.length === 0) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.row} testID={testID}>
      {items.map((b) => (
        <Pressable
          key={b.sellerId}
          onPress={() => router.push(`/seller-profile?id=${encodeURIComponent(b.sellerId)}` as never)}
          // Long-press peeks the brand with Follow (pack 2, item 28).
          onLongPress={() => openProfilePeek({
            userId: b.sellerId,
            name: b.name,
            avatarUri: b.avatarUrl,
            onOpen: () => router.push(`/seller-profile?id=${encodeURIComponent(b.sellerId)}` as never),
          })}
          delayLongPress={350}
          style={[s.chip, { borderColor: theme.border }]}
          accessibilityRole="button"
          accessibilityLabel={[b.name, ...b.tags].join(', ')}
        >
          <Avatar uri={b.avatarUrl ?? undefined} name={b.name} size={24} />
          <Text style={[s.name, { color: theme.text }]} numberOfLines={1}>{b.name}</Text>
          {b.tags.map((t) => (
            <View key={t} style={s.tagWrap}>
              <Text style={[s.tag, { color: theme.muted }]}>· {t}</Text>
            </View>
          ))}
        </Pressable>
      ))}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  row: { paddingHorizontal: SP.md, gap: SP.sm },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 34, paddingLeft: 5, paddingRight: 12, borderWidth: 1, borderRadius: RADIUS.pill, maxWidth: 340 },
  name: { fontFamily: FONT.semibold, fontSize: FS.sm, flexShrink: 1 },
  tagWrap: { flexShrink: 0 },
  tag: { fontFamily: FONT.medium, fontSize: FS.sm },
});
