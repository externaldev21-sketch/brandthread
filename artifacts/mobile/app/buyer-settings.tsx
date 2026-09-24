/**
 * Buyer Settings Hub — its own screen, separate from Seller Settings.
 * Profile card + search + compact grouped iOS-Settings-style sections.
 */
import React, { useMemo, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth, useUser } from '@clerk/expo';
import { useColors } from '@/hooks/useColors';
import { FONT, FS, SP } from '@/lib/theme';
import { hapticLight, hapticSuccess } from '@/lib/haptics';
import { BUYER_SETTINGS_CATALOG, SettingsCatalogItem } from '@/services/settingsCatalog';
import { SettingsProfileCard, SettingsSearchBar, SettingsSection, SettingsRow, ConfirmSheet } from '@/components/settings/SettingsKit';
import { IconButton } from '@/components/BrandthreadUI';

export default function BuyerSettingsScreen() {
  const colors = useColors();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { signOut } = useAuth();
  const { user } = useUser();
  const [query, setQuery] = useState('');
  const [signOutVisible, setSignOutVisible] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const profileName = user?.fullName || user?.username || 'Your Brandthread profile';
  const profileInitials = [user?.firstName?.[0], user?.lastName?.[0]].filter(Boolean).join('').toUpperCase() || 'BT';
  const topPad = Platform.OS === 'web' ? 24 : insets.top;

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return BUYER_SETTINGS_CATALOG;
    return BUYER_SETTINGS_CATALOG
      .map((group) => ({
        ...group,
        items: group.items.filter((item) =>
          `${item.label} ${item.description} ${item.aliases.join(' ')}`.toLowerCase().includes(q),
        ),
      }))
      .filter((group) => group.items.length > 0);
  }, [query]);

  async function handleItem(item: SettingsCatalogItem) {
    hapticLight();
    if (item.soon) return;
    if (item.action === 'sign-out') {
      setSignOutVisible(true);
      return;
    }
    if (item.action === 'delete-account') {
      router.push('/delete-account' as never);
      return;
    }
    if (item.route) router.push(item.route as never);
  }

  async function confirmSignOut() {
    setSigningOut(true);
    try {
      await signOut();
      hapticSuccess();
      router.replace('/sign-in' as never);
    } finally {
      setSigningOut(false);
      setSignOutVisible(false);
    }
  }

  return (
    <View style={s.page}>
      <View style={[s.header, { paddingTop: topPad + 12 }]}>
        <Text style={s.headerTitle}>Settings</Text>
        <IconButton name="x" color={colors.foreground} onPress={() => { hapticLight(); router.back(); }} accessibilityLabel="Close settings" />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: SP.md, paddingBottom: insets.bottom + 48 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <SettingsProfileCard
          eyebrow="Buyer account"
          name={profileName}
          subtitle={user?.primaryEmailAddress?.emailAddress}
          initials={profileInitials}
          onPress={() => router.push('/(buyer)/edit-profile' as never)}
        />

        <SettingsSearchBar value={query} onChangeText={setQuery} />

        {groups.map((group) => (
          <SettingsSection key={group.title} title={group.title}>
            {group.items.map((item, i) => (
              <SettingsRow
                key={item.label}
                icon={item.icon}
                label={item.label}
                subtitle={item.description}
                destructive={item.destructive}
                soon={item.soon}
                last={i === group.items.length - 1}
                onPress={() => handleItem(item)}
              />
            ))}
          </SettingsSection>
        ))}

        <Text style={s.version}>Brandthread v1.0.0</Text>
      </ScrollView>

      <ConfirmSheet
        visible={signOutVisible}
        title="Sign out?"
        message="You can sign back in to this Brandthread account anytime."
        confirmLabel="Sign out"
        loading={signingOut}
        onConfirm={confirmSignOut}
        onCancel={() => setSignOutVisible(false)}
      />
    </View>
  );
}

function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    page: { flex: 1, backgroundColor: colors.background },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SP.md, paddingBottom: 20 },
    headerTitle: { fontSize: 30, fontFamily: FONT.bold, color: colors.foreground },
    version: { fontSize: FS.xs, fontFamily: FONT.regular, color: colors.mutedForeground, textAlign: 'center', marginTop: 4 },
  });
}
