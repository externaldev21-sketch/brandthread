/**
 * Connections Screen — lists followers or following for a seller profile.
 * Params:
 *   type   — 'followers' | 'following'
 *   userId — optional, defaults to the current seller
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, Image,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  BG, CARD, BORDER, FG, MUTED, PURPLE, FONT, FS, SP, RADIUS,
} from '@/lib/theme';
import { useColors } from '@/hooks/useColors';
import { useUser } from '@clerk/expo';
import { useApi } from '@/hooks/useApi';

interface ConnectionUser {
  id: string;
  name: string;
  username?: string;
  avatarUrl?: string;
  isFollowing?: boolean;
}

export default function ConnectionsScreen() {
  const colors = useColors();
  const router   = useRouter();
  const insets   = useSafeAreaInsets();
  const { user, isLoaded: clerkLoaded } = useUser();
  const api = useApi();
  const { type = 'followers', userId } = useLocalSearchParams<{ type?: string; userId?: string }>();

  const isFollowers = type === 'followers';
  const title       = isFollowers ? 'Followers' : 'Following';

  const [users, setUsers]     = useState<ConnectionUser[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    if (!clerkLoaded || !user?.id) return;
    let active = true;
    setLoading(true);
    const request = isFollowers ? api.social.followers(userId) : api.social.following(userId);
    request
      .then(data => {
        if (!active) return;
        const list: ConnectionUser[] = (Array.isArray(data) ? data : []).map((item) => ({
          id: item.userId,
          name: item.name,
          username: item.username ?? undefined,
          isFollowing: 'isFollowingBack' in item && typeof item.isFollowingBack === 'boolean'
            ? item.isFollowingBack
            : undefined,
        }));
        setUsers(list);
      })
      .catch(() => { if (active) setUsers([]); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [api, clerkLoaded, user?.id, isFollowers, userId]);

  useEffect(() => {
    setUsers([]);
    const cleanup = load();
    return cleanup;
  }, [load]);

  function renderItem({ item }: { item: ConnectionUser }) {
    const initials = (item.name ?? item.username ?? '?')
      .split(' ')
      .map((w: string) => w[0])
      .join('')
      .slice(0, 2)
      .toUpperCase();

    return (
      <TouchableOpacity
        style={s.row}
        activeOpacity={0.8}
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          router.push(`/seller-profile?sellerId=${item.id}` as never);
        }}
      >
        {item.avatarUrl ? (
          <Image source={{ uri: item.avatarUrl }} style={s.avatar} />
        ) : (
          <View style={s.avatarFallback}>
            <Text style={s.avatarInitials}>{initials}</Text>
          </View>
        )}
        <View style={{ flex: 1, marginLeft: SP.sm }}>
          <Text style={s.name} numberOfLines={1}>{item.name ?? item.username ?? 'Unknown'}</Text>
          {item.username && <Text style={s.username} numberOfLines={1}>@{item.username}</Text>}
        </View>
        <Feather name="chevron-right" size={16} color={MUTED} />
      </TouchableOpacity>
    );
  }

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Feather name="arrow-left" size={22} color={FG} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>{title}</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading && (
        <View style={s.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      )}

      {!loading && users.length === 0 && (
        <View style={s.center}>
          <Feather name="users" size={40} color={MUTED} />
          <Text style={s.emptyTitle}>No {title.toLowerCase()} yet</Text>
          <Text style={s.emptyBody}>
            {isFollowers
              ? 'When buyers follow this account, they will appear here.'
              : 'Accounts that this profile follows will appear here.'}
          </Text>
        </View>
      )}

      {!loading && users.length > 0 && (
        <FlatList
          data={users}
          keyExtractor={item => item.id}
          renderItem={renderItem}
          ItemSeparatorComponent={() => <View style={s.separator} />}
          contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root:   { flex: 1, backgroundColor: 'transparent' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: SP.lg },

  header:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SP.md, paddingVertical: SP.sm, borderBottomWidth: 1, borderBottomColor: BORDER },
  headerTitle: { fontSize: FS.md, fontFamily: FONT.bold, color: FG },
  backBtn:     { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },

  row:          { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SP.md, paddingVertical: SP.sm },
  avatar:       { width: 44, height: 44, borderRadius: 22 },
  avatarFallback:{ width: 44, height: 44, borderRadius: 22, backgroundColor: PURPLE + '22', borderWidth: 1, borderColor: PURPLE + '44', alignItems: 'center', justifyContent: 'center' },
  avatarInitials:{ fontSize: FS.sm, fontFamily: FONT.bold, color: PURPLE },
  name:         { fontSize: FS.sm, fontFamily: FONT.semibold, color: FG },
  username:     { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, marginTop: 2 },
  separator:    { height: 1, backgroundColor: BORDER, marginLeft: 72 },

  errorText:   { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, textAlign: 'center', marginTop: SP.sm },
  retryBtn:    { marginTop: SP.md, backgroundColor: CARD, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: BORDER, paddingHorizontal: SP.md, paddingVertical: SP.xs },
  retryBtnText:{ fontSize: FS.sm, fontFamily: FONT.medium, color: FG },

  emptyTitle: { fontSize: FS.base, fontFamily: FONT.semibold, color: FG, marginTop: SP.md },
  emptyBody:  { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, textAlign: 'center', marginTop: SP.xs, lineHeight: 20 },
});
