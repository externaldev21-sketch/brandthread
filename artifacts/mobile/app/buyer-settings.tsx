import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput, StyleSheet, Alert } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import * as Haptics from 'expo-haptics';
import { FONT, FS, SP, RADIUS } from '@/lib/theme';
import { useColors } from '@/hooks/useColors';
import { ThreadDivider } from '@/components/BrandthreadUI';

type Row = { label: string; subtitle?: string; icon: keyof typeof Feather.glyphMap; route?: string; section?: string; destructive?: boolean; action?: 'signout' | 'delete' };
type Group = { title: string; rows: Row[] };

const GROUPS: Group[] = [
  { title: 'Your account', rows: [
    { label: 'Accounts Center', subtitle: 'Password, security, personal details and account ownership', icon: 'user', route: '/buyer-account-center' },
    { label: 'Edit profile', icon: 'edit-3', route: '/(buyer)/edit-profile' },
    { label: 'Your activity', subtitle: 'Likes, comments, searches, links and time spent', icon: 'activity', route: '/buyer-your-activity' },
    { label: 'Archive', subtitle: 'Archived posts and stories', icon: 'archive', route: '/buyer-archive' },
    { label: 'Saved', subtitle: 'Posts, products and collections', icon: 'bookmark', route: '/buyer-saved' },
    { label: 'QR code', subtitle: 'Share your Brandthread profile', icon: 'grid', route: '/buyer-qr-code' },
    { label: 'Invite friends', subtitle: 'Share your invite code and earn rewards', icon: 'gift', route: '/buyer-invite' },
    { label: 'Download my data', subtitle: 'Export your profile, orders and messages', icon: 'download', route: '/buyer-download-data' },
  ]},
  { title: 'Who can see your content', rows: [
    { label: 'Account privacy', icon: 'lock', route: '/buyer-privacy-settings' },
    { label: 'Close Friends', icon: 'star', route: '/buyer-close-friends' },
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
    { label: 'Shipping addresses', subtitle: 'Manage your saved addresses for faster checkout', icon: 'map-pin', route: '/buyer-addresses' },
    { label: 'Payment methods', subtitle: 'Cards saved to your account', icon: 'credit-card', route: '/buyer-payment-methods' },
    { label: 'Following brands', icon: 'users', route: '/(buyer)/following' },
  ]},
  { title: 'Security', rows: [
    { label: 'Login methods', subtitle: 'Password, two-factor authentication', icon: 'key', route: '/login-methods' },
    { label: 'Login activity', subtitle: 'Review devices signed into your account', icon: 'monitor', route: '/login-activity' },
    { label: 'Biometric unlock', subtitle: 'Face ID or fingerprint', icon: 'unlock', route: '/biometric-unlock' },
  ]},
  { title: 'Notifications and app', rows: [
    { label: 'Notifications', icon: 'bell', section: 'notifications' },
    { label: 'Accessibility', icon: 'eye', section: 'accessibility' },
    { label: 'Language', icon: 'globe', section: 'language' },
    { label: 'Media quality and data usage', icon: 'wifi', section: 'media' },
    { label: 'App theme', subtitle: 'Change the colors of the whole app', icon: 'moon', route: '/app-theme' },
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
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  // Preserve the legacy deep link while keeping one shared settings index.
  useEffect(() => {
    router.replace('/settings' as never);
  }, [router]);
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
        { text: 'Sign out', style: 'destructive', onPress: async () => { await signOut(); router.replace('/sign-in' as never); } },
      ]);
      return;
    }
    if (row.action === 'delete') {
      router.push('/buyer-account-control' as never);
      return;
    }
    if (row.route) router.push(row.route as never);
    else if (row.section) router.push(`/buyer-settings-detail?section=${encodeURIComponent(row.section)}` as never);
  };

  return <View style={[styles.page, { paddingTop: insets.top }]}>
    <View style={styles.header}>
       <TouchableOpacity style={styles.iconBtn} onPress={() => router.back()}><Feather name="arrow-left" size={21} color={colors.foreground} /></TouchableOpacity>
      <Text style={styles.title}>Settings and activity</Text>
      <View style={styles.iconBtn} />
    </View>
    <ScrollView contentContainerStyle={{ padding: SP.md, paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false}>
       <View style={styles.search}><Feather name="search" size={17} color={colors.mutedForeground} /><TextInput value={query} onChangeText={setQuery} placeholder="Search" placeholderTextColor={colors.mutedForeground} style={styles.searchInput} /></View>
      {groups.map((group, gi) => <React.Fragment key={group.title}>
        {gi > 0 && <ThreadDivider style={{ marginVertical: SP.xs }} />}
        <View style={styles.group}>
          <Text style={styles.groupTitle}>{group.title}</Text>
          <View style={styles.card}>{group.rows.map((row, i) => <TouchableOpacity key={row.label} onPress={() => press(row)} style={[styles.row, i < group.rows.length - 1 && styles.divider]} activeOpacity={0.7}>
             <View style={styles.rowIcon}><Feather name={row.icon} size={19} color={row.destructive ? colors.destructive : colors.foreground} /></View>
             <View style={{ flex: 1 }}><Text style={[styles.rowLabel, row.destructive && { color: colors.destructive }]}>{row.label}</Text>{row.subtitle ? <Text style={styles.rowSub}>{row.subtitle}</Text> : null}</View>
             {!row.destructive && <Feather name="chevron-right" size={19} color={colors.mutedForeground} />}
          </TouchableOpacity>)}</View>
        </View>
      </React.Fragment>)}
      <Text style={styles.version}>Brandthread v1.0.0</Text>
    </ScrollView>
  </View>;
}

function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
  page: { flex: 1, backgroundColor: 'transparent' }, header: { height: 58, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SP.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }, title: { color: colors.foreground, fontFamily: FONT.bold, fontSize: FS.md },
  search: { height: 44, borderRadius: RADIUS.md, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, flexDirection: 'row', gap: 10, alignItems: 'center', paddingHorizontal: 14, marginBottom: SP.lg },
  searchInput: { flex: 1, color: colors.foreground, fontFamily: FONT.regular, fontSize: FS.base }, group: { marginBottom: SP.lg }, groupTitle: { color: colors.mutedForeground, fontFamily: FONT.semibold, fontSize: FS.sm, marginBottom: SP.sm },
  card: { backgroundColor: colors.card, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' }, row: { minHeight: 58, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, gap: 12 }, divider: { borderBottomWidth: 1, borderBottomColor: colors.border }, rowIcon: { width: 28, alignItems: 'center' }, rowLabel: { color: colors.foreground, fontFamily: FONT.medium, fontSize: FS.sm }, rowSub: { color: colors.mutedForeground, fontFamily: FONT.regular, fontSize: FS.xs, marginTop: 2, lineHeight: 16 }, version: { color: (colors as any).subtle ?? colors.mutedForeground, textAlign: 'center', fontFamily: FONT.regular, fontSize: FS.xs, marginVertical: 8 },
  });
}
