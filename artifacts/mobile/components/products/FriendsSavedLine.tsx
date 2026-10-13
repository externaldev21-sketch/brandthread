/**
 * "3 friends saved this" under the product page price. 13pt secondary text,
 * only when at least one person you follow saved the product; nothing at all
 * otherwise (no placeholder, no banner). Tapping lists who, Instagram "Liked by"
 * style; a row opens that person's profile.
 */
import React, { useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { useApi } from '@/hooks/useApi';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { Avatar, BottomSheet } from '@/components/ui';
import { FONT, FS, SP } from '@/lib/theme';
import { friendsSavedLabel, type FriendsSaved, type FriendsSavedPerson } from '@/lib/friendsSaved';

export function FriendsSavedLine({ productId }: { productId: string }) {
  const api = useApi();
  const router = useRouter();
  const { isSignedIn } = useAuth();
  const { theme } = useAppTheme();
  const [data, setData] = useState<FriendsSaved | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setData(null);
    if (!isSignedIn || !productId) return;
    let active = true;
    api.buyer.saved.friends(productId)
      .then((res) => { if (active) setData(res); })
      .catch(() => {});
    return () => { active = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId, isSignedIn]);

  const label = friendsSavedLabel(data);
  if (!label || !data) return null;

  const openProfile = (p: FriendsSavedPerson) => {
    setOpen(false);
    router.push({
      pathname: '/buyer-other-profile' as never,
      params: { userId: p.userId, name: p.name, handle: p.handle, initials: p.initials },
    } as never);
  };

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={`${label}. Show who`}
        testID="product-friends-saved"
        style={styles.line}
      >
        <Text style={[styles.lineText, { color: theme.muted }]}>{label}</Text>
      </Pressable>
      <BottomSheet visible={open} onClose={() => setOpen(false)} testID="product-friends-saved-sheet">
        <Text style={[styles.sheetTitle, { color: theme.text }]}>Saved by</Text>
        <FlatList
          data={data.people}
          keyExtractor={(p) => p.userId}
          scrollEnabled={false}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => openProfile(item)}
              style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}
              accessibilityRole="button"
              accessibilityLabel={item.name}
            >
              <Avatar uri={item.avatarUrl} name={item.name} size={40} />
              <View style={styles.rowText}>
                <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>{item.name}</Text>
                {!!item.handle && (
                  <Text style={[styles.handle, { color: theme.muted }]} numberOfLines={1}>{item.handle}</Text>
                )}
              </View>
            </Pressable>
          )}
        />
      </BottomSheet>
    </>
  );
}

const styles = StyleSheet.create({
  line: { alignSelf: 'flex-start', marginTop: -SP.xs, marginBottom: SP.sm },
  lineText: { fontSize: FS.sm, fontFamily: FONT.regular },
  sheetTitle: { fontSize: FS.base, fontFamily: FONT.semibold, textAlign: 'center', paddingBottom: SP.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: SP.md, paddingVertical: SP.sm },
  rowText: { flex: 1, minWidth: 0 },
  name: { fontSize: FS.base, fontFamily: FONT.semibold },
  handle: { fontSize: FS.sm, fontFamily: FONT.regular, marginTop: 1 },
});
