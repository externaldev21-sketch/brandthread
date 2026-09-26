/**
 * Connections Screen — followers or following of a profile.
 * Params:
 *   type   — 'followers' | 'following'
 *   userId — optional; the profile whose list this is (defaults to the viewer)
 *
 * Every row opens that person's profile — the brand profile for sellers, the
 * buyer profile for buyers (previously every row opened the seller screen,
 * which showed an empty profile for buyers).
 */
import React, { useState, useCallback, useMemo, useRef } from 'react';
import { View, Text, StyleSheet, FlatList } from 'react-native';
import { useFocusEffect, useRouter, useLocalSearchParams } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { FONT, FS, SP, RADIUS } from '@/lib/theme';
import { useUser } from '@clerk/expo';
import { useApi } from '@/hooks/useApi';
import { Header, ListSkeleton } from '@/components/layout';
import { EmptyState, PressableScale } from '@/components/BrandthreadUI';
import { CachedImage } from '@/components/CachedImage';
import { ErrorState } from '@/components/ui/ErrorState';
import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
import { profileHref } from '@/lib/profileNavigation';
import { InteractionLayer, ProfileChip } from '@/components/profile/ProfileControls';

export interface ConnectionUser {
  id: string;
  name: string;
  username?: string;
  handle?: string;
  initials?: string;
  avatarUrl?: string;
  accountType: 'buyer' | 'seller';
  isFollowing?: boolean;
}

/** Adapts a GET /api/social/followers|following row. */
export function toConnectionUser(item: any): ConnectionUser {
  return {
    id: String(item?.userId ?? ''),
    name: item?.name ?? item?.displayName ?? item?.username ?? 'Unknown',
    username: item?.username ?? undefined,
    handle: item?.handle ?? undefined,
    initials: item?.initials ?? undefined,
    avatarUrl: typeof item?.avatarUrl === 'string' && item.avatarUrl ? item.avatarUrl : undefined,
    accountType: item?.accountType === 'seller' ? 'seller' : 'buyer',
    isFollowing: typeof item?.isFollowing === 'boolean'
      ? item.isFollowing
      : typeof item?.isFollowingBack === 'boolean' ? item.isFollowingBack : undefined,
  };
}

/** Where tapping a connection row goes. */
export function connectionHref(user: ConnectionUser): string {
  return profileHref({
    userId: user.id,
    accountType: user.accountType,
    name: user.name,
    handle: user.handle ?? (user.username ? `@${user.username}` : undefined),
    initials: user.initials,
  });
}

export default function ConnectionsScreen() {
  const router   = useRouter();
  const insets   = useSafeAreaInsets();
  const { theme } = useAppTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const { user, isLoaded: clerkLoaded } = useUser();
  const api = useApi();
  const { type = 'followers', userId } = useLocalSearchParams<{ type?: string; userId?: string }>();

  const isFollowers = type === 'followers';
  const title       = isFollowers ? 'Followers' : 'Following';
  const isOwnList   = !userId || userId === user?.id;

  const [users, setUsers]     = useState<ConnectionUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(false);
  const generationRef = useRef(0);

  const load = useCallback(() => {
    // While Clerk itself hasn't resolved yet, keep the loading skeleton up —
    // the `clerkLoaded`/`user?.id` change below re-triggers this (see the
    // useFocusEffect dependency on `load`). But once Clerk *has* resolved and
    // there is still no signed-in user id, this must resolve the loading
    // state instead of leaving the skeleton up forever (this previously never
    // called `setLoading(false)` in that branch, unlike the equivalent guard
    // in app/(buyer)/inbox.tsx's loadData).
    if (!clerkLoaded) return;
    if (!user?.id) {
      setUsers([]);
      setLoading(false);
      return;
    }
    const generation = ++generationRef.current;
    setError(false);
    const listOwner = isOwnList ? undefined : userId;
    const request = isFollowers ? api.social.followers(listOwner) : api.social.following(listOwner);
    request
      .then(data => {
        if (generation !== generationRef.current) return;
        setUsers((Array.isArray(data) ? data : []).map(toConnectionUser).filter((row) => row.id));
      })
      .catch(() => { if (generation === generationRef.current) setError(true); })
      .finally(() => { if (generation === generationRef.current) setLoading(false); });
  }, [api, clerkLoaded, user?.id, isFollowers, isOwnList, userId]);

  // Refetch whenever the list regains focus — following someone from their
  // profile and coming back shows the change immediately.
  useFocusEffect(useCallback(() => { load(); }, [load]));

  function renderItem({ item }: { item: ConnectionUser }) {
    const initials = item.initials || (item.name ?? item.username ?? '?')
      .split(' ')
      .map((w: string) => w[0])
      .join('')
      .slice(0, 2)
      .toUpperCase();

    return (
      <PressableScale
        style={styles.row}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel={`Open ${item.name}'s profile`}
        testID={`connection-row-${item.id}`}
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          router.push(connectionHref(item) as never);
        }}
      >
        {(state) => (
          <>
            <InteractionLayer state={state as { pressed: boolean }} radius={RADIUS.md} theme={theme} />
            {item.avatarUrl ? (
              <CachedImage source={{ uri: item.avatarUrl }} style={styles.avatar} contentFit="cover" />
            ) : (
              <View style={styles.avatarFallback}>
                <Text style={styles.avatarInitials}>{initials}</Text>
              </View>
            )}
            <View style={styles.rowCopy}>
              <Text style={styles.name} numberOfLines={1}>{item.name ?? item.username ?? 'Unknown'}</Text>
              {item.username ? <Text style={styles.username} numberOfLines={1}>@{item.username}</Text> : null}
            </View>
            {item.accountType === 'seller' ? <ProfileChip label="Seller" icon="shopping-bag" /> : null}
            {item.isFollowing && !isOwnList ? <ProfileChip label="Following" /> : null}
            <Feather name="chevron-right" size={16} color={theme.muted} />
          </>
        )}
      </PressableScale>
    );
  }

  return (
    <View style={styles.root}>
      <Header title={title} />

      {loading ? (
        <View style={styles.pad}><ListSkeleton rows={6} /></View>
      ) : error ? (
        <ErrorState message={`Couldn't load ${title.toLowerCase()}.`} onRetry={() => { setLoading(true); load(); }} />
      ) : users.length === 0 ? (
        <EmptyState
          icon="users"
          title={`No ${title.toLowerCase()} yet`}
          description={isFollowers
            ? 'When people follow this account, they will appear here.'
            : 'Accounts that this profile follows will appear here.'}
        />
      ) : (
        <FlatList
          data={users}
          keyExtractor={item => item.id}
          renderItem={renderItem}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}
        />
      )}
    </View>
  );
}

function makeStyles(theme: AppThemePreset) {
  return StyleSheet.create({
    root:   { flex: 1, backgroundColor: theme.background },
    pad:    { padding: SP.md },
    row:    { flexDirection: 'row', alignItems: 'center', gap: SP.sm, paddingHorizontal: SP.md, minHeight: 64, paddingVertical: SP.sm },
    rowCopy: { flex: 1, minWidth: 0 },
    avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: theme.cardElevated },
    avatarFallback: {
      width: 44, height: 44, borderRadius: 22, backgroundColor: theme.accentDim,
      borderWidth: 1, borderColor: theme.border, alignItems: 'center', justifyContent: 'center',
    },
    avatarInitials: { fontSize: FS.sm, fontFamily: FONT.bold, color: theme.text },
    name:     { fontSize: FS.sm, fontFamily: FONT.semibold, color: theme.text },
    username: { fontSize: FS.xs, fontFamily: FONT.regular, color: theme.muted, marginTop: 2 },
    separator: { height: StyleSheet.hairlineWidth, backgroundColor: theme.border, marginLeft: 72 },
  });
}
