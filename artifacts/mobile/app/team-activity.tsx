/**
 * Security → User activity logs: real team/account activity for the store.
 *  - Team access: every member with their role and last activity
 *    (GET /api/team/members, lastActiveAt is touched on each request).
 *  - Activity log: the team audit log (GET /api/team/activity), including
 *    "Signed in to the store" entries recorded when a team member comes
 *    back after 30 minutes away (lib/teamSessionLog.ts on the server).
 *  - Your devices: the owner's own Clerk sessions (/login-activity).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useColors } from '@/hooks/useColors';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Badge } from '@/components/Badge';
import { Chip } from '@/components/ui/Chip';
import { RetryRow } from '@/components/ui/RetryRow';
import { useApi } from '@/lib/api';
import { FONT } from '@/lib/theme';
import {
  TEAM_ACTIVITY_FILTERS, activityResourceType, memberLastSeenLabel, relativeTime, type TeamActivityFilter,
} from '@/lib/teamActivity';

const PAGE = 20;

export default function TeamActivityScreen() {
  const colors = useColors();
  const router = useRouter();
  const api = useApi();

  const [members, setMembers] = useState<any[]>([]);
  const [membersError, setMembersError] = useState(false);
  const [logs, setLogs] = useState<any[]>([]);
  const [logsError, setLogsError] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [filter, setFilter] = useState<TeamActivityFilter>('all');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const requestRef = useRef(0);

  const loadMembers = useCallback(async () => {
    try {
      const m = await api.team.members();
      setMembers(Array.isArray(m) ? m : []);
      setMembersError(false);
    } catch {
      setMembersError(true);
    }
  }, [api]);

  const loadLogs = useCallback(async (f: TeamActivityFilter) => {
    const req = ++requestRef.current;
    try {
      const a = await api.team.activity({ limit: PAGE, resourceType: activityResourceType(f) });
      if (req !== requestRef.current) return;
      setLogs(a?.logs ?? []);
      setHasMore(!!a?.hasMore);
      setLogsError(false);
    } catch {
      if (req !== requestRef.current) return;
      setLogsError(true);
    }
  }, [api]);

  useEffect(() => {
    setLoading(true);
    Promise.all([loadMembers(), loadLogs(filter)]).finally(() => setLoading(false));
    // filter changes reload only the log (see selectFilter)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadMembers]);

  const selectFilter = (f: TeamActivityFilter) => {
    Haptics.selectionAsync().catch(() => {});
    setFilter(f);
    setLogs([]);
    void loadLogs(f);
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([loadMembers(), loadLogs(filter)]);
    setRefreshing(false);
  };

  const loadMore = async () => {
    if (loadingMore) return;
    setLoadingMore(true);
    const req = requestRef.current;
    try {
      const a = await api.team.activity({ limit: PAGE, offset: logs.length, resourceType: activityResourceType(filter) });
      // A filter switch or refresh during the fetch makes this page stale.
      if (req === requestRef.current) {
        setLogs(prev => [...prev, ...(a?.logs ?? [])]);
        setHasMore(!!a?.hasMore);
      }
    } catch {
      if (req === requestRef.current) setLogsError(true);
    }
    setLoadingMore(false);
  };

  const visibleMembers = members.filter(m => m.status !== 'removed' && !m.expired);

  return (
    <View style={[styles.container, { backgroundColor: 'transparent' }]}>
      <ScreenHeader title="User activity logs" />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingTop: 16, paddingBottom: 100, paddingHorizontal: 20 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Team access</Text>
        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {loading ? (
            <ActivityIndicator color={colors.primary} style={{ margin: 16 }} />
          ) : membersError ? (
            <RetryRow label="Couldn't load your team" onRetry={() => { void loadMembers(); }} style={{ margin: 8 }} />
          ) : visibleMembers.length === 0 ? (
            <Text style={[styles.empty, { color: colors.mutedForeground }]}>No team members yet</Text>
          ) : visibleMembers.map((m, i) => (
            <View key={m.id ?? i} style={[styles.row, i > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}>
              <View style={[styles.dot, { backgroundColor: m.online ? colors.foreground : colors.border }]} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.rowTitle, { color: colors.foreground }]} numberOfLines={1}>{m.name || m.email}</Text>
                <Text style={[styles.rowMeta, { color: colors.mutedForeground }]}>{memberLastSeenLabel(m)}</Text>
              </View>
              <Badge label={String(m.role ?? '').replace(/^\w/, (c: string) => c.toUpperCase())} variant={m.role === 'owner' ? 'gold' : 'default'} />
            </View>
          ))}
        </View>

        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Activity log</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {TEAM_ACTIVITY_FILTERS.map(f => (
            <Chip key={f.key} label={f.label} selected={filter === f.key} onPress={() => selectFilter(f.key)} />
          ))}
        </ScrollView>
        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {loading ? (
            <ActivityIndicator color={colors.primary} style={{ margin: 16 }} />
          ) : logsError && logs.length === 0 ? (
            <RetryRow label="Couldn't load activity" onRetry={() => { void loadLogs(filter); }} style={{ margin: 8 }} />
          ) : logs.length === 0 ? (
            <Text style={[styles.empty, { color: colors.mutedForeground }]}>
              {filter === 'session' ? 'No team sign-ins recorded yet' : 'No activity yet'}
            </Text>
          ) : (
            <>
              {logs.map((log, i) => (
                <View key={log.id ?? i} style={[styles.row, i > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}>
                  <Feather
                    name={log.resourceType === 'session' ? 'log-in' : log.resourceType === 'order' ? 'shopping-bag' : log.resourceType === 'product' ? 'tag' : 'activity'}
                    size={14}
                    color={colors.mutedForeground}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.rowTitle, { color: colors.foreground }]}>{log.action}</Text>
                    <Text style={[styles.rowMeta, { color: colors.mutedForeground }]}>
                      {log.actorName ?? 'System'}{log.actorRole ? ` · ${log.actorRole}` : ''} · {relativeTime(log.createdAt)}
                    </Text>
                  </View>
                </View>
              ))}
              {hasMore && (
                <TouchableOpacity onPress={loadMore} activeOpacity={0.7} style={[styles.loadMoreBtn, { borderTopColor: colors.border }]}>
                  {loadingMore
                    ? <ActivityIndicator size="small" color={colors.primary} />
                    : <Text style={[styles.loadMoreText, { color: colors.primary }]}>Load more</Text>}
                </TouchableOpacity>
              )}
            </>
          )}
        </View>

        <TouchableOpacity
          onPress={() => router.push('/login-activity' as never)}
          activeOpacity={0.7}
          style={[styles.section, styles.row, { backgroundColor: colors.card, borderColor: colors.border }]}
          accessibilityRole="button"
        >
          <Feather name="smartphone" size={16} color={colors.mutedForeground} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.rowTitle, { color: colors.foreground }]}>Your devices</Text>
            <Text style={[styles.rowMeta, { color: colors.mutedForeground }]}>Where your own account is signed in</Text>
          </View>
          <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  sectionTitle: { fontSize: 17, fontFamily: FONT.semibold, marginBottom: 12 },
  section: { borderRadius: 14, borderWidth: 1, marginBottom: 24 },
  chips: { gap: 8, paddingBottom: 12 },
  row: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  rowTitle: { fontSize: 13, fontFamily: FONT.medium },
  rowMeta: { fontSize: 11, fontFamily: FONT.regular, marginTop: 2 },
  empty: { padding: 16, textAlign: 'center', fontSize: 13 },
  loadMoreBtn: { padding: 14, alignItems: 'center', borderTopWidth: 1 },
  loadMoreText: { fontSize: 13, fontFamily: FONT.semibold },
});
