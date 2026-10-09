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
import * as Haptics from 'expo-haptics';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Glass } from '@/components/ui/Glass';
import { FONT, ON_DARK } from '@/lib/theme';
import { WEB_INPUT_RESET } from '@/lib/inputReset';
import { useHitAreaBoost } from '@/hooks/useHitAreaBoost';
import { radius } from '@/constants/radii';

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
  // Pads each plain icon control's real tap area up to 44x44 without
  // changing its visual footprint — see useHitAreaBoost's doc comment.
  const closeSearchHit = useHitAreaBoost();
  const friendsHit = useHitAreaBoost();
  const searchHit = useHitAreaBoost();
  return (
    <View style={[styles.root, { paddingTop: Math.max(0, topInset - 4) }]} pointerEvents="box-none">
      {searchOpen ? (
        // Solid fill, no BlurView: a live blur here would re-sample the
        // playing video behind it every frame — same class of glitch as the
        // old shop pill's frosted background (see ShopSideTab).
        <View style={styles.searchRow}>
          <Feather name="search" size={16} color="rgba(255,255,255,0.75)" style={{ marginLeft: 14 }} />
          <TextInput
            style={[styles.searchInput, WEB_INPUT_RESET]}
            value={searchQuery}
            onChangeText={onChangeSearchQuery}
            placeholder="Search creators, products…"
            placeholderTextColor="rgba(255,255,255,0.5)"
            autoFocus
            returnKeyType="search"
            onSubmitEditing={onCloseSearch}
          />
          <TouchableOpacity
            style={[styles.iconBtn, closeSearchHit.boostStyle]}
            onLayout={closeSearchHit.onLayout}
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
              {hasActiveLive && (
                // noBlur: this pill sits directly over the playing video —
                // a live BlurView here re-samples the video every frame,
                // which is the exact glitch `searchRow` below was moved off
                // blur to avoid. The specular edge + translucent fill still
                // reads as glass without that cost.
                <Glass variant="regular" tint="dark" radius={15} noBlur style={StyleSheet.absoluteFill} />
              )}
              {hasActiveLive && <View style={styles.liveDot} />}
              <Text style={[styles.liveText, hasActiveLive && styles.liveTextActive]}>LIVE</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.iconBtn, friendsHit.boostStyle]}
              onLayout={friendsHit.onLayout}
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
            style={[styles.iconBtn, searchHit.boostStyle]}
            onLayout={searchHit.onLayout}
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
  // `minWidth`/`minHeight` (not a fixed `width`/`height`): still renders as
  // a 36x36 box exactly as before (the icon glyph is well under 36pt, so
  // the min floors it at 36 either way), but leaves room for
  // useHitAreaBoost's own `minWidth`/`minHeight` to widen it further — a
  // *fixed* width/height on this same element would instead have taken
  // priority over the boost's and suppressed it.
  iconBtn: { minWidth: 36, minHeight: 36, alignItems: 'center', justifyContent: 'center' },
  liveBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 30,
    paddingHorizontal: 8, borderRadius: radius.sm, width: 52, justifyContent: 'center',
  },
  liveBtnActive: {
    overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,59,48,0.55)', width: 'auto',
  },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#FF3B30' },
  liveText: {
    fontSize: 11, fontFamily: FONT.bold, color: 'rgba(255,255,255,0.85)',
  },
  liveTextActive: { color: ON_DARK },
  searchRow: {
    flexDirection: 'row', alignItems: 'center', minHeight: 44, borderRadius: 22,
    // Solid fill (bumped from 0.32 now that there's no BlurView underneath
    // adding its own contrast) instead of a blur-over-video background.
    overflow: 'hidden', backgroundColor: 'rgba(0,0,0,0.6)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.24)',
  },
  searchInput: {
    flex: 1, height: 44, paddingHorizontal: 10, fontSize: 15, color: ON_DARK,
  },
});
