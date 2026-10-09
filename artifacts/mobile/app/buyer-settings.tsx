/**
 * Buyer "Settings and activity" — the one buyer settings screen, opened from
 * the profile's menu button and from /settings.
 *
 * 1:1 with Instagram's "Settings and activity" (Mobbin:
 * https://mobbin.com/screens/f08baa0d-fca5-4c2c-bbd1-a1e10c367714 and
 * https://mobbin.com/screens/feee12ed-78b5-4a5d-ac45-a33cd1550545): back arrow
 * + title, a search field, then one flat scrolling list under small grey
 * section headers in Instagram's order — Your account, How you use
 * Brandthread, Who can see your content, How others can interact with you,
 * What you see, Your app and media, Your orders and payments, For
 * professionals, More info and support — and Log out in red under Login.
 * Rows: leading icon, title, optional quiet value, chevron. Accounts Center is
 * the only row with a second line, as on Instagram.
 *
 * This replaces two screens: the profile "Menu" (its look is kept exactly —
 * solid page, borderless search, flat rows) and the separate card-style
 * Settings hub. Every row of both is here (services/settingsCatalog.ts);
 * rows Instagram keeps one level down (inside Accounts Center or About) are
 * found by search.
 */
import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScreenHeader } from '@/components/ScreenHeader';
import { ConfirmSheet } from '@/components/settings/SettingsKit';
import { ShareProfileSheet } from '@/components/ShareProfileSheet';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, FS, SP } from '@/lib/theme';
import { hapticLight, hapticSuccess } from '@/lib/haptics';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { useJoinedCommunities } from '@/lib/communities/useCommunityClient';
import { BUYER_SETTINGS_CATALOG, settingsGroupsFor, type SettingsCatalogItem } from '@/services/settingsCatalog';

export default function BuyerSettingsScreen() {
  const { theme } = useAppTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { signOut } = useAuth();
  const [query, setQuery] = useState('');
  const [shareSheetOpen, setShareSheetOpen] = useState(false);
  const [signOutVisible, setSignOutVisible] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  // Readonly (signed-out / fresh preview) resolves to [] without any protected call.
  const { communities: joinedGroups } = useJoinedCommunities(60_000);
  const groupsValue = joinedGroups.length > 0 ? `${joinedGroups.length} joined` : undefined;

  const sections = useMemo(() => settingsGroupsFor(BUYER_SETTINGS_CATALOG, query), [query]);
  const s = styles(theme);

  function valueFor(item: SettingsCatalogItem): string | undefined {
    if (item.route === '/community') return groupsValue;
    return undefined;
  }

  function handleItem(item: SettingsCatalogItem) {
    hapticLight();
    if (item.action === 'sign-out') { setSignOutVisible(true); return; }
    if (item.action === 'share-profile') { setShareSheetOpen(true); return; }
    if (item.action === 'delete-account') { router.push('/delete-account' as never); return; }
    if (item.route) router.push(item.route as never);
  }

  async function confirmSignOut() {
    setSigningOut(true);
    try {
      await signOut();
      hapticSuccess();
      router.replace('/sign-in' as never);
    } catch {
      // stay signed in; the sheet closes below
    } finally {
      setSigningOut(false);
      setSignOutVisible(false);
    }
  }

  return (
    <View style={[s.page, { backgroundColor: theme.background }]}>
      <ScreenHeader title="Settings and activity" onBack={() => goBackOr(router, '/(buyer)/profile')} />

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
            accessibilityLabel="Search settings"
          />
          {query.length > 0 && (
            <Pressable onPress={() => setQuery('')} hitSlop={8} accessibilityRole="button" accessibilityLabel="Clear search">
              <Feather name="x-circle" size={15} color={theme.subtle} />
            </Pressable>
          )}
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[s.scrollContent, { paddingBottom: insets.bottom + SP.xl }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {sections.length === 0 ? (
          <Text style={[s.noResults, { color: theme.subtle }]}>No results for “{query.trim()}”</Text>
        ) : null}
        {sections.map((section) => (
          <View key={section.title} style={s.section}>
            <Text style={[s.sectionHeader, { color: theme.subtle }]} accessibilityRole="header">{section.title}</Text>
            {section.items.map((item, i) => {
              const value = valueFor(item);
              // Log out is a plain red text row under "Login", as on Instagram.
              const textOnly = item.action === 'sign-out';
              const color = item.destructive ? theme.error : theme.text;
              return (
                <Pressable
                  key={item.label}
                  onPress={() => handleItem(item)}
                  style={({ pressed }) => [s.row, item.showDescription && s.rowTall, pressed && { opacity: 0.6 }]}
                  accessibilityRole="button"
                  accessibilityLabel={value ? `${item.label}, ${value}` : item.label}
                  testID={`settings-row-${item.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
                >
                  {!textOnly && <Feather name={item.icon} size={ROW_ICON_SIZE} color={color} />}
                  <View style={s.rowText}>
                    <Text style={[s.rowLabel, { color }]} numberOfLines={1}>{item.label}</Text>
                    {item.showDescription ? (
                      <Text style={[s.rowDescription, { color: theme.subtle }]} numberOfLines={1}>{item.description}</Text>
                    ) : null}
                  </View>
                  {value ? <Text style={[s.rowValue, { color: theme.subtle }]} numberOfLines={1}>{value}</Text> : null}
                  {!item.destructive && <Feather name="chevron-right" size={16} color={theme.subtle} />}
                  {i < section.items.length - 1 && (
                    <View style={[s.divider, textOnly && { left: SIDE_INSET }, { backgroundColor: theme.border }]} />
                  )}
                </Pressable>
              );
            })}
          </View>
        ))}
      </ScrollView>

      <ShareProfileSheet visible={shareSheetOpen} onClose={() => setShareSheetOpen(false)} />

      <ConfirmSheet
        visible={signOutVisible}
        title="Log out of your account?"
        message="You can log back in to this Brandthread account anytime."
        confirmLabel="Log out"
        loading={signingOut}
        onConfirm={confirmSignOut}
        onCancel={() => setSignOutVisible(false)}
      />
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
    scrollContent: {},
    noResults: { fontSize: FS.sm, fontFamily: FONT.regular, textAlign: 'center', marginTop: SP.xl, paddingHorizontal: SIDE_INSET },
    section: { marginTop: SP.md },
    sectionHeader: {
      fontSize: 13, fontFamily: FONT.semibold,
      paddingHorizontal: SIDE_INSET, marginBottom: 2,
    },
    row: {
      flexDirection: 'row', alignItems: 'center', gap: ICON_LABEL_GAP,
      minHeight: ROW_HEIGHT, paddingHorizontal: SIDE_INSET,
    },
    rowTall: { minHeight: 64, paddingVertical: SP.xs },
    rowText: { flex: 1, minWidth: 0 },
    rowLabel: { fontSize: 15, fontFamily: FONT.semibold },
    rowDescription: { fontSize: FS.xs, fontFamily: FONT.regular, marginTop: 2 },
    rowValue: { fontSize: FS.sm, fontFamily: FONT.regular, maxWidth: 120 },
    divider: {
      position: 'absolute', left: SIDE_INSET + ROW_ICON_SIZE + ICON_LABEL_GAP, right: 0, bottom: 0,
      height: StyleSheet.hairlineWidth,
    },
  });
}
