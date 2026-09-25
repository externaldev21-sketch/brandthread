/**
 * Connections Screen — lists followers or following for any buyer or seller
 * profile.
 * Params:
 *   type   — 'followers' | 'following'
 *   userId — optional, defaults to the current user
 */
import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useUser } from '@clerk/expo';
import { useApi } from '@/hooks/useApi';
import { Header } from '@/components/layout';
import { ListSkeleton } from '@/components/layout/Skeleton';
import { EmptyState } from '@/components/layout/EmptyState';
import { Avatar } from '@/components/ui/Avatar';
import { PressableScale } from '@/components/BrandthreadUI';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, FS, SP } from '@/lib/theme';

interface ConnectionUser {
  id: string;
  name: string;
  username?: string;
  avatarUrl?: string;
  accountType?: string;
  isFollowing?: boolean;
}

export default function ConnectionsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { theme } = useAppTheme();
  const { user, isLoaded: clerkLoaded } = useUser();
  const api = useApi();
  const { type = 'followers', userId } = useLocalSearchParams<{ type?: string; userId?: string }>();

  const isFollowers = type === 'followers';
  const title = isFollowers ? 'Followers' : 'Following';

  const [users, setUsers] = useState<ConnectionUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(() => {
    if (!clerkLoaded || !user?.id) return;
    let active = true;
    setLoading(true);
    setError(false);
    const request = isFollowers ? api.social.followers(userId) : api.social.following(userId);
    request
      .then((data) => {
        if (!active) return;
        const list: ConnectionUser[] = (Array.isArray(data) ? data : []).map((item: any) => ({
          id: item.userId,
          name: item.name,
          username: item.username ?? undefined,
          avatarUrl: item.avatarUrl ?? undefined,
          accountType: item.accountType ?? undefined,
          isFollowing:
            'isFollowingBack' in item && typeof item.isFollowingBack === 'boolean'
              ? item.isFollowingBack
              : undefined,
        }));
        setUsers(list);
      })
      .catch(() => {
        if (active) setError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [api, clerkLoaded, user?.id, isFollowers, userId]);

  useEffect(() => {
    setUsers([]);
    const cleanup = load();
    return cleanup;
  }, [load]);

  function openProfile(item: ConnectionUser) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (item.accountType === 'seller') {
      router.push(`/seller-profile?sellerId=${item.id}` as never);
    } else {
      router.push(`/buyer-other-profile?userId=${item.id}` as never);
    }
  }

  function renderItem({ item }: { item: ConnectionUser }) {
    return (
      <PressableScale style={s.row} onPress={() => openProfile(item)}>
        <Avatar uri={item.avatarUrl} name={item.name ?? item.username} size={48} />
        <View style={{ flex: 1, marginLeft: SP.sm }}>
          <Text style={[s.name, { color: theme.text }]} numberOfLines={1}>
            {item.name ?? item.username ?? 'Unknown'}
          </Text>
          {item.username && (
            <Text style={[s.username, { color: theme.muted }]} numberOfLines={1}>
              @{item.username}
            </Text>
          )}
        </View>
        <Feather name="chevron-right" size={16} color={theme.muted} />
      </PressableScale>
    );
  }

  return (
    <View style={[s.root, { backgroundColor: theme.background }]}>
      <Header title={title} />

      {loading && (
        <View style={{ padding: SP.md }}>
          <ListSkeleton rows={8} />
        </View>
      )}

      {!loading && error && (
        <EmptyState
          icon="wifi-off"
          variant="error"
          message="Couldn't load this list. Check your connection and try again."
          actionLabel="Retry"
          onAction={load}
        />
      )}

      {!loading && !error && users.length === 0 && (
        <EmptyState
          icon="users"
          message={
            isFollowers
              ? 'No followers yet. When people follow this account, they will appear here.'
              : 'Not following anyone yet. Accounts this profile follows will appear here.'
          }
        />
      )}

      {!loading && !error && users.length > 0 && (
        <FlatList
          data={users}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          ItemSeparatorComponent={() => <View style={[s.separator, { backgroundColor: theme.border }]} />}
          contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SP.md, paddingVertical: SP.sm, minHeight: 44 },
  name: { fontSize: FS.sm, fontFamily: FONT.semibold },
  username: { fontSize: FS.xs, fontFamily: FONT.regular, marginTop: 2 },
  separator: { height: 1, marginLeft: 72 },
});
