import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, Alert, StyleSheet,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter, useLocalSearchParams } from 'expo-router';
import {
  BG, CARD, BORDER, FG, MUTED, SUBTLE,
  ON_DARK,
  FONT, FS, SP, RADIUS, COMP, ICON,
} from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import {
  getMutedUsers, unmuteUser, subscribeSocial,
} from '@/services/socialService';
import { MuteRecord } from '@/services/socialTypes';
import { useApi } from '@/lib/api';

type ApiBlockRecord = {
  userId: string; name: string; handle: string;
  initials: string; color: string; blockedAt: string;
};

export default function BuyerBlocked() {
  const { theme } = useAppTheme();
  const PURPLE = theme.accent;
  const PURPLE_DIM = theme.accentDim;
  const GRAD_PRIMARY = theme.primaryGradient;
  const styles = makeStyles(theme);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const api = useApi();
  const params = useLocalSearchParams<{ tab?: string }>();
  const [blocked, setBlocked] = useState<ApiBlockRecord[]>([]);
  const [muted, setMuted] = useState<MuteRecord[]>([]);
  const [activeTab, setActiveTab] = useState<'blocked' | 'muted'>(
    params.tab === 'muted' ? 'muted' : 'blocked'
  );

  async function loadData() {
    const [b, m] = await Promise.allSettled([api.social.blocks(), getMutedUsers()]);
    if (b.status === 'fulfilled') setBlocked(b.value);
    if (m.status === 'fulfilled') setMuted(m.value);
  }

  useFocusEffect(useCallback(() => { loadData(); }, []));

  useEffect(() => {
    const unsub = subscribeSocial(() => loadData());
    return unsub;
  }, []);

  async function handleUnblock(userId: string, name: string) {
    Alert.alert(
      'Unblock',
      `Unblock ${name}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unblock',
          style: 'destructive',
          onPress: async () => {
            await api.social.unblock(userId);
            loadData();
          },
        },
      ]
    );
  }

  async function handleUnmute(userId: string, name: string) {
    Alert.alert(
      'Unmute',
      `Unmute ${name}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unmute',
          onPress: async () => {
            await unmuteUser(userId);
            loadData();
          },
        },
      ]
    );
  }

  function renderBlockedItem({ item }: { item: ApiBlockRecord }) {
    return (
      <View style={styles.row}>
        <View style={[styles.avatar, { backgroundColor: item.color }]}>
          <Text style={styles.avatarText}>{item.initials}</Text>
        </View>
        <View style={styles.rowContent}>
          <Text style={styles.rowName}>{item.name}</Text>
          <Text style={styles.rowHandle}>{item.handle}</Text>
        </View>
        <TouchableOpacity
          style={styles.actionBtn}
          onPress={() => handleUnblock(item.userId, item.name)}
          activeOpacity={0.7}
        >
          <Text style={styles.actionBtnText}>Unblock</Text>
        </TouchableOpacity>
      </View>
    );
  }

  function renderMutedItem({ item }: { item: MuteRecord }) {
    return (
      <View style={styles.row}>
        <View style={[styles.avatar, { backgroundColor: item.mutedUserColor }]}>
          <Text style={styles.avatarText}>{item.mutedUserInitials}</Text>
        </View>
        <View style={styles.rowContent}>
          <Text style={styles.rowName}>{item.mutedUserName}</Text>
          <Text style={styles.rowHandle}>{item.mutedUserHandle}</Text>
        </View>
        <TouchableOpacity
          style={styles.actionBtn}
          onPress={() => handleUnmute(item.mutedUserId, item.mutedUserName)}
          activeOpacity={0.7}
        >
          <Text style={styles.actionBtnText}>Unmute</Text>
        </TouchableOpacity>
      </View>
    );
  }

  function BlockedEmpty() {
    return (
      <View style={styles.emptyContainer}>
        <Feather name="slash" size={48} color={MUTED} />
        <Text style={styles.emptyTitle}>No blocked accounts</Text>
        <Text style={styles.emptyDesc}>Accounts you block will be listed here.</Text>
      </View>
    );
  }

  function MutedEmpty() {
    return (
      <View style={styles.emptyContainer}>
        <Feather name="volume-x" size={48} color={MUTED} />
        <Text style={styles.emptyTitle}>No muted accounts</Text>
        <Text style={styles.emptyDesc}>Accounts you mute will be listed here.</Text>
      </View>
    );
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* HEADER */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Feather name="arrow-left" size={ICON.lg} color={FG} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Blocked & Muted</Text>
        <View style={styles.headerBtn} />
      </View>

      {/* TAB BAR */}
      <View style={styles.tabBar}>
        {(['blocked', 'muted'] as const).map(tab => (
          <TouchableOpacity
            key={tab}
            style={[styles.tab, activeTab === tab && styles.tabActive]}
            onPress={() => setActiveTab(tab)}
            activeOpacity={0.7}
          >
            <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>
              {tab === 'blocked' ? 'Blocked' : 'Muted'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* CONTENT */}
      {activeTab === 'blocked' ? (
        <FlatList
          data={blocked}
          keyExtractor={item => item.userId}
          renderItem={renderBlockedItem}
          ListEmptyComponent={<BlockedEmpty />}
          contentContainerStyle={blocked.length === 0 ? styles.emptyList : undefined}
        />
      ) : (
        <FlatList
          data={muted}
          keyExtractor={item => item.id}
          renderItem={renderMutedItem}
          ListEmptyComponent={<MutedEmpty />}
          contentContainerStyle={muted.length === 0 ? styles.emptyList : undefined}
        />
      )}
    </View>
  );
}

const makeStyles = (theme: { accent: string; accentDim: string }) => StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SP.md,
    paddingBottom: SP.sm,
  },
  headerBtn: {
    width: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: FS.md,
    fontFamily: FONT.bold,
    color: FG,
  },
  tabBar: {
    flexDirection: 'row',
    paddingHorizontal: SP.md,
    paddingVertical: SP.sm,
    gap: SP.sm,
  },
  tab: {
    flex: 1,
    height: 36,
    borderRadius: RADIUS.pill,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabActive: {
    backgroundColor: theme.accentDim,
    borderColor: theme.accent,
  },
  tabText: {
    color: MUTED,
    fontFamily: FONT.medium,
    fontSize: FS.sm,
  },
  tabTextActive: {
    color: theme.accent,
    fontFamily: FONT.semibold,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SP.md,
    paddingVertical: SP.md,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: ON_DARK,
    fontFamily: FONT.bold,
    fontSize: FS.base,
  },
  rowContent: {
    flex: 1,
    marginLeft: SP.md,
  },
  rowName: {
    color: FG,
    fontFamily: FONT.semibold,
    fontSize: FS.base,
  },
  rowHandle: {
    color: MUTED,
    fontSize: FS.sm,
    marginTop: 2,
  },
  actionBtn: {
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: theme.accent,
    borderRadius: RADIUS.md,
    paddingHorizontal: SP.md,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBtnText: {
    color: theme.accent,
    fontSize: FS.sm,
    fontFamily: FONT.medium,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingHorizontal: SP.lg,
    marginTop: SP.xxl,
  },
  emptyTitle: {
    color: FG,
    fontFamily: FONT.semibold,
    fontSize: FS.md,
    marginTop: SP.md,
    textAlign: 'center',
  },
  emptyDesc: {
    color: MUTED,
    fontSize: FS.sm,
    textAlign: 'center',
    marginTop: SP.sm,
  },
  emptyList: {
    flex: 1,
    justifyContent: 'flex-start',
  },
});
