/**
 * Buyer Threads Home feed — top bar.
 *
 * TikTok-style: a LIVE entry point on the left, "Following / Threads" as
 * plain text tabs centered with a sliding underline, and search on the
 * right. Cart and notifications are deliberately not here — they crowded a
 * header that only needs to get the buyer into a live stream, switch feeds,
 * or search, and both are one tap away from the buyer tab bar already.
 */
import React from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { FONT, ON_DARK } from '@/lib/theme';

export function FeedTopBar({
  topInset,
  feedTab,
  onChangeTab,
  hasActiveLive,
  onPressLive,
  searchOpen,
  searchQuery,
  onChangeSearchQuery,
  onOpenSearch,
  onCloseSearch,
  onOpenFriends,
}: {
  topInset: number;
  feedTab: 'following' | 'for-you';
  onChangeTab: (id: 'following' | 'for-you') => void;
  hasActiveLive: boolean;
  onPressLive: () => void;
  searchOpen: boolean;
  searchQuery: string;
  onChangeSearchQuery: (v: string) => void;
  onOpenSearch: () => void;
  onCloseSearch: () => void;
  /**
   * Friends has no slot of its own in the buyer tab bar — Home and Profile
   * are its only two entry points (see tests/buyer-bottom-navigation-layout
   * .test.ts). Kept here, alongside LIVE, so removing cart/bell from this
   * header doesn't also remove Friends' only path from Home.
   */
  onOpenFriends: () => void;
}) {
  return (
    <View style={[styles.root, { paddingTop: Math.max(0, topInset - 4) }]} pointerEvents="box-none">
      {searchOpen ? (
        <View style={styles.searchRow}>
          <BlurView intensity={34} tint="dark" style={StyleSheet.absoluteFill} pointerEvents="none" />
          <Feather name="search" size={16} color="rgba(255,255,255,0.75)" style={{ marginLeft: 14 }} />
          <TextInput
            style={styles.searchInput}
            value={searchQuery}
            onChangeText={onChangeSearchQuery}
            placeholder="Search creators, products…"
            placeholderTextColor="rgba(255,255,255,0.5)"
            autoFocus
            returnKeyType="search"
            onSubmitEditing={onCloseSearch}
          />
          <TouchableOpacity
            style={styles.iconBtn}
            activeOpacity={0.7}
            onPress={onCloseSearch}
            accessibilityRole="button"
            accessibilityLabel="Close search"
          >
            <Feather name="x" size={18} color={ON_DARK} />
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.row}>
          <View style={styles.leftCluster}>
            <TouchableOpacity
              style={[styles.liveBtn, hasActiveLive && styles.liveBtnActive]}
              activeOpacity={0.78}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                onPressLive();
              }}
              accessibilityRole="button"
              accessibilityLabel={hasActiveLive ? 'Jump to live' : 'Live'}
              testID="buyer-home-live"
            >
              {hasActiveLive && <View style={styles.liveDot} />}
              <Text style={[styles.liveText, hasActiveLive && styles.liveTextActive]}>LIVE</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.iconBtn}
              activeOpacity={0.7}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                onOpenFriends();
              }}
              accessibilityRole="button"
              accessibilityLabel="Friends"
              hitSlop={{ top: 5, bottom: 5, left: 5, right: 5 }}
              testID="buyer-home-friends"
            >
              <Feather name="users" size={19} color={ON_DARK} />
            </TouchableOpacity>
          </View>

          <View style={styles.tabsWrap} pointerEvents="box-none">
            <SegmentedControl
              variant="underline"
              testID="buyer-home-tabs"
              options={[
                { id: 'following', label: 'Following' },
                { id: 'for-you', label: 'Threads' },
              ]}
              selectedId={feedTab}
              onChange={(id) => onChangeTab(id as 'following' | 'for-you')}
            />
          </View>

          <TouchableOpacity
            style={styles.iconBtn}
            activeOpacity={0.7}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
              onOpenSearch();
            }}
            accessibilityRole="button"
            accessibilityLabel="Search"
            hitSlop={{ top: 5, bottom: 5, left: 5, right: 5 }}
            testID="buyer-home-search"
          >
            <Feather name="search" size={20} color={ON_DARK} />
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 10, paddingBottom: 4 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44, gap: 8 },
  leftCluster: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  tabsWrap: { flex: 1, alignItems: 'center' },
  iconBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  liveBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 30,
    paddingHorizontal: 8, borderRadius: 15, width: 52, justifyContent: 'center',
  },
  liveBtnActive: {
    backgroundColor: 'rgba(0,0,0,0.32)', borderWidth: 1, borderColor: 'rgba(255,59,48,0.55)', width: 'auto',
  },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#FF3B30' },
  liveText: {
    fontSize: 11, letterSpacing: 0.6, fontFamily: FONT.bold, color: 'rgba(255,255,255,0.85)',
  },
  liveTextActive: { color: ON_DARK },
  searchRow: {
    flexDirection: 'row', alignItems: 'center', minHeight: 44, borderRadius: 22,
    overflow: 'hidden', backgroundColor: 'rgba(0,0,0,0.32)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.24)',
  },
  searchInput: {
    flex: 1, height: 44, paddingHorizontal: 10, fontSize: 14, color: ON_DARK,
  },
});
