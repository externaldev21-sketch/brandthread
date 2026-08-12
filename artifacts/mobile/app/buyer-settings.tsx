import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput, StyleSheet, Alert } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import * as Haptics from 'expo-haptics';
import { BG, CARD, BORDER, FG, MUTED, SUBTLE, PURPLE, FONT, FS, SP, RADIUS, ICON } from '@/lib/theme';

type Row = { label: string; subtitle?: string; icon: keyof typeof Feather.glyphMap; route?: string; section?: string; destructive?: boolean; action?: 'signout' | 'delete' };
type Group = { title: string; rows: Row[] };

const GROUPS: Group[] = [
  { title: 'Your account', rows: [
    { label: 'Accounts Center', subtitle: 'Password, security, personal details and account ownership', icon: 'user', route: '/buyer-account-center' },
    { label: 'Edit profile', icon: 'edit-3', route: '/(buyer)/edit-profile' },
    { label: 'Your activity', subtitle: 'Likes, comments, searches, links and time spent', icon: 'activity', section: 'activity' },
    { label: 'Archive', subtitle: 'Archived posts and stories', icon: 'archive', section: 'archive' },
    { label: 'Saved', subtitle: 'Posts, products and collections', icon: 'bookmark', route: '/buyer-saved' },
    { label: 'QR code', subtitle: 'Share your Brandthread profile', icon: 'grid', section: 'qr' },
  ]},
  { title: 'Who can see your content', rows: [
    { label: 'Account privacy', icon: 'lock', route: '/buyer-privacy-settings' },
    { label: 'Close Friends', icon: 'star', section: 'close-friends' },
    { label: 'Blocked', icon: 'slash', route: '/buyer-blocked' },
    { label: 'Hide story and live', icon: 'eye-off', section: 'story' },
  ]},
  { title: 'How others can interact with you', rows: [
    { label: 'Messages and story replies', icon: 'message-circle', section: 'messages' },
    { label: 'Tags and mentions', icon: 'at-sign', section: 'tags' },
    { label: 'Comments', icon: 'message-square', section: 'comments' },
    { label: 'Sharing and remixes', icon: 'repeat', section: 'sharing' },
    { label: 'Hidden Words', subtitle: 'Automatically hide offensive comments and requests', icon: 'shield', section: 'hidden-words' },
    { label: 'Muted accounts', icon: 'volume-x', section: 'muted' },
    { label: 'Restricted accounts', icon: 'user-x', section: 'restricted' },
  ]},
  { title: 'What you see', rows: [
    { label: 'Favorites', subtitle: 'Prioritize brands and people you care about', icon: 'heart', section: 'favorites' },
    { label: 'Content preferences', subtitle: 'Sensitive content, hidden likes and recommendations', icon: 'sliders', section: 'content' },
    { label: 'Suggested content', icon: 'compass', section: 'suggested' },
  ]},
  { title: 'Shopping', rows: [
    { label: 'Shopping preferences', subtitle: 'Sizes, fit, favorite categories and recommendations', icon: 'shopping-bag', route: '/shopping-preferences' },
    { label: 'Orders and returns', icon: 'package', route: '/(buyer)/orders' },
    { label: 'Addresses and payments', icon: 'credit-card', section: 'payments' },
    { label: 'Following brands', icon: 'users', route: '/(buyer)/following' },
  ]},
  { title: 'Notifications and app', rows: [
    { label: 'Notifications', icon: 'bell', section: 'notifications' },
    { label: 'Accessibility', icon: 'eye', section: 'accessibility' },
    { label: 'Language', icon: 'globe', section: 'language' },
    { label: 'Media quality and data usage', icon: 'wifi', section: 'media' },
    { label: 'Appearance', icon: 'moon', section: 'appearance' },
  ]},
  { title: 'More info and support', rows: [
    { label: 'Help', icon: 'help-circle', route: '/help' },
    { label: 'Report a problem', icon: 'alert-triangle', route: '/buyer-problem-report' },
    { label: 'Privacy Center', icon: 'shield', section: 'privacy-center' },
    { label: 'About Brandthread', icon: 'info', section: 'about' },
  ]},
  { title: 'Login', rows: [
    { label: 'Sign out', icon: 'log-out', destructive: true, action: 'signout' },
    { label: 'Delete account', icon: 'trash-2', destructive: true, action: 'delete' },
  ]},
];

export default function BuyerSettingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { signOut } = useAuth();
  const [query, setQuery] = useState('');

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return GROUPS;
    return GROUPS.map(g => ({ ...g, rows: g.rows.filter(r => `${r.label} ${r.subtitle ?? ''}`.toLowerCase().includes(q)) })).filter(g => g.rows.length);
  }, [query]);

  const press = async (row: Row) => {
    Haptics.selectionAsync();
    if (row.action === 'signout') {
      Alert.alert('Sign out?', 'You can sign back in anytime.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign out', style: 'destructive', onPress: async () => { await signOut(); router.replace('/welcome' as never); } },
      ]);
      return;
    }
    if (row.action === 'delete') {
      router.push('/buyer-account-center?section=ownership' as never);
      return;
    }
    if (row.route) router.push(row.route as never);
    else if (row.section) router.push(`/buyer-settings-detail?section=${encodeURIComponent(row.section)}` as never);
  };

  return <View style={[styles.page, { paddingTop: insets.top }]}>
    <View style={styles.header}>
      <TouchableOpacity style={styles.iconBtn} onPress={() => router.back()}><Feather name="arrow-left" size={21} color={FG} /></TouchableOpacity>
      <Text style={styles.title}>Settings and activity</Text>
      <View style={styles.iconBtn} />
    </View>
    <ScrollView contentContainerStyle={{ padding: SP.md, paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false}>
      <View style={styles.search}><Feather name="search" size={17} color={MUTED} /><TextInput value={query} onChangeText={setQuery} placeholder="Search" placeholderTextColor={SUBTLE} style={styles.searchInput} /></View>
      {groups.map(group => <View key={group.title} style={styles.group}>
        <Text style={styles.groupTitle}>{group.title}</Text>
        <View style={styles.card}>{group.rows.map((row, i) => <TouchableOpacity key={row.label} onPress={() => press(row)} style={[styles.row, i < group.rows.length - 1 && styles.divider]} activeOpacity={0.7}>
          <View style={styles.rowIcon}><Feather name={row.icon} size={19} color={row.destructive ? '#F87171' : FG} /></View>
          <View style={{ flex: 1 }}><Text style={[styles.rowLabel, row.destructive && { color: '#F87171' }]}>{row.label}</Text>{row.subtitle ? <Text style={styles.rowSub}>{row.subtitle}</Text> : null}</View>
          {!row.destructive && <Feather name="chevron-right" size={19} color={SUBTLE} />}
        </TouchableOpacity>)}</View>
      </View>)}
      <Text style={styles.version}>Brandthread v1.0.0</Text>
    </ScrollView>
  </View>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: BG }, header: { height: 58, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SP.md, borderBottomWidth: 1, borderBottomColor: BORDER },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }, title: { color: FG, fontFamily: FONT.bold, fontSize: FS.md },
  search: { height: 44, borderRadius: RADIUS.md, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, flexDirection: 'row', gap: 10, alignItems: 'center', paddingHorizontal: 14, marginBottom: SP.lg },
  searchInput: { flex: 1, color: FG, fontFamily: FONT.regular, fontSize: FS.base }, group: { marginBottom: SP.lg }, groupTitle: { color: MUTED, fontFamily: FONT.semibold, fontSize: FS.sm, marginBottom: SP.sm },
  card: { backgroundColor: CARD, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: BORDER, overflow: 'hidden' }, row: { minHeight: 58, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, gap: 12 }, divider: { borderBottomWidth: 1, borderBottomColor: BORDER }, rowIcon: { width: 28, alignItems: 'center' }, rowLabel: { color: FG, fontFamily: FONT.medium, fontSize: 14 }, rowSub: { color: MUTED, fontFamily: FONT.regular, fontSize: 11.5, marginTop: 2, lineHeight: 16 }, version: { color: SUBTLE, textAlign: 'center', fontFamily: FONT.regular, fontSize: 11, marginVertical: 8 },
});
