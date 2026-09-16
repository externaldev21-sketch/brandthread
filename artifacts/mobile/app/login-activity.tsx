/**
 * Brandthread — Login Activity
 * Shows recent sign-in sessions from Clerk, so sellers can spot unauthorized access.
 */
import React, { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApi } from '@/lib/api';
import {
  BG, CARD, BORDER, FG, MUTED, SUBTLE, PURPLE, SUCCESS, SUCCESS_DIM,
  FONT, FS, SP, RADIUS,
} from '@/lib/theme';
import { useColors } from '@/hooks/useColors';

interface SessionRow {
  id: string;
  status: string;
  createdAt: number;
  lastActiveAt: number;
  expireAt: number;
  clientId?: string;
}

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1)  return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export default function LoginActivityScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const api = useApi();
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const data = await api.security.sessions() as { sessions: SessionRow[] };
        // Sort newest first
        setSessions((data.sessions ?? []).sort((a, b) => b.lastActiveAt - a.lastActiveAt));
      } catch {
        setSessions([]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Feather name="arrow-left" size={22} color={FG} />
        </TouchableOpacity>
        <Text style={s.title}>Login Activity</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading ? (
        <View style={s.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[s.body, { paddingBottom: insets.bottom + 32 }]}
          showsVerticalScrollIndicator={false}
        >
          <Text style={s.desc}>
            Recent sign-in sessions for your account. If you see activity you don't recognise, change your password immediately.
          </Text>

          {sessions.length === 0 ? (
            <View style={s.emptyCard}>
              <Feather name="clock" size={28} color={MUTED} style={{ marginBottom: 12 }} />
              <Text style={s.emptyText}>No session history available.</Text>
            </View>
          ) : (
            sessions.map((session, idx) => {
              const isActive = session.status === 'active';
              return (
                <View key={session.id} style={[s.card, idx > 0 && { marginTop: 10 }]}>
                  <View style={s.cardHeader}>
                    <View style={[s.statusDot, { backgroundColor: isActive ? SUCCESS : MUTED }]} />
                    <Text style={s.cardStatus}>{isActive ? 'Active session' : `Session ${session.status}`}</Text>
                    {isActive && (
                      <View style={s.activeBadge}>
                        <Text style={s.activeBadgeText}>Current</Text>
                      </View>
                    )}
                  </View>

                  <View style={s.cardRow}>
                    <Text style={s.fieldLabel}>Signed in</Text>
                    <Text style={s.fieldValue}>{formatDate(session.createdAt)}</Text>
                  </View>
                  <View style={s.cardDivider} />
                  <View style={s.cardRow}>
                    <Text style={s.fieldLabel}>Last active</Text>
                    <Text style={s.fieldValue}>{formatRelative(session.lastActiveAt)}</Text>
                  </View>
                  <View style={s.cardDivider} />
                  <View style={s.cardRow}>
                    <Text style={s.fieldLabel}>Expires</Text>
                    <Text style={s.fieldValue}>{formatDate(session.expireAt)}</Text>
                  </View>
                  {session.clientId && (
                    <>
                      <View style={s.cardDivider} />
                      <View style={s.cardRow}>
                        <Text style={s.fieldLabel}>Session ID</Text>
                        <Text style={[s.fieldValue, { fontFamily: FONT.regular, fontSize: 11 }]} numberOfLines={1}>
                          {session.id.slice(0, 24)}…
                        </Text>
                      </View>
                    </>
                  )}
                </View>
              );
            })
          )}

          <View style={s.note}>
            <Feather name="shield" size={14} color={MUTED} style={{ marginTop: 1 }} />
            <Text style={s.noteText}>
              If you see unrecognised sessions, go to Settings → Security and change your password. Enable two-factor authentication for additional protection.
            </Text>
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root:   { flex: 1, backgroundColor: 'transparent' },
  header: {
    height: 56, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', paddingHorizontal: SP.md,
    borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title:   { fontSize: FS.base, fontFamily: FONT.semibold, color: FG },
  center:  { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: SP.xl },
  body: { paddingHorizontal: SP.md, paddingTop: SP.lg },
  desc: {
    fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED,
    lineHeight: 20, marginBottom: SP.lg,
  },

  emptyCard: {
    backgroundColor: CARD, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: BORDER,
    alignItems: 'center', paddingVertical: 40, marginBottom: SP.lg,
  },
  emptyText: { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED },

  card: {
    backgroundColor: CARD, borderRadius: RADIUS.lg,
    borderWidth: 1, borderColor: BORDER, overflow: 'hidden',
    marginBottom: SP.sm,
  },
  cardHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: SP.md, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  cardStatus: { flex: 1, fontSize: FS.sm, fontFamily: FONT.semibold, color: FG },
  activeBadge: {
    backgroundColor: SUCCESS_DIM, borderRadius: RADIUS.pill,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  activeBadgeText: { fontSize: FS.xs, fontFamily: FONT.semibold, color: SUCCESS },

  cardRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SP.md, paddingVertical: 11,
  },
  cardDivider: { height: 1, backgroundColor: BORDER, marginHorizontal: SP.md },
  fieldLabel: { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED },
  fieldValue: { fontSize: FS.sm, fontFamily: FONT.regular, color: FG },

  note: {
    flexDirection: 'row', gap: 8, alignItems: 'flex-start',
    paddingHorizontal: SP.sm, marginTop: SP.sm,
  },
  noteText: {
    flex: 1, fontSize: FS.xs, fontFamily: FONT.regular,
    color: MUTED, lineHeight: 18,
  },
});
