/**
 * Buyer profile "More options" — full-screen pushed page, 1:1 with
 * Instagram's own "Settings and activity" (Mobbin:
 * https://mobbin.com/screens/6e9d4c03-bb6d-4434-ad64-b2b53391ea9f):
 * a SOLID opaque page (never `<Glass>` — glass is for small chrome over
 * media, not a full page of text), back arrow + title, a borderless search
 * field, and flat grouped rows under small grey section headers.
 *
 * Replaces the old translucent bottom sheet, which had no backdrop dim, let
 * the profile bleed through every row, and — like the sheet it shared code
 * with — had no reliable way to close. A pushed screen sidesteps all three:
 * it's opaque by construction, and closes via the back arrow, iOS
 * swipe-back, and Android hardware back exactly like every other pushed
 * screen in the app (Stack's default screen behavior — no custom handling
 * needed here).
 */
import React, { useMemo, useState } from 'react';
import {
  Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { ScreenHeader } from '@/components/ScreenHeader';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, FS, SP } from '@/lib/theme';
import { hapticLight, hapticDestructiveConfirm } from '@/lib/haptics';
import { ShareProfileSheet } from '@/components/ShareProfileSheet';
import { useJoinedCommunities } from '@/lib/communities/useCommunityClient';

type MenuRow = {
  key: string;
  icon: keyof typeof Feather.glyphMap;
  label: string;
  destructive?: boolean;
  /** Quiet secondary text before the chevron (e.g. "3 joined"). */
  value?: string;
  onPress: () => void;
};

type MenuSection = {
  title: string;
  rows: MenuRow[];
};

export default function BuyerSettingsMenuScreen() {
  const { theme } = useAppTheme();
  const router = useRouter();
  const { signOut } = useAuth();
  const [query, setQuery] = useState('');
  const [shareSheetOpen, setShareSheetOpen] = useState(false);
  // Readonly (signed-out / fresh preview) resolves to [] without any protected call.
  const { communities: joinedGroups } = useJoinedCommunities(60_000);
  const groupsValue = joinedGroups.length > 0 ? `${joinedGroups.length} joined` : undefined;

  const handleSignOut = () => {
    Alert.alert('Sign out of Brandthread?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: async () => {
          hapticDestructiveConfirm();
          try { await signOut(); } catch {}
          router.replace('/sign-in' as never);
        },
      },
    ]);
  };

  const sections: MenuSection[] = useMemo(() => [
    {
      title: 'Your account',
      rows: [
        { key: 'edit-profile', icon: 'edit-3', label: 'Edit profile', onPress: () => router.push('/(buyer)/edit-profile') },
        { key: 'share-profile', icon: 'share-2', label: 'Share profile', onPress: () => { hapticLight(); setShareSheetOpen(true); } },
        { key: 'qr-code', icon: 'grid', label: 'QR code', onPress: () => router.push('/buyer-qr-code' as any) },
      ],
    },
    {
      title: 'How you use Brandthread',
      rows: [
        { key: 'saved', icon: 'bookmark', label: 'Saved', onPress: () => router.push('/buyer-saved' as any) },
        { key: 'archive', icon: 'archive', label: 'Archive', onPress: () => router.push('/buyer-archive' as any) },
        { key: 'your-activity', icon: 'activity', label: 'Your activity', onPress: () => router.push('/buyer-your-activity' as any) },
        { key: 'close-friends', icon: 'star', label: 'Close friends', onPress: () => router.push('/buyer-close-friends' as any) },
        { key: 'groups', icon: 'users', label: 'Groups', value: groupsValue, onPress: () => router.push('/community' as any) },
        { key: 'friends', icon: 'users', label: 'Friends', onPress: () => router.push('/(buyer)/friends' as any) },
        { key: 'highlights', icon: 'image', label: 'Highlights', onPress: () => router.push('/buyer-highlights-manager' as any) },
      ],
    },
    {
      title: 'Shopping',
      rows: [
        { key: 'orders', icon: 'package', label: 'Orders', onPress: () => router.push('/(buyer)/orders') },
        { key: 'rewards', icon: 'gift', label: 'Rewards', onPress: () => router.push('/loyalty' as any) },
        { key: 'thread-cash', icon: 'credit-card', label: 'Thread Cash wallet', onPress: () => router.push('/thread-cash' as any) },
      ],
    },
    {
      title: 'Work',
      rows: [
        { key: 'freelancer-jobs', icon: 'briefcase', label: 'Freelancer jobs', onPress: () => router.push('/freelancer-jobs' as any) },
      ],
    },
    {
      title: 'More',
      rows: [
        { key: 'settings', icon: 'settings', label: 'Settings', onPress: () => router.push('/settings' as any) },
        { key: 'help', icon: 'help-circle', label: 'Help', onPress: () => router.push('/help' as any) },
        { key: 'log-out', icon: 'log-out', label: 'Log out', destructive: true, onPress: handleSignOut },
      ],
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [router, groupsValue]);

  const filteredSections = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sections;
    return sections
      .map((section) => ({ ...section, rows: section.rows.filter((row) => row.label.toLowerCase().includes(q)) }))
      .filter((section) => section.rows.length > 0);
  }, [sections, query]);

  const s = styles(theme);

  return (
    <View style={[s.page, { backgroundColor: theme.background }]}>
      <ScreenHeader title="Menu" />

      <View style={s.searchWrap}>
        <View style={[s.searchField, { backgroundColor: theme.cardElevated }]}>
          <Feather name="search" size={16} color={theme.subtle} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search"
            placeholderTextColor={theme.subtle}
            style={[s.searchInput, { color: theme.text }]}
            autoCorrect={false}
            returnKeyType="search"
          />
          {query.length > 0 && (
            <Pressable onPress={() => setQuery('')} hitSlop={8} accessibilityRole="button" accessibilityLabel="Clear search">
              <Feather name="x-circle" size={15} color={theme.subtle} />
            </Pressable>
          )}
        </View>
      </View>

      <ScrollView contentContainerStyle={s.scrollContent} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {filteredSections.map((section) => (
          <View key={section.title} style={s.section}>
            <Text style={[s.sectionHeader, { color: theme.subtle }]}>{section.title.toUpperCase()}</Text>
            {section.rows.map((row, i) => (
              <Pressable
                key={row.key}
                onPress={() => { hapticLight(); row.onPress(); }}
                style={({ pressed }) => [s.row, pressed && { opacity: 0.6 }]}
                accessibilityRole="button"
                accessibilityLabel={row.value ? `${row.label}, ${row.value}` : row.label}
              >
                <Feather name={row.icon} size={ROW_ICON_SIZE} color={row.destructive ? theme.error : theme.text} />
                <Text style={[s.rowLabel, { color: row.destructive ? theme.error : theme.text }]} numberOfLines={1}>{row.label}</Text>
                {row.value ? <Text style={[s.rowValue, { color: theme.subtle }]} numberOfLines={1}>{row.value}</Text> : null}
                {!row.destructive && <Feather name="chevron-right" size={16} color={theme.subtle} />}
                {i < section.rows.length - 1 && (
                  <View style={[s.divider, { backgroundColor: theme.border }]} />
                )}
              </Pressable>
            ))}
          </View>
        ))}
      </ScrollView>

      <ShareProfileSheet visible={shareSheetOpen} onClose={() => setShareSheetOpen(false)} />
    </View>
  );
}

const ROW_HEIGHT = 52;
const ROW_ICON_SIZE = 22;
const ICON_LABEL_GAP = SP.md;
const SIDE_INSET = SP.md; // 16pt

function styles(theme: ReturnType<typeof useAppTheme>['theme']) {
  return StyleSheet.create({
    page: { flex: 1 },
    searchWrap: { paddingHorizontal: SIDE_INSET, paddingBottom: SP.sm },
    searchField: {
      flexDirection: 'row', alignItems: 'center', gap: SP.xs,
      height: 38, borderRadius: 10, paddingHorizontal: SP.sm,
    },
    searchInput: { flex: 1, fontSize: FS.sm, fontFamily: FONT.regular, paddingVertical: 0 },
    scrollContent: { paddingBottom: SP.xl },
    section: { marginTop: SP.md },
    sectionHeader: {
      fontSize: 12, fontFamily: FONT.semibold, letterSpacing: 0.2,
      paddingHorizontal: SIDE_INSET, marginBottom: 2,
    },
    row: {
      flexDirection: 'row', alignItems: 'center', gap: ICON_LABEL_GAP,
      height: ROW_HEIGHT, paddingHorizontal: SIDE_INSET,
    },
    rowLabel: { flex: 1, fontSize: 15, fontFamily: FONT.semibold },
    rowValue: { fontSize: FS.sm, fontFamily: FONT.regular },
    divider: {
      position: 'absolute', left: SIDE_INSET + ROW_ICON_SIZE + ICON_LABEL_GAP, right: 0, bottom: 0,
      height: StyleSheet.hairlineWidth,
    },
  });
}
