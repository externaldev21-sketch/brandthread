/**
 * Activity people list — the individual people behind one merged Activity
 * row ("Jay and 12 others liked your post").
 *
 * Params:
 *   type — the merged row's notification type (post_like, story_like,
 *          post_comment, repost, new_follower); picks the header title
 *   ids  — the merged row's own feed item ids (ActivityRow.ids), comma-joined
 *
 * Pattern: Instagram iOS "View likes" — tapping a grouped like count pushes
 * a full "Likes" screen, one row per person (avatar, username, name) with a
 * Follow / Following pill (Mobbin flow:
 * https://mobbin.com/flows/c575ad7c-8644-4b26-a3d0-ae737f855c13, screens
 * https://mobbin.com/screens/bb5378a8-553e-4d6e-a114-613f2c6dfb84 and
 * https://mobbin.com/screens/f5db6252-33d7-478a-a442-6e0f9f3987d1).
 *
 * Data comes from GET /api/buyer/notifications/actors?ids= — the same
 * per-user feed the Activity tab reads, so it serves buyers and sellers
 * identically and the list always matches the row's "and N others" count.
 * Rows reuse the shared search PersonRow (sibling tap target + Follow pill,
 * never nested) and the same follow endpoint every other Follow pill uses.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, FlatList, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
import { SP } from '@/lib/theme';
import { EmptyState, SkeletonBlock, useScreenPadding } from '@/components/layout';
import { ScreenHeader } from '@/components/ScreenHeader';
import { SearchBar } from '@/components/BrandthreadUI';
import { PersonRow, type SearchPerson } from '@/components/search/PersonRow';
import { ApiError } from '@/lib/networkNotice';
import { activityHref, groupedPeopleTitle, GROUPED_PEOPLE_MAX_IDS } from '@/lib/activity';
import { getPreviewActivity, isPreviewActivityEnabled, previewActorAvatarUri } from '@/lib/previewActivity';
import { getPreviewFollowing } from '@/lib/previewFollowStore';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { getGroupedActivityActors, type GroupedActivityActor } from '@/services/activityService';
import { setSellerFollowing } from '@/services/socialService';

type Status = 'loading' | 'ready' | 'error';

/** Only shown once a list is long enough to be worth searching. */
const SEARCH_MIN_PEOPLE = 8;

function parseIds(raw: string | string[] | undefined): string[] {
  const value = Array.isArray(raw) ? raw.join(',') : raw ?? '';
  return [...new Set(value.split(',').map((id) => id.trim()).filter(Boolean))].slice(0, GROUPED_PEOPLE_MAX_IDS);
}

/**
 * Dev-web preview only (no backend): the same seeded feed the Activity tab
 * falls back to, so a grouped preview row still opens a real-looking list.
 */
function previewActors(ids: readonly string[]): GroupedActivityActor[] {
  const wanted = new Set(ids);
  const seen = new Set<string>();
  const actors: GroupedActivityActor[] = [];
  for (const item of getPreviewActivity()) {
    if (!wanted.has(item.id) || !item.actorId || seen.has(item.actorId)) continue;
    seen.add(item.actorId);
    const name = item.actorName || 'Someone';
    actors.push({
      id: item.actorId, name, handle: item.actorHandle,
      initials: item.actorInitials || name.slice(0, 2).toUpperCase(),
      color: item.actorColor, avatarUrl: item.actorAvatarUrl,
      isFollowing: getPreviewFollowing(item.actorId) ?? false, createdAt: item.createdAt,
    });
  }
  return actors;
}

function toSearchPerson(actor: GroupedActivityActor, followsYou: boolean): SearchPerson {
  return {
    followsYou,
    userId: actor.id,
    name: actor.name,
    username: null,
    handle: actor.handle ?? '',
    initials: actor.initials,
    color: actor.color ?? '#3F3F46',
    bio: null,
    isFollowing: actor.isFollowing,
    avatarUrl: actor.avatarUrl || previewActorAvatarUri(actor.id, actor.name) || null,
  };
}

const ActorRow = React.memo(function ActorRow({ actor, followsYou, pending, onOpen, onToggleFollow }: {
  actor: GroupedActivityActor;
  followsYou: boolean;
  pending: boolean;
  onOpen: (actor: GroupedActivityActor) => void;
  onToggleFollow: (actor: GroupedActivityActor) => void;
}) {
  const person = useMemo(() => toSearchPerson(actor, followsYou), [actor, followsYou]);
  const handleOpen = useCallback(() => onOpen(actor), [actor, onOpen]);
  const handleToggle = useCallback(() => onToggleFollow(actor), [actor, onToggleFollow]);
  return <PersonRow person={person} loading={pending} onPress={handleOpen} onToggleFollow={handleToggle} />;
});

function SkeletonRows({ styles }: { styles: Styles }) {
  return (
    <View style={styles.skeletonWrap} accessibilityLabel="Loading people">
      {Array.from({ length: 6 }).map((_, index) => (
        <View key={index} style={styles.skeletonRow}>
          <SkeletonBlock width={44} height={44} radius={22} />
          <View style={styles.skeletonText}>
            <SkeletonBlock width={index % 2 ? '52%' : '64%'} height={13} />
            <SkeletonBlock width={index % 3 ? '30%' : '40%'} height={11} />
          </View>
          <SkeletonBlock width={88} height={32} radius={16} />
        </View>
      ))}
    </View>
  );
}

export default function ActivityPeopleScreen() {
  const { theme } = useAppTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const screenPadding = useScreenPadding({ withTabBarInset: false });
  const router = useRouter();
  const params = useLocalSearchParams<{ type?: string; ids?: string }>();
  const type = typeof params.type === 'string' ? params.type : '';
  const ids = useMemo(() => parseIds(params.ids), [params.ids]);
  const title = groupedPeopleTitle(type);

  const [actors, setActors] = useState<GroupedActivityActor[]>([]);
  const [status, setStatus] = useState<Status>('loading');
  const [errorKind, setErrorKind] = useState<'auth' | 'offline' | 'server'>('offline');
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set());
  const [query, setQuery] = useState('');
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const id = ++requestId.current;
    setStatus('loading');
    if (ids.length === 0) {
      setActors([]);
      setStatus('ready');
      return;
    }
    // Skip the real call entirely in dev-web preview (rather than trying it
    // and falling back once it fails/returns nothing) — same reasoning as
    // activity-center.tsx's identical fix: that mode has no live backend to
    // begin with, and the audit/e2e harnesses that fake a signed-in Clerk
    // user would otherwise still reach this real, backend-less endpoint
    // first and log a console 404 before the fallback ever ran.
    if (isPreviewActivityEnabled()) {
      setActors(previewActors(ids));
      setStatus('ready');
      return;
    }
    try {
      const result = await getGroupedActivityActors(ids);
      if (id !== requestId.current) return;
      setActors(result);
      setStatus('ready');
    } catch (err) {
      if (id !== requestId.current) return;
      setErrorKind(err instanceof ApiError
        ? (err.status === 401 || err.status === 403 ? 'auth' : err.status >= 500 ? 'server' : 'offline')
        : 'offline');
      setStatus('error');
    }
  }, [ids]);

  useEffect(() => { void load(); }, [load]);

  const handleRetry = useCallback(() => { void load(); }, [load]);
  const handleGoBack = useCallback(() => goBackOr(router, '/activity-center'), [router]);

  // Same destination as tapping a single-person Activity row.
  const handleOpen = useCallback((actor: GroupedActivityActor) => {
    const href = activityHref({
      id: actor.id, category: 'social', type, title: '', body: '', isRead: true, createdAt: actor.createdAt,
      targetId: actor.id, targetType: 'user',
      actorName: actor.name, actorHandle: actor.handle, actorInitials: actor.initials, actorColor: actor.color,
    });
    if (href) router.push(href as never);
  }, [router, type]);

  const setFollowing = useCallback((actorId: string, isFollowing: boolean) => {
    setActors((prev) => prev.map((a) => (a.id === actorId ? { ...a, isFollowing } : a)));
  }, []);

  const handleToggleFollow = useCallback(async (actor: GroupedActivityActor) => {
    if (pending.has(actor.id)) return;
    const next = !actor.isFollowing;
    setPending((prev) => new Set(prev).add(actor.id));
    setFollowing(actor.id, next);
    try {
      await setSellerFollowing(actor.id, next);
    } catch {
      setFollowing(actor.id, !next);
      Alert.alert(next ? 'Could not follow' : 'Could not unfollow', 'Please try again in a moment.');
    } finally {
      setPending((prev) => {
        const copy = new Set(prev);
        copy.delete(actor.id);
        return copy;
      });
    }
  }, [pending, setFollowing]);

  const handleToggleFollowVoid = useCallback((actor: GroupedActivityActor) => {
    void handleToggleFollow(actor);
  }, [handleToggleFollow]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return actors;
    return actors.filter((a) => a.name.toLowerCase().includes(needle) || (a.handle ?? '').toLowerCase().includes(needle));
  }, [actors, query]);

  const renderItem = useCallback(({ item }: { item: GroupedActivityActor }) => (
    <ActorRow
      actor={item}
      // Everyone on a "New followers" list follows the viewer already.
      followsYou={type === 'new_follower'}
      pending={pending.has(item.id)}
      onOpen={handleOpen}
      onToggleFollow={handleToggleFollowVoid}
    />
  ), [handleOpen, handleToggleFollowVoid, pending, type]);

  const keyExtractor = useCallback((item: GroupedActivityActor) => item.id, []);

  const errorMessage = errorKind === 'auth'
    ? 'Sign in again to see who this was.'
    : errorKind === 'server'
      ? "Brandthread couldn't load this list right now. Try again shortly."
      : "This list couldn't load. Check your connection and try again.";

  const showSearch = status === 'ready' && actors.length >= SEARCH_MIN_PEOPLE;

  return (
    <View style={styles.container}>
      <ScreenHeader title={title} />
      {showSearch && (
        <SearchBar value={query} onChange={setQuery} placeholder="Search" style={styles.search} />
      )}

      {status === 'loading' ? (
        <SkeletonRows styles={styles} />
      ) : status === 'error' ? (
        <View style={styles.stateWrap}>
          <EmptyState
            // Default (muted) variant, not "error": the only non-monochrome
            // accents allowed are LIVE red and end-call red.
            icon={errorKind === 'auth' ? 'lock' : 'wifi-off'}
            message={errorMessage}
            actionLabel="Try again"
            onAction={handleRetry}
          />
        </View>
      ) : (
        <FlatList
          data={visible}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          bounces={false}
          overScrollMode="never"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: screenPadding.bottom + SP.xl },
            visible.length === 0 && styles.listContentEmpty,
          ]}
          ListEmptyComponent={(
            <View style={styles.stateWrap}>
              {query ? (
                <EmptyState icon="search" title="No results" message="No one here matches that name." />
              ) : ids.length === 0 ? (
                // Opened without a grouped row behind it (no ids): there is
                // no list to show, so offer the way back to Activity.
                <EmptyState
                  icon="users"
                  title="Nothing to show"
                  message="This list isn't available."
                  actionLabel="Go back"
                  onAction={handleGoBack}
                />
              ) : (
                <EmptyState icon="users" title="No people" message="No one is left on this list." />
              )}
            </View>
          )}
        />
      )}
    </View>
  );
}

type Styles = ReturnType<typeof makeStyles>;

const makeStyles = (theme: AppThemePreset) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.background,
  },
  search: {
    marginTop: SP.sm,
    marginBottom: SP.sm,
    marginHorizontal: SP.md,
  },
  listContent: {
    paddingTop: SP.xs,
  },
  listContentEmpty: {
    flexGrow: 1,
  },
  stateWrap: {
    flex: 1,
    justifyContent: 'center',
    paddingBottom: SP.xxl,
  },
  skeletonWrap: {
    paddingHorizontal: SP.md,
    paddingTop: SP.sm,
  },
  skeletonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.sm,
    paddingVertical: SP.xs + 2,
  },
  skeletonText: {
    flex: 1,
    gap: SP.xs + 2,
  },
});
